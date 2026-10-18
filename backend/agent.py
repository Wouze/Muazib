# backend/agent.py
import json
import re
from typing import Dict, Any, Iterator, List, Optional
from openai import OpenAI
from sqlalchemy.orm import Session
from backend.config import settings
from backend.metrics import record_turn
from backend.models import Message
from backend.memory_engine import (
    get_active_memories,
    upsert_user_memory,
    revoke_user_memory,
    evaluate_menu_for_user,
    confirm_order_for_visit,
    dishes_outside_lasting_profile,
    last_confirmed_order,
    revalidate_order,
    order_thanks,
    visit_company_quote,
    load_menu
)

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "upsert_guest_memory",
            "description": (
                "Save or update a guest's dietary restriction, allergy, spice preference, ingredient like/dislike, "
                "budget, or session-only context. Call this IMMEDIATELY whenever the user shares or updates any preference."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "category": {
                        "type": "string",
                        "enum": ["allergy", "diet", "spice", "ingredient", "budget", "tag_preference"],
                        "description": "Normalized preference category."
                    },
                    "attribute": {
                        "type": "string",
                        "description": (
                            "Normalized attribute key. "
                            "If category='allergy', MUST be one of: 'gluten', 'dairy', 'tree_nuts', 'sesame', 'eggs' (or specific ingredient). "
                            "If category='diet', MUST be one of: 'vegan', 'vegetarian', 'omnivore'. "
                            "A friend eating meat tonight is diet omnivore, value true, tier ephemeral — never an ingredient like. "
                            "If category='spice', MUST be 'level'. "
                            "If category='budget', MUST be 'max_price'. "
                            "If category='ingredient' or 'tag_preference', use lowercase singular noun (e.g., 'lamb', 'pumpkin', 'jareesh', 'kabsa', 'mushroom', 'cilantro')."
                        )
                    },
                    "value": {
                        "type": "string",
                        "description": (
                            "Normalized value. "
                            "For allergy: 'restricted'. "
                            "For diet: 'required' or 'true'. "
                            "For spice level: 'none', 'mild', 'medium', or 'high'. "
                            "For budget max_price: numeric string e.g. '16.0'. "
                            "For ingredient/tag_preference: 'liked' or 'disliked'."
                        )
                    },
                    "tier": {
                        "type": "string",
                        "enum": ["hard_constraint", "soft_preference", "ephemeral"],
                        "description": (
                            "Use 'hard_constraint' for allergies and strict lifelong diets. "
                            "Use 'soft_preference' for spice tolerance, favorite dishes/ingredients, dislikes, or regular budget. "
                            "Use 'ephemeral' ONLY for temporary current-visit context. "
                            "Friend eating meat tonight: category diet, attribute omnivore, value true, tier ephemeral. "
                            "A one-night budget is ephemeral too."
                        )
                    },
                    "source_quote": {
                        "type": "string",
                        "description": "Exact short quote from the user's message."
                    },
                    "reason": {
                        "type": "string",
                        "description": "Brief explanation of why this memory was created or updated."
                    }
                },
                "required": ["category", "attribute", "value", "tier", "source_quote", "reason"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "revoke_guest_memory",
            "description": "Remove or revoke a previously stored preference or restriction if the user states it is no longer true.",
            "parameters": {
                "type": "object",
                "properties": {
                    "category": {
                        "type": "string",
                        "enum": ["allergy", "diet", "spice", "ingredient", "budget", "tag_preference"]
                    },
                    "attribute": {
                        "type": "string",
                        "description": "The attribute key to revoke (e.g., 'tree_nuts', 'vegan', 'level', 'max_price')."
                    },
                    "reason": {
                        "type": "string",
                        "description": "Why the preference is being revoked."
                    }
                },
                "required": ["category", "attribute", "reason"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_curated_menu_recommendations",
            "description": (
                "Run the deterministic safety & preference engine over the Dar Najd Kitchen menu. "
                "Always call this AFTER updating guest memories to retrieve accurate, allergen-safe dishes and prices."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "category_filter": {
                        "type": "string",
                        "enum": ["all", "Starters", "Mains", "Sides", "Desserts & Drinks"],
                        "description": "Optional menu category filter."
                    },
                    "override_max_price": {
                        "type": "number",
                        "description": "Optional max price per dish if specified for this specific search."
                    }
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "confirm_visit_order",
            "description": (
                "Save only the dishes the guest named or clearly accepted in this message. Pass exact menu IDs. "
                "Do not add a dish they did not accept, including one from their lasting preferences or from your last suggestion. "
                "Call upsert_guest_memory or revoke_guest_memory first when the same message also states a new constraint. "
                "Only pass IDs from safe_recommendations."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "item_ids": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Exact menu IDs the guest agreed to, in the order they chose them."
                    }
                },
                "required": ["item_ids"]
            }
        }
    }
]

