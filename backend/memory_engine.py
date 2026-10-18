# backend/memory_engine.py
import json
from datetime import datetime
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session
from backend.models import Conversation, Message, UserMemory, VisitOrder, MemoryTier, MemoryStatus
from backend.config import settings

def load_menu() -> List[Dict[str, Any]]:
    with open(settings.MENU_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

def get_active_memories(db: Session, user_id: str, conversation_id: Optional[str] = None) -> List[UserMemory]:
    """Fetch permanent active memories + ephemeral memories for the current conversation only."""
    query = db.query(UserMemory).filter(
        UserMemory.user_id == user_id,
        UserMemory.status == MemoryStatus.ACTIVE.value
    )
    memories = query.all()
    return [
        m for m in memories
        if m.tier != MemoryTier.EPHEMERAL_CONTEXT.value or m.conversation_id == conversation_id
    ]

def get_memory_history(db: Session, user_id: str) -> List[UserMemory]:
    """Fetch all memories (including superseded/revoked) for the UI Inspector & Audit Trail."""
    return (
        db.query(UserMemory)
        .filter(UserMemory.user_id == user_id)
        .order_by(UserMemory.updated_at.desc(), UserMemory.id.desc())
        .all()
    )

def upsert_user_memory(
    db: Session,
    user_id: str,
    conversation_id: str,
    category: str,
    attribute: str,
    value: str,
    tier: str,
    source_quote: str,
    reason: str
) -> Dict[str, Any]:
    """
    Upserts a normalized preference or constraint, automatically resolving conflicts
    and preserving a versioned audit trail.
    """
    category = category.strip().lower()
    attribute = attribute.strip().lower()
    value = str(value).strip().lower()

    # Determine scope filter: ephemeral memories only conflict within the same conversation
    existing_query = db.query(UserMemory).filter(
        UserMemory.user_id == user_id,
        UserMemory.category == category,
        UserMemory.attribute == attribute,
        UserMemory.status == MemoryStatus.ACTIVE.value
    )
    if tier == MemoryTier.EPHEMERAL_CONTEXT.value:
        existing_query = existing_query.filter(UserMemory.conversation_id == conversation_id)
    else:
        existing_query = existing_query.filter(UserMemory.tier != MemoryTier.EPHEMERAL_CONTEXT.value)

    existing = existing_query.first()

    # If identical active memory already exists, just refresh timestamp/quote
    if existing and existing.value == value and existing.tier == tier:
        existing.source_quote = source_quote
        existing.reason = reason
        db.commit()
        return {"action": "unchanged", "category": category, "attribute": attribute, "value": value, "tier": tier}

    # Create the new memory state
    new_mem = UserMemory(
        user_id=user_id,
        conversation_id=conversation_id if tier == MemoryTier.EPHEMERAL_CONTEXT.value else None,
        category=category,
        attribute=attribute,
        value=value,
        tier=tier,
        status=MemoryStatus.ACTIVE.value,
        source_quote=source_quote,
        reason=reason
    )
    db.add(new_mem)
    db.flush() # Obtain new_mem.id

    action_type = "created"
    previous_value = None

    if existing:
        existing.status = MemoryStatus.SUPERSEDED.value
        existing.superseded_by_id = new_mem.id
        action_type = "updated"
        previous_value = existing.value

    # Cross-category safety rule: If adding a hard allergy/diet restriction, revoke conflicting positive likes
    if category == "allergy" and value == "restricted":
        conflicting_likes = db.query(UserMemory).filter(
            UserMemory.user_id == user_id,
            UserMemory.category == "ingredient",
            UserMemory.attribute.contains(attribute),
            UserMemory.value == "liked",
            UserMemory.status == MemoryStatus.ACTIVE.value
        ).all()
        for conflict in conflicting_likes:
            conflict.status = MemoryStatus.REVOKED.value
            conflict.superseded_by_id = new_mem.id

    db.commit()
    db.refresh(new_mem)

    return {
        "action": action_type,
        "id": new_mem.id,
        "category": category,
        "attribute": attribute,
        "previous_value": previous_value,
        "new_value": value,
        "tier": tier,
        "reason": reason
    }

def revoke_user_memory(
    db: Session,
    user_id: str,
    category: str,
    attribute: str,
    reason: str
) -> Dict[str, Any]:
    """Explicitly revokes an active preference or constraint when a user states it no longer applies."""
    category = category.strip().lower()
    attribute = attribute.strip().lower()

    active_records = db.query(UserMemory).filter(
        UserMemory.user_id == user_id,
        UserMemory.category == category,
        UserMemory.attribute == attribute,
        UserMemory.status == MemoryStatus.ACTIVE.value
    ).all()

    if not active_records:
        return {"action": "not_found", "category": category, "attribute": attribute}

    for rec in active_records:
        rec.status = MemoryStatus.REVOKED.value
        rec.reason = f"Revoked: {reason}"

    db.commit()
    return {"action": "revoked", "category": category, "attribute": attribute, "reason": reason}


def evaluate_menu_for_user(
    db: Session,
    user_id: str,
    conversation_id: Optional[str] = None,
    category_filter: Optional[str] = None,
    override_max_price: Optional[float] = None
) -> Dict[str, Any]:
    """
    Deterministically filters the menu against HARD_CONSTRAINTS (and ephemeral overrides)
    and scores surviving items against SOFT_PREFERENCES.
    """
    menu = load_menu()
    active_memories = get_active_memories(db, user_id, conversation_id)

    # Separate ephemeral vs permanent to allow ephemeral context (e.g., "ordering for a meat-loving friend")
    # to override personal soft/diet rules if explicitly set in the session.
    allergies = set()
    require_vegan = False
    require_vegetarian = False
    max_price: Optional[float] = override_max_price
    preferred_spice: Optional[str] = None
    liked_terms = set()
    disliked_terms = set()

    # Process permanent memories first, then ephemeral so session context can refine
    sorted_memories = sorted(
        active_memories,
        key=lambda m: 1 if m.tier == MemoryTier.EPHEMERAL_CONTEXT.value else 0
    )

    for m in sorted_memories:
        cat, attr, val = m.category, m.attribute, m.value
        if cat == "allergy":
            if val == "restricted":
                allergies.add(attr)
            elif val in ("none", "false", "allowed"):
                allergies.discard(attr)
        elif cat == "diet":
            if attr == "vegan":
                require_vegan = (val in ("required", "true", "yes"))
                if require_vegan:
                    require_vegetarian = True
            elif attr == "vegetarian":
                require_vegetarian = (val in ("required", "true", "yes"))
            elif attr in ("omnivore", "meat_allowed") and val in ("true", "required"):
                # Ephemeral override e.g. ordering for a non-vegan friend
                require_vegan = False
                require_vegetarian = False
        elif cat == "budget" and attr == "max_price":
            try:
                parsed_price = float(val.replace("$", "").strip())
                if max_price is None or m.tier == MemoryTier.EPHEMERAL_CONTEXT.value:
                    max_price = parsed_price
            except ValueError:
                pass
        elif cat == "spice" and attr == "level":
            preferred_spice = val
        elif cat in ("ingredient", "tag_preference"):
            if val == "liked":
                liked_terms.add(attr)
                disliked_terms.discard(attr)
            elif val == "disliked":
                disliked_terms.add(attr)
                liked_terms.discard(attr)

    safe_items = []
    excluded_items = []

    for item in menu:
        if category_filter and category_filter.lower() != "all":
            if category_filter.lower() not in item["category"].lower():
                continue

        rejection_reasons = []

        # 1. Check Allergens (Hard Safety Check)
        item_allergens = {a.lower() for a in item.get("allergens", [])}
        triggered_allergens = allergies.intersection(item_allergens)
        if triggered_allergens:
            rejection_reasons.append(f"Contains restricted allergen(s): {', '.join(sorted(triggered_allergens))}")

        # Also check explicit ingredient strings in case of specific ingredient allergy
        item_ing_text = " ".join(item.get("ingredients", [])).lower()
        for alg in allergies:
            if alg not in triggered_allergens and alg in item_ing_text:
                rejection_reasons.append(f"Contains restricted ingredient: {alg}")

        # 2. Check Strict Diet
        if require_vegan and not item.get("is_vegan", False):
            rejection_reasons.append("Not Vegan")
        elif require_vegetarian and not item.get("is_vegetarian", False):
            rejection_reasons.append("Not Vegetarian")

        # 3. Check Budget Constraint
        if max_price is not None and item["price"] > max_price:
            rejection_reasons.append(f"Price (${item['price']:.2f}) exceeds budget cap (${max_price:.2f})")

        # Score soft preferences
        score = 100
        match_notes = []
        searchable_blob = (
            f"{item['name']} {item['description']} "
            + " ".join(item.get("ingredients", [])) + " "
            + " ".join(item.get("tags", []))
        ).lower()

        if preferred_spice:
            if item["spice_level"].lower() == preferred_spice:
                score += 20
                match_notes.append(f"Matches preferred {preferred_spice} spice")
            elif preferred_spice == "none" and item["spice_level"].lower() in ("medium", "high"):
                score -= 25
                match_notes.append(f"Higher spice ({item['spice_level']}) than preferred (none)")
            elif preferred_spice == "mild" and item["spice_level"].lower() == "high":
                score -= 20
                match_notes.append("Too spicy (high vs. mild preference)")

        for liked in liked_terms:
            if liked in searchable_blob:
                score += 15
                match_notes.append(f"Features '{liked}'")

        for disliked in disliked_terms:
            if disliked in searchable_blob:
                score -= 35
                match_notes.append(f"Contains disliked '{disliked}'")

        enriched_item = {
            **item,
            "is_safe": len(rejection_reasons) == 0,
            "rejection_reasons": rejection_reasons,
            "compatibility_score": max(0, min(150, score)),
            "match_notes": match_notes
        }

        if rejection_reasons:
            excluded_items.append(enriched_item)
        else:
            safe_items.append(enriched_item)

    safe_items.sort(key=lambda x: (-x["compatibility_score"], x["price"]))

    return {
        "active_constraints_summary": {
            "allergies": sorted(list(allergies)),
            "require_vegan": require_vegan,
            "require_vegetarian": require_vegetarian,
            "max_price": max_price,
            "preferred_spice": preferred_spice,
            "liked_terms": sorted(list(liked_terms)),
            "disliked_terms": sorted(list(disliked_terms))
        },
        "safe_recommendations": safe_items,
        "excluded_items": excluded_items
    }

def _english_title(name: str) -> str:
    return str(name or "").split("(")[0].strip()

def dishes_outside_lasting_profile(db: Session, user_id: str, item_ids: List[str]) -> List[str]:
    """Dishes this visit can serve that the guest's lasting diet or allergies still forbid."""
    matrix = evaluate_menu_for_user(db, user_id, conversation_id="__lasting__")
    excluded = {item["id"] for item in matrix["excluded_items"]}
    return [item_id for item_id in item_ids if item_id in excluded]

def order_thanks(
    guest_name: str,
    result: Dict[str, Any],
    company_ids: Optional[List[str]] = None
) -> str:
    """The host's reply once a visit order is confirmed: the dishes, the total, and a thank-you."""
    first = (guest_name or "friend").split(" (")[0].split()[0] or "friend"
    company = set(company_ids or [])
    accepted = result.get("accepted") or []
    company_count = sum(1 for item in accepted if item.get("id") in company)
    if accepted and company_count == len(accepted):
        heading = f"{first}, the table is set for your company tonight:"
    else:
        heading = f"{first}, your table is ready:"
    lines = ["حيّاك الله.", "", heading]
    for item in accepted:
        line = f"- **{_english_title(item.get('name', ''))}** — ${float(item.get('price') or 0):.2f}"
        if item.get("id") in company:
            line += ", for your company"
        lines.append(line)
    lines.append("")
    if company_count:
        closing = "Your own profile stays as it is. I will remember who this was for."
    else:
        closing = "I will remember this visit."
    lines.append(
        f"**Total ${float(result.get('total_price') or 0):.2f}.** "
        f"Thank you for dining at Dar Najd tonight. {closing}"
    )
    refused = result.get("refused") or []
    if refused:
        lines.append("")
        for item in refused:
            why = (item.get("reasons") or ["it is not available"])[0]
            lines.append(f"I left {_english_title(item.get('name', ''))} off the order: {why}.")
    return "\n".join(lines)

def visit_company_quote(db: Session, conversation_id: str) -> str:
    """What the guest said when that visit's table was for someone else, such as a friend eating meat."""
    rows = (
        db.query(UserMemory)
        .filter(
            UserMemory.conversation_id == conversation_id,
            UserMemory.tier == MemoryTier.EPHEMERAL_CONTEXT.value,
            UserMemory.status == MemoryStatus.ACTIVE.value,
            UserMemory.category == "diet",
            UserMemory.attribute.in_(("omnivore", "meat_allowed")),
        )
        .order_by(UserMemory.id.asc())
        .all()
    )
    parts = []
    for row in rows:
        text = (row.source_quote or row.reason or "").strip()
        if text and text not in parts:
            parts.append(text)
    return " ".join(parts)

def record_order_thanks(
    db: Session,
    conversation_id: str,
    guest_name: str,
    result: Dict[str, Any]
) -> Optional[Message]:
    """Save the thank-you once. Confirming the same table again does not add another bubble."""
    conv = db.query(Conversation).filter(Conversation.id == conversation_id).one()
    accepted_ids = [item["id"] for item in result.get("accepted") or []]
    text = order_thanks(
        guest_name,
        result,
        dishes_outside_lasting_profile(db, conv.user_id, accepted_ids)
    )
    latest = (
        db.query(Message)
        .filter(Message.conversation_id == conversation_id, Message.role == "assistant")
        .order_by(Message.id.desc())
        .first()
    )
    if latest is not None and latest.content == text:
        return None
    record = Message(
        conversation_id=conversation_id,
        role="assistant",
        content=text,
        recommended_item_ids=[],
        memory_events=[]
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record

def _deduped_ids(item_ids: Optional[List[str]]) -> List[str]:
    seen = set()
    ordered = []
    for raw in item_ids or []:
        item_id = str(raw).strip()
        if not item_id or item_id in seen:
            continue
        seen.add(item_id)
        ordered.append(item_id)
    return ordered

def confirm_order_for_visit(
    db: Session,
    user_id: str,
    conversation_id: str,
    item_ids: List[str]
) -> Dict[str, Any]:
    """Save this visit's dishes. Only IDs that are safe right now are written."""
    requested = _deduped_ids(item_ids)
    matrix = evaluate_menu_for_user(db, user_id, conversation_id)
    safe = {item["id"]: item for item in matrix["safe_recommendations"]}
    excluded = {item["id"]: item for item in matrix["excluded_items"]}

    accepted = []
    accepted_ids = []
    refused = []
    for item_id in requested:
        if item_id in safe:
            item = safe[item_id]
            accepted.append({"id": item_id, "name": item["name"], "price": item["price"]})
            accepted_ids.append(item_id)
        elif item_id in excluded:
            item = excluded[item_id]
            refused.append({
                "id": item_id,
                "name": item["name"],
                "reasons": list(item.get("rejection_reasons") or [])
            })
        else:
            refused.append({"id": item_id, "name": item_id, "reasons": ["Not on the menu"]})

    existing = db.query(VisitOrder).filter(VisitOrder.conversation_id == conversation_id).one_or_none()
    if not accepted_ids:
        return {
            "status": "refused_all",
            "accepted": [],
            "refused": refused,
            "total_price": 0,
            "kept_existing": existing is not None
        }

    total = sum(item["price"] for item in accepted)
    if existing is None:
        existing = VisitOrder(
            conversation_id=conversation_id,
            user_id=user_id,
            item_ids=accepted_ids,
            refused=refused,
            total_price=total,
            updated_at=datetime.utcnow()
        )
        db.add(existing)
    else:
        existing.user_id = user_id
        existing.item_ids = accepted_ids
        existing.refused = refused
        existing.total_price = total
        existing.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(existing)
    return {
        "status": "confirmed",
        "accepted": accepted,
        "refused": refused,
        "total_price": total,
        "kept_existing": False
    }

def last_confirmed_order(db: Session, user_id: str, conversation_id: str) -> Optional[VisitOrder]:
    """The confirmed order from this guest's most recent earlier visit. A later visit is not the past."""
    current = db.query(Conversation).filter(Conversation.id == conversation_id).one_or_none()
    if current is None or current.created_at is None:
        return None
    rows = (
        db.query(VisitOrder)
        .join(Conversation, Conversation.id == VisitOrder.conversation_id)
        .filter(
            VisitOrder.user_id == user_id,
            VisitOrder.conversation_id != conversation_id,
            Conversation.created_at < current.created_at
        )
        .order_by(Conversation.created_at.desc(), VisitOrder.id.desc())
        .all()
    )
    for row in rows:
        if row.item_ids:
            return row
    return None

def revalidate_order(
    db: Session,
    user_id: str,
    conversation_id: str,
    order: VisitOrder
) -> List[Dict[str, Any]]:
    """Mark each dish on an older order as still safe or blocked for this visit. Does not write."""
    matrix = evaluate_menu_for_user(db, user_id, conversation_id)
    safe = {item["id"]: item for item in matrix["safe_recommendations"]}
    excluded = {item["id"]: item for item in matrix["excluded_items"]}
    menu = {item["id"]: item for item in load_menu()}
    checked = []
    for item_id in order.item_ids or []:
        source = safe.get(item_id) or excluded.get(item_id) or menu.get(item_id)
        name = source["name"] if source else item_id
        price = source["price"] if source else 0
        if item_id in safe:
            checked.append({"id": item_id, "name": name, "price": price, "still_safe": True, "reasons": []})
        elif item_id in excluded:
            checked.append({
                "id": item_id,
                "name": name,
                "price": price,
                "still_safe": False,
                "reasons": list(excluded[item_id].get("rejection_reasons") or [])
            })
        else:
            checked.append({
                "id": item_id,
                "name": name,
                "price": price,
                "still_safe": False,
                "reasons": ["Not on the menu"]
            })
    return checked
