from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.models import MetricEvent

def _first_name(guest_name: str) -> str:
    return (guest_name or "Guest").split(" (")[0].split()[0] or "Guest"

def _order_event(user_id: str, guest_name: str, conversation_id: str, result: Dict[str, Any]) -> MetricEvent:
    status = result.get("status") or ""
    return MetricEvent(
        kind="order",
        user_id=user_id,
        guest_name=_first_name(guest_name),
        conversation_id=conversation_id,
        action=status,
        accepted_count=len(result.get("accepted") or []),
        refused_count=len(result.get("refused") or []),
    )

def record_turn(
    db: Session,
    user_id: str,
    guest_name: str,
    conversation_id: str,
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
    memory_events: Optional[List[Dict[str, Any]]] = None,
    order_result: Optional[Dict[str, Any]] = None,
) -> None:
    """Append one guest turn, plus any memory or order that happened inside it."""
    name = _first_name(guest_name)
    db.add(MetricEvent(
        kind="turn",
        user_id=user_id,
        guest_name=name,
        conversation_id=conversation_id,
        model=model or "",
        prompt_tokens=int(prompt_tokens or 0),
        completion_tokens=int(completion_tokens or 0),
    ))
    for event in memory_events or []:
        action = event.get("action")
        if action not in ("created", "updated", "revoked"):
            continue
        db.add(MetricEvent(
            kind="memory",
            user_id=user_id,
            guest_name=name,
            conversation_id=conversation_id,
            action=action,
            tier=event.get("tier") or "",
        ))
    if order_result and order_result.get("status") in ("confirmed", "refused_all"):
        db.add(_order_event(user_id, guest_name, conversation_id, order_result))
    db.commit()

def record_order(
    db: Session,
    user_id: str,
    guest_name: str,
    conversation_id: str,
    result: Dict[str, Any],
) -> None:
    """A confirm made from the tray, which never calls the model."""
    if result.get("status") not in ("confirmed", "refused_all"):
        return
    db.add(_order_event(user_id, guest_name, conversation_id, result))
    db.commit()

def _sum(db: Session, column, kind: str) -> int:
    value = db.query(func.coalesce(func.sum(column), 0)).filter(MetricEvent.kind == kind).scalar()
    return int(value or 0)

DAYS = 14

def _daily(db: Session, tz_offset_minutes: int, now: datetime) -> List[Dict[str, Any]]:
    """Turns and tokens for each of the last 14 days, in the viewer's local time."""
    shift = timedelta(minutes=tz_offset_minutes)
    today = (now + shift).date()
    first = today - timedelta(days=DAYS - 1)
    start_utc = datetime.combine(first, datetime.min.time()) - shift
    rows = (
        db.query(MetricEvent.created_at, MetricEvent.prompt_tokens, MetricEvent.completion_tokens)
        .filter(MetricEvent.kind == "turn", MetricEvent.created_at >= start_utc)
        .all()
    )
    days = {first + timedelta(days=i): {"turns": 0, "tokens": 0} for i in range(DAYS)}
    for created_at, prompt, completion in rows:
        if created_at is None:
            continue
        bucket = days.get((created_at + shift).date())
        if bucket is None:
            continue
        bucket["turns"] += 1
        bucket["tokens"] += int(prompt or 0) + int(completion or 0)
    return [{"date": day.isoformat(), **values} for day, values in sorted(days.items())]

def metrics_summary(db: Session, tz_offset_minutes: int = 0, now: Optional[datetime] = None) -> Dict[str, Any]:
    turns = db.query(MetricEvent).filter(MetricEvent.kind == "turn")
    turn_count = turns.count()
    prompt_tokens = _sum(db, MetricEvent.prompt_tokens, "turn")
    completion_tokens = _sum(db, MetricEvent.completion_tokens, "turn")
    with_usage = turns.filter((MetricEvent.prompt_tokens + MetricEvent.completion_tokens) > 0).count()
    guests = db.query(func.count(func.distinct(MetricEvent.user_id))).filter(MetricEvent.kind == "turn").scalar()
    visits = db.query(func.count(func.distinct(MetricEvent.conversation_id))).filter(MetricEvent.kind == "turn").scalar()

    model_rows = (
        db.query(
            MetricEvent.model,
            func.count(MetricEvent.id),
            func.coalesce(func.sum(MetricEvent.prompt_tokens + MetricEvent.completion_tokens), 0),
        )
        .filter(MetricEvent.kind == "turn")
        .group_by(MetricEvent.model)
        .all()
    )
    models = [
        {"model": model or "unknown", "turns": int(count), "tokens": int(tokens)}
        for model, count, tokens in sorted(model_rows, key=lambda row: (-row[2], row[0] or ""))
    ]

    def memory_count(action: str) -> int:
        return db.query(MetricEvent).filter(MetricEvent.kind == "memory", MetricEvent.action == action).count()

    tier_rows = (
        db.query(MetricEvent.tier, func.count(MetricEvent.id))
        .filter(MetricEvent.kind == "memory", MetricEvent.action.in_(("created", "updated")))
        .group_by(MetricEvent.tier)
        .all()
    )
    tiers = {"hard_constraint": 0, "soft_preference": 0, "ephemeral": 0}
    for tier, tier_count in tier_rows:
        if tier in tiers:
            tiers[tier] = int(tier_count)

    orders = db.query(MetricEvent).filter(MetricEvent.kind == "order")
    recent = (
        db.query(MetricEvent)
        .filter(MetricEvent.kind == "turn")
        .order_by(MetricEvent.id.desc())
        .limit(8)
        .all()
    )
    return {
        "guests": int(guests or 0),
        "visits": int(visits or 0),
        "turns": turn_count,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": prompt_tokens + completion_tokens,
        "turns_with_usage": with_usage,
        "avg_tokens_per_turn": round((prompt_tokens + completion_tokens) / with_usage) if with_usage else 0,
        "daily": _daily(db, tz_offset_minutes, now or datetime.utcnow()),
        "models": models,
        "memories": {
            "created": memory_count("created"),
            "updated": memory_count("updated"),
            "revoked": memory_count("revoked"),
            "tiers": tiers,
        },
        "orders": {
            "confirmed": orders.filter(MetricEvent.action == "confirmed").count(),
            "refused": orders.filter(MetricEvent.action == "refused_all").count(),
            "dishes_accepted": _sum(db, MetricEvent.accepted_count, "order"),
            "dishes_refused": _sum(db, MetricEvent.refused_count, "order"),
        },
        "recent": [
            {
                "guest": row.guest_name,
                "model": row.model,
                "tokens": int(row.prompt_tokens or 0) + int(row.completion_tokens or 0),
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in recent
        ],
    }