def build_system_prompt(user_name: str, active_memories_text: str, menu_summary: str, last_order_text: str = "") -> str:
    last_order_block = f"\n{last_order_text}\n" if last_order_text else ""
    return f"""You are **Mu'azib (مُعَزِّب)**, the warm, perceptive AI Host of **Dar Najd Kitchen (مطبخ دار نجد)**, an authentic contemporary Najdi restaurant.
In Najdi hospitality, a Mu'azib remembers every returning guest's preferences, dietary needs, and tastes across visits without forcing them to fill out a rigid questionnaire.

### CURRENT GUEST PROFILE ({user_name}):
{active_memories_text}
{last_order_block}
### CORE OPERATING RULES:
1. **EXTRACT & UPDATE MEMORY FIRST**: Whenever the guest mentions a preference, dietary rule, allergy, spice change, dislike, budget, or correction, you MUST call `upsert_guest_memory` (or `revoke_guest_memory`) BEFORE making recommendations.
2. **RESPECT TIER SCOPING**:
   - Allergies and strict diets = `hard_constraint`.
   - Likes, dislikes, spice tolerance = `soft_preference`.
   - Temporary requests (e.g. "Just for tonight keep it under $15") = `ephemeral` (so you do NOT corrupt the guest's permanent profile!).
   - A friend joining for a meat dish is also ephemeral, and it is a diet unlock, not a like. Call `upsert_guest_memory` with category `diet`, attribute `omnivore`, value `true`, tier `ephemeral`. Do NOT store ingredient `meat` = liked. Do NOT revoke the guest's vegan hard rule. It returns on the next visit by itself.
3. **DETERMINISTIC GROUNDING**:
   - After any memory update or whenever the user asks for food advice, call `get_curated_menu_recommendations`.
   - NEVER invent dishes, ingredients, allergens, or prices. Only recommend items present in `safe_recommendations`.
   - After unlocking the menu for a friend, call the menu tool again and recommend from that new safe list. Put every dish you name in `[[RECOMMENDED_IDS]]`. Do not tell the guest a dish cannot appear as a card.
   - Explain why a dish fits. Mention a dish you left off only when `excluded_items` gives a real reason from this guest's memories. Never invent an allergy, diet, or dislike they do not have.
4. **CONVERSATIONAL & NATURAL**: Talk like a warm host at the table, not a brochure.
   - Keep replies short: 2–4 sentences (under ~90 words). When recommending, use a short bullet list of at most 3 dishes with one line each on why it fits. If a friend is eating too, one of those three is for the guest. Do not name a fourth dish in the follow-up question.
   - The UI already shows dish cards with prices, allergens, and spice, so don't repeat every detail.
   - Ask at most ONE natural follow-up question, and only when it helps the order.
   - Use light markdown (bold dish names, bullets). No headings.
5. **STRUCTURED ITEM TAGS**: Whenever you recommend specific menu items in your final response, append their exact IDs at the very end of your message inside a hidden tag like this: `[[RECOMMENDED_IDS: main_03, side_01]]` so the UI can render interactive dish cards.
6. **FOLLOW-UP SUGGESTIONS**: After the item tag, always append 2–3 short replies the guest might tap next, written in the guest's voice (under 8 words each), separated by `|`, like this: `[[FOLLOW_UPS: Something less spicy? | What dessert pairs with it? | Add Saudi coffee]]`.
7. **CONFIRM THE VISIT**: When the guest agrees to specific dishes, call `confirm_visit_order` with only the menu IDs they named or clearly accepted in this message. "Just the qursan" is the qursan alone. A wish to keep their usual profile is not an order for another dish. If that same message also states an allergy, diet, budget, or other constraint, call `upsert_guest_memory` or `revoke_guest_memory` first. Never pass an ID that is not in `safe_recommendations`.

### FULL DAR NAJD KITCHEN MENU REFERENCE:
{menu_summary}
"""

def format_active_memories(memories) -> str:
    if not memories:
        return "No stored preferences yet (First-time guest or clean profile). Discover their tastes naturally!"
    lines = []
    for m in memories:
        scope_badge = "[SESSION-ONLY EPHEMERAL]" if m.tier == "ephemeral" else f"[{m.tier.upper()}]"
        lines.append(f"- {scope_badge} {m.category}.{m.attribute} = {m.value} (Reason: {m.reason})")
    return "\n".join(lines)

TAG_PATTERN = re.compile(r"\[\[(RECOMMENDED_IDS|FOLLOW_UPS):(.*?)\]\]", re.DOTALL)
MAX_TOOL_HOPS = 3
_TOOL_RANK = {
    "upsert_guest_memory": 0,
    "revoke_guest_memory": 0,
    "get_curated_menu_recommendations": 1,
    "confirm_visit_order": 2
}

def order_tool_calls(calls: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Memory writes first, then the menu check, then confirming the visit. Stable for equal ranks."""
    return sorted(calls, key=lambda call: _TOOL_RANK.get(call.get("name", ""), 1))

def ground_recommended_ids(recommended_ids: List[str], safe_ids) -> List[str]:
    safe = set(safe_ids)
    return [item_id for item_id in recommended_ids if item_id in safe]

_NAME_STOPWORDS = {
    "the", "and", "with", "for", "from", "over", "into", "najdi", "traditional",
    "roasted", "smoked", "crispy", "fiery", "wild", "green", "red", "nut", "nuts", "pine"
}

def dishes_named_in(text: str, menu: List[Dict[str, Any]]) -> List[str]:
    """Menu IDs the guest actually named. A weaker title match is dropped when a closer one covers it."""
    words = set(re.findall(r"[a-z0-9]+", (text or "").lower()))
    found = []
    for item in menu:
        english = str(item.get("name", "")).split("(")[0]
        tokens = [
            token for token in re.findall(r"[a-z0-9]+", english.lower())
            if len(token) > 2 and token not in _NAME_STOPWORDS
        ]
        hits = {token for token in tokens if token in words}
        if hits:
            found.append((item["id"], hits))
    return [item_id for item_id, hits in found if not any(hits < other for _, other in found)]

def narrow_confirmed_ids(requested: List[str], user_message: str, menu: List[Dict[str, Any]]) -> List[str]:
    """Keep a confirm to the dishes this message names. An unnamed 'yes' leaves the model's list as it is."""
    named = dishes_named_in(user_message, menu)
    if not named:
        return list(requested)
    named_set = set(named)
    narrowed = [item_id for item_id in requested if item_id in named_set]
    return narrowed or named

def menu_step_label(result: Dict[str, Any], memory_events: List[Dict[str, Any]]) -> str:
    label = (
        f"Checked the menu: {len(result['safe_recommendations'])} safe, "
        f"{len(result['excluded_items'])} blocked"
    )
    opened = any(
        ev.get("tier") == "ephemeral"
        and ev.get("category") == "diet"
        and ev.get("attribute") in ("omnivore", "meat_allowed")
        and ev.get("action") != "revoked"
        for ev in memory_events
    )
    if opened:
        label += " — meat is open for someone else at this table"
    return label

def format_last_order(items: List[Dict[str, Any]], company_note: str = "") -> str:
    if not items:
        return ""
    lines = [
        "LAST VISIT'S TABLE (rechecked against this visit). "
        "These dishes were on the table last time. They are not a standing order."
    ]
    note = company_note.strip()
    if note:
        lines.append(f"Said at that table: {note}")
    for item in items:
        english = str(item.get("name", "")).split("(")[0].strip()
        price = f"${float(item.get('price') or 0):.2f}"
        if item.get("still_safe"):
            lines.append(f"- {english} ({price}) — still safe")
        else:
            reason = "; ".join(item.get("reasons") or []) or "no longer safe"
            lines.append(f"- {english} ({price}) — blocked now: {reason}")
    if note:
        lines.append(
            "A blocked dish from that table was for the company they mentioned, not for this guest. "
            "Say who it was for, then say why it is not coming back. "
            "Do not call it their old dish or their usual."
        )
    else:
        lines.append(
            "Offer a still-safe dish only when it fits what the guest is asking. "
            "You may name a blocked dish to explain why it is not coming back. "
            "Do not call a blocked dish their usual."
        )
    lines.append(
        "Do not put a blocked dish in [[RECOMMENDED_IDS]]. "
        "A recommendation still has to come from get_curated_menu_recommendations."
    )
    return "\n".join(lines)

def _order_step_label(result: Dict[str, Any]) -> str:
    if result.get("status") != "confirmed":
        return "Refused the order: nothing safe to save"
    count = len(result.get("accepted") or [])
    noun = "dish" if count == 1 else "dishes"
    label = f"Confirmed {count} {noun}, ${float(result.get('total_price') or 0):.2f}"
    refused = result.get("refused") or []
    if refused:
        label += f", refused {len(refused)}"
    return label

def _visible_prefix(text: str) -> str:
    """The part of a streaming reply that is safe to show: everything before the first hidden [[...]] tag."""
    visible = text.split("[[", 1)[0]
    # A lone trailing '[' may be the first half of a tag split across chunks.
    return visible[:-1] if visible.endswith("[") else visible

def _parse_final_text(final_text: str, menu_data: List[Dict[str, Any]]):
    recommended_ids: List[str] = []
    follow_ups: List[str] = []
    found_ids_tag = False
    for name, body in TAG_PATTERN.findall(final_text):
        if name == "RECOMMENDED_IDS":
            found_ids_tag = True
            valid_menu_ids = {item["id"] for item in menu_data}
            recommended_ids = [i.strip() for i in body.split(",") if i.strip() in valid_menu_ids]
        else:
            follow_ups = [s.strip() for s in body.split("|") if s.strip()][:3]

    clean_text = TAG_PATTERN.sub("", final_text).split("[[", 1)[0].strip()

    if not found_ids_tag:
        # Fallback: detect dish names mentioned in the text
        for item in menu_data:
            english_title = item["name"].split("(")[0].strip()
            if english_title.lower() in clean_text.lower():
                recommended_ids.append(item["id"])
        recommended_ids = recommended_ids[:3]

    return clean_text, recommended_ids, follow_ups

def _memory_step_label(res: Dict[str, Any]) -> str:
    attr = str(res.get("attribute", "")).replace("_", " ")
    scope = " (this visit)" if res.get("tier") == "ephemeral" else ""
    action = res.get("action")
    if action == "created":
        return f"Remembered {attr}: {res.get('new_value')}{scope}"
    if action == "updated":
        return f"Updated {attr}: {res.get('previous_value')} → {res.get('new_value')}{scope}"
    if action == "revoked":
        return f"Forgot {attr}"
    if action == "unchanged":
        return f"Already knew {attr}: {res.get('value')}"
    return f"Nothing stored for {attr}"

def stream_agent_turn(
    db: Session,
    user_id: str,
    user_name: str,
    conversation_id: str,
    user_message: str,
    model_override: Optional[str] = None
) -> Iterator[Dict[str, Any]]:
    """Runs one guest turn and yields events:
    delta (reply text), discard (drop streamed text: that hop became tool calls),
    step (a tool ran), and finally done (the saved assistant message)."""
    client = OpenAI(
        api_key=settings.OPENROUTER_API_KEY,
        base_url=settings.OPENROUTER_BASE_URL
    )
    active_model = model_override or settings.LLM_MODEL

    # Save incoming user message
    user_msg_record = Message(
        conversation_id=conversation_id,
        role="user",
        content=user_message
    )
    db.add(user_msg_record)
    db.commit()

    # Load conversation history
    past_messages = (
        db.query(Message)
        .filter(Message.conversation_id == conversation_id)
        .order_by(Message.id.asc())
        .all()
    )

    active_memories = get_active_memories(db, user_id, conversation_id)
    menu_data = load_menu()
    menu_summary = json.dumps(menu_data, ensure_ascii=False)
    previous_order = last_confirmed_order(db, user_id, conversation_id)
    last_order_text = ""
    if previous_order is not None:
        last_order_text = format_last_order(
            revalidate_order(db, user_id, conversation_id, previous_order),
            visit_company_quote(db, previous_order.conversation_id)
        )

    messages_payload: List[Dict[str, Any]] = [
        {
            "role": "system",
            "content": build_system_prompt(
                user_name=user_name,
                active_memories_text=format_active_memories(active_memories),
                menu_summary=menu_summary,
                last_order_text=last_order_text
            )
        }
    ]
    for msg in past_messages:
        messages_payload.append({"role": msg.role, "content": msg.content})

    memory_events: List[Dict[str, Any]] = []
    order_result: Optional[Dict[str, Any]] = None
    final_text = ""
    prompt_tokens = 0
    completion_tokens = 0

    # Up to 3 tool-calling hops (e.g., upsert_memory -> get_curated_menu_recommendations -> final answer),
    # then one last call without tools so the turn always ends with a reply.
    for hop in range(MAX_TOOL_HOPS + 1):
        request: Dict[str, Any] = {
            "model": active_model,
            "messages": messages_payload,
            "temperature": 0.3,
            "stream": True,
            "stream_options": {"include_usage": True}
        }
        if hop < MAX_TOOL_HOPS:
            request.update(tools=TOOLS, tool_choice="auto")

        stream = client.chat.completions.create(**request)
        text = ""
        sent = 0
        tool_calls: Dict[int, Dict[str, str]] = {}
        try:
            for chunk in stream:
                usage = getattr(chunk, "usage", None)
                if usage:
                    prompt_tokens += int(getattr(usage, "prompt_tokens", 0) or 0)
                    completion_tokens += int(getattr(usage, "completion_tokens", 0) or 0)
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                for tc in delta.tool_calls or []:
                    idx = tc.index
                    if idx is None:
                        idx = len(tool_calls) if (tc.id or not tool_calls) else max(tool_calls)
                    slot = tool_calls.setdefault(idx, {"id": "", "name": "", "arguments": ""})
                    if tc.id:
                        slot["id"] = tc.id
                    if tc.function:
                        slot["name"] += tc.function.name or ""
                        slot["arguments"] += tc.function.arguments or ""
                if delta.content:
                    text += delta.content
                    if not tool_calls:
                        visible = _visible_prefix(text)
                        if len(visible) > sent:
                            yield {"type": "delta", "text": visible[sent:]}
                            sent = len(visible)
        finally:
            stream.close()

        if not tool_calls:
            final_text = text
            break

        if sent:
            yield {"type": "discard"}

        calls = [tool_calls[i] for i in sorted(tool_calls)]
        assistant_turn: Dict[str, Any] = {
            "role": "assistant",
            "tool_calls": [
                {"id": c["id"], "type": "function", "function": {"name": c["name"], "arguments": c["arguments"] or "{}"}}
                for c in calls
            ]
        }
        if text:
            assistant_turn["content"] = text
        messages_payload.append(assistant_turn)

        outputs: Dict[str, str] = {}
        for call in order_tool_calls(calls):
            fn_name = call["name"]
            try:
                args = json.loads(call["arguments"] or "{}")
            except json.JSONDecodeError:
                args = {}

            if fn_name == "upsert_guest_memory":
                res = upsert_user_memory(
                    db=db,
                    user_id=user_id,
                    conversation_id=conversation_id,
                    category=args.get("category", "ingredient"),
                    attribute=args.get("attribute", "unknown"),
                    value=args.get("value", "liked"),
                    tier=args.get("tier", "soft_preference"),
                    source_quote=args.get("source_quote", user_message),
                    reason=args.get("reason", "Updated from conversation")
                )
                memory_events.append(res)
                tool_output = json.dumps(res)
                yield {"type": "step", "kind": "memory", "label": _memory_step_label(res)}

            elif fn_name == "revoke_guest_memory":
                res = revoke_user_memory(
                    db=db,
                    user_id=user_id,
                    category=args.get("category", ""),
                    attribute=args.get("attribute", ""),
                    reason=args.get("reason", "User revoked preference")
                )
                memory_events.append(res)
                tool_output = json.dumps(res)
                yield {"type": "step", "kind": "memory", "label": _memory_step_label(res)}

            elif fn_name == "get_curated_menu_recommendations":
                res = evaluate_menu_for_user(
                    db=db,
                    user_id=user_id,
                    conversation_id=conversation_id,
                    category_filter=args.get("category_filter"),
                    override_max_price=args.get("override_max_price")
                )
                tool_output = json.dumps(res, ensure_ascii=False)
                yield {
                    "type": "step",
                    "kind": "menu",
                    "label": menu_step_label(res, memory_events)
                }

            elif fn_name == "confirm_visit_order":
                raw_ids = args.get("item_ids") or []
                if isinstance(raw_ids, str):
                    raw_ids = [part.strip() for part in raw_ids.split(",")]
                raw_ids = narrow_confirmed_ids(list(raw_ids), user_message, menu_data)
                res = confirm_order_for_visit(db, user_id, conversation_id, raw_ids)
                order_result = res
                tool_output = json.dumps(res)
                yield {"type": "step", "kind": "order", "label": _order_step_label(res)}

            else:
                tool_output = json.dumps({"error": f"Unknown tool {fn_name}"})

            outputs[call["id"]] = tool_output

        for call in calls:
            messages_payload.append({
                "role": "tool",
                "tool_call_id": call["id"],
                "name": call["name"],
                "content": outputs.get(call["id"], "{}")
            })

        if order_result and order_result.get("status") == "confirmed":
            break

    if order_result and order_result.get("status") == "confirmed":
        accepted_ids = [item["id"] for item in order_result.get("accepted") or []]
        clean_text = order_thanks(
            user_name,
            order_result,
            dishes_outside_lasting_profile(db, user_id, accepted_ids)
        )
        recommended_ids = []
        follow_ups = ["Something sweet to finish?", "That's everything, thank you"]
    else:
        clean_text, recommended_ids, follow_ups = _parse_final_text(final_text, menu_data)
        safe_ids = {
            item["id"]
            for item in evaluate_menu_for_user(db, user_id, conversation_id)["safe_recommendations"]
        }
        recommended_ids = ground_recommended_ids(recommended_ids, safe_ids)[:3]

    assistant_record = Message(
        conversation_id=conversation_id,
        role="assistant",
        content=clean_text,
        recommended_item_ids=recommended_ids,
        memory_events=memory_events
    )
    db.add(assistant_record)
    db.commit()
    db.refresh(assistant_record)
    record_turn(
        db,
        user_id=user_id,
        guest_name=user_name,
        conversation_id=conversation_id,
        model=active_model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        memory_events=memory_events,
        order_result=order_result,
    )

    yield {
        "type": "done",
        "message": {
            "id": assistant_record.id,
            "role": "assistant",
            "content": clean_text,
            "recommended_item_ids": recommended_ids,
            "memory_events": memory_events,
            "follow_ups": follow_ups,
            "created_at": assistant_record.created_at.isoformat()
        },
        "order": order_result,
        "active_model": active_model
    }

def run_agent_turn(
    db: Session,
    user_id: str,
    user_name: str,
    conversation_id: str,
    user_message: str,
    model_override: Optional[str] = None
) -> Dict[str, Any]:
    result: Dict[str, Any] = {}
    for event in stream_agent_turn(db, user_id, user_name, conversation_id, user_message, model_override):
        if event["type"] == "done":
            result = {
                "message": event["message"],
                "order": event.get("order"),
                "active_model": event["active_model"]
            }
    return result

