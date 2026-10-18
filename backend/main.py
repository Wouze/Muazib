# backend/main.py
import json
import mimetypes
import os
import uuid
from datetime import datetime, timedelta
from typing import List, Optional
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.config import settings
from backend.database import engine, Base, get_db, SessionLocal
from backend.models import User, Conversation, Message, UserMemory, VisitOrder
from backend.memory_engine import (
    load_menu,
    get_active_memories,
    get_memory_history,
    evaluate_menu_for_user,
    upsert_user_memory,
    confirm_order_for_visit,
    last_confirmed_order,
    revalidate_order,
    order_thanks,
    record_order_thanks,
    visit_company_quote
)
from backend.agent import run_agent_turn, stream_agent_turn
from backend.metrics import metrics_summary, record_order

app = FastAPI(title=settings.PROJECT_NAME)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def _seed_transcript(db: Session, conversation_id: str, start: datetime, turns) -> None:
    """A finished visit: a few real turns, a minute apart, ending in the thank-you."""
    for index, (role, content, item_ids, events) in enumerate(turns):
        db.add(Message(
            conversation_id=conversation_id,
            role=role,
            content=content,
            recommended_item_ids=item_ids,
            memory_events=events,
            created_at=start + timedelta(minutes=index)
        ))
    db.commit()

def seed_initial_personas(db: Optional[Session] = None):
    own_session = db is None
    if own_session:
        db = SessionLocal()
    try:
        if db.query(User).count() > 0:
            return

        # 1. Tariq (Returning Vegan Jareesh Lover - great for testing allergen conflict resolution)
        tariq = User(id="guest_tariq", name="Tariq Al-iban (Returning Vegan Guest)", avatar_role="Returning Guest")
        # 2. Noura (Returning Dairy-Free Spice Lover - great for testing evolving spice preference)
        noura = User(id="guest_noura", name="Noura Al-Sudairi (Dairy-Free & Spicy)", avatar_role="VIP Regular")
        # 3. Fresh Guest (Clean slate for natural discovery)
        salman = User(id="guest_salman", name="Salman (First-Time Visitor)", avatar_role="New Guest")

        db.add_all([tariq, noura, salman])
        db.commit()

        tonight = datetime.utcnow()
        earlier = tonight - timedelta(days=11)
        conv_t = Conversation(
            id="conv_tariq_1", user_id=tariq.id, title="Visit #1 - The vegan jareesh", created_at=earlier
        )
        conv_t_now = Conversation(
            id="conv_tariq_2", user_id=tariq.id, title="Visit #2 - Tonight", created_at=tonight
        )
        conv_n = Conversation(
            id="conv_noura_1", user_id=noura.id, title="Visit #1 - Spicy kabsa", created_at=earlier
        )
        conv_n_now = Conversation(
            id="conv_noura_2", user_id=noura.id, title="Visit #2 - Tonight", created_at=tonight
        )
        conv_s = Conversation(
            id="conv_salman_1", user_id=salman.id, title="Visit #1 - First Welcome", created_at=tonight
        )
        db.add_all([conv_t, conv_t_now, conv_n, conv_n_now, conv_s])
        db.commit()

        tariq_diet = upsert_user_memory(
            db, tariq.id, conv_t.id, "diet", "vegan", "required", "hard_constraint",
            "I follow a strict vegan diet.", "Stated strict vegan diet during Visit #1"
        )
        tariq_jareesh = upsert_user_memory(
            db, tariq.id, conv_t.id, "ingredient", "jareesh", "liked", "soft_preference",
            "I really love traditional crushed wheat Jareesh.", "Expressed strong fondness for Jareesh"
        )
        noura_dairy = upsert_user_memory(
            db, noura.id, conv_n.id, "allergy", "dairy", "restricted", "hard_constraint",
            "I have a severe dairy allergy, no laban or ghee please.", "Severe dairy allergy"
        )
        noura_spice = upsert_user_memory(
            db, noura.id, conv_n.id, "spice", "level", "high", "soft_preference",
            "Give me the hottest Shaqra chili dishes you have!", "Loves fiery high spice levels"
        )

        tariq_order = confirm_order_for_visit(db, tariq.id, conv_t.id, ["main_02"])
        noura_order = confirm_order_for_visit(db, noura.id, conv_n.id, ["main_06", "side_01"])
        _seed_transcript(db, conv_t.id, earlier, [
            ("user", "I'm vegan, and I really love traditional crushed wheat jareesh. What should I have tonight?", [], []),
            ("assistant", (
                "Welcome, Tariq. I'll keep the table vegan, and I'll start with the jareesh you love.\n\n"
                "- **Vegan Almond-Milk & Wild Mushroom Jareesh** — crushed wheat, cooked in almond milk\n"
                "- **Roasted Najdi Pumpkin & Chickpea Kabsa** — fragrant, and fully vegan\n"
                "- **Najdi Pumpkin & Red Lentil Soup** — a warm start\n\n"
                "Shall I set aside the vegan jareesh?"
            ), ["main_02", "main_07", "start_02"], [tariq_diet, tariq_jareesh]),
            ("user", "The vegan jareesh, please.", [], []),
            ("assistant", order_thanks(tariq.name, tariq_order), [], []),
        ])
        _seed_transcript(db, conv_n.id, earlier, [
            ("user", "I have a severe dairy allergy, no laban or ghee. And give me the hottest Shaqra chili you have.", [], []),
            ("assistant", (
                "Noted, Noura — no dairy, and as much Shaqra heat as the kitchen has.\n\n"
                "- **Fiery Shaqra Chicken Kabsa** — grilled chicken, saffron rice, and a chili crust\n"
                "- **Fiery Green Maabouj & Tomato Daqoos** — the hot sauce beside it\n\n"
                "Shall I set those two aside?"
            ), ["main_06", "side_01"], [noura_dairy, noura_spice]),
            ("user", "The chicken kabsa and the green maabouj.", [], []),
            ("assistant", order_thanks(noura.name, noura_order), [], []),
        ])
    finally:
        if own_session:
            db.close()

def reset_demo(db: Session):
    """Delete every guest, visit, chat, memory, and order, then restore the starting demo."""
    db.query(Message).delete(synchronize_session=False)
    db.query(UserMemory).delete(synchronize_session=False)
    db.query(VisitOrder).delete(synchronize_session=False)
    db.query(Conversation).delete(synchronize_session=False)
    db.query(User).delete(synchronize_session=False)
    db.commit()
    seed_initial_personas(db)

@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    seed_initial_personas()

# --- REQUEST SCHEMAS ---
class CreateUserRequest(BaseModel):
    name: str

class CreateConversationRequest(BaseModel):
    user_id: str
    title: Optional[str] = None

class ChatRequest(BaseModel):
    user_id: str
    conversation_id: str
    message: str
    model_override: Optional[str] = None

# --- API ENDPOINTS ---
@app.get("/api/config")
def get_app_config():
    return {
        "project_name": settings.PROJECT_NAME,
        "default_model": settings.LLM_MODEL,
        "has_api_key": bool(settings.OPENROUTER_API_KEY)
    }

@app.get("/api/menu")
def get_full_menu():
    return load_menu()

@app.get("/api/users")
def list_users(db: Session = Depends(get_db)):
    users = db.query(User).order_by(User.created_at.asc()).all()
    return [
        {"id": u.id, "name": u.name, "avatar_role": u.avatar_role}
        for u in users
    ]

@app.post("/api/users")
def create_user(req: CreateUserRequest, db: Session = Depends(get_db)):
    user_id = f"guest_{uuid.uuid4().hex[:6]}"
    new_user = User(id=user_id, name=req.name.strip(), avatar_role="New Guest")
    db.add(new_user)
    db.commit()

    conv = Conversation(id=f"conv_{uuid.uuid4().hex[:8]}", user_id=user_id, title="Visit #1 - First Welcome")
    db.add(conv)
    db.commit()
    return {"id": new_user.id, "name": new_user.name, "avatar_role": new_user.avatar_role, "conversation_id": conv.id}

@app.get("/api/users/{user_id}/conversations")
def list_user_conversations(user_id: str, db: Session = Depends(get_db)):
    convs = (
        db.query(Conversation)
        .filter(Conversation.user_id == user_id)
        .order_by(Conversation.created_at.desc())
        .all()
    )
    return [
        {"id": c.id, "title": c.title, "created_at": c.created_at.isoformat()}
        for c in convs
    ]

@app.post("/api/conversations")
def start_new_conversation(req: CreateConversationRequest, db: Session = Depends(get_db)):
    count = db.query(Conversation).filter(Conversation.user_id == req.user_id).count()
    conv = Conversation(
        id=f"conv_{uuid.uuid4().hex[:8]}",
        user_id=req.user_id,
        title=req.title or f"Visit #{count + 1} - Returning Session"
    )
    db.add(conv)
    db.commit()
    return {"id": conv.id, "title": conv.title, "created_at": conv.created_at.isoformat()}

@app.get("/api/conversations/{conversation_id}/messages")
def get_conversation_messages(conversation_id: str, db: Session = Depends(get_db)):
    msgs = (
        db.query(Message)
        .filter(Message.conversation_id == conversation_id)
        .order_by(Message.id.asc())
        .all()
    )
    return [
        {
            "id": m.id,
            "role": m.role,
            "content": m.content,
            "recommended_item_ids": m.recommended_item_ids or [],
            "memory_events": m.memory_events or [],
            "created_at": m.created_at.isoformat()
        }
        for m in msgs
    ]

@app.get("/api/users/{user_id}/memories")
def get_user_memory_state(user_id: str, conversation_id: Optional[str] = None, db: Session = Depends(get_db)):
    active = get_active_memories(db, user_id, conversation_id)
    history = get_memory_history(db, user_id)
    return {
        "active": [
            {
                "id": m.id,
                "category": m.category,
                "attribute": m.attribute,
                "value": m.value,
                "tier": m.tier,
                "status": m.status,
                "source_quote": m.source_quote,
                "reason": m.reason,
                "updated_at": m.updated_at.isoformat()
            }
            for m in active
        ],
        "audit_trail": [
            {
                "id": m.id,
                "category": m.category,
                "attribute": m.attribute,
                "value": m.value,
                "tier": m.tier,
                "status": m.status,
                "source_quote": m.source_quote,
                "reason": m.reason,
                "superseded_by_id": m.superseded_by_id,
                "updated_at": m.updated_at.isoformat()
            }
            for m in history
        ]
    }

@app.get("/api/users/{user_id}/menu-matrix")
def get_user_menu_matrix(user_id: str, conversation_id: Optional[str] = None, db: Session = Depends(get_db)):
    return evaluate_menu_for_user(db, user_id, conversation_id)

class OrderRequest(BaseModel):
    item_ids: List[str] = []

def _menu_by_id():
    return {item["id"]: item for item in load_menu()}

def _order_payload(order: Optional[VisitOrder]):
    if order is None:
        return None
    menu = _menu_by_id()
    items = []
    for item_id in order.item_ids or []:
        source = menu.get(item_id)
        items.append({
            "id": item_id,
            "name": source["name"] if source else item_id,
            "price": source["price"] if source else 0
        })
    return {
        "conversation_id": order.conversation_id,
        "items": items,
        "refused": order.refused or [],
        "total_price": order.total_price,
        "updated_at": order.updated_at.isoformat() if order.updated_at else None
    }

def _conversation_or_404(db: Session, conversation_id: str) -> Conversation:
    conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    return conv

@app.get("/api/conversations/{conversation_id}/order")
def get_visit_order(conversation_id: str, db: Session = Depends(get_db)):
    conv = _conversation_or_404(db, conversation_id)
    order = db.query(VisitOrder).filter(VisitOrder.conversation_id == conversation_id).first()
    previous = last_confirmed_order(db, conv.user_id, conversation_id)
    previous_payload = None
    if previous is not None:
        previous_conv = db.query(Conversation).filter(Conversation.id == previous.conversation_id).first()
        previous_payload = {
            "conversation_id": previous.conversation_id,
            "title": previous_conv.title if previous_conv else "",
            "for_company": bool(visit_company_quote(db, previous.conversation_id)),
            "items": revalidate_order(db, conv.user_id, conversation_id, previous)
        }
    return {"order": _order_payload(order), "previous": previous_payload}

def _message_payload(message: Message):
    return {
        "id": message.id,
        "role": message.role,
        "content": message.content,
        "recommended_item_ids": message.recommended_item_ids or [],
        "memory_events": message.memory_events or [],
        "created_at": message.created_at.isoformat()
    }

@app.post("/api/conversations/{conversation_id}/order")
def post_visit_order(conversation_id: str, req: OrderRequest, db: Session = Depends(get_db)):
    conv = _conversation_or_404(db, conversation_id)
    result = confirm_order_for_visit(db, conv.user_id, conversation_id, req.item_ids)
    if result["status"] != "confirmed":
        return result
    guest = db.query(User).filter(User.id == conv.user_id).first()
    guest_name = guest.name if guest else "Guest"
    record_order(db, conv.user_id, guest_name, conversation_id, result)
    record = record_order_thanks(db, conversation_id, guest_name, result)
    if record is not None:
        result["message"] = _message_payload(record)
    return result

@app.post("/api/chat")
def chat_endpoint(req: ChatRequest, db: Session = Depends(get_db)):
    if not settings.OPENROUTER_API_KEY:
        raise HTTPException(status_code=500, detail="OPENROUTER_API_KEY is not configured.")
    user = db.query(User).filter(User.id == req.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Guest not found.")

    result = run_agent_turn(
        db=db,
        user_id=user.id,
        user_name=user.name,
        conversation_id=req.conversation_id,
        user_message=req.message,
        model_override=req.model_override
    )
    return result

@app.post("/api/chat/stream")
def chat_stream_endpoint(req: ChatRequest, db: Session = Depends(get_db)):
    """Same turn as /api/chat, sent as Server-Sent Events while it runs."""
    if not settings.OPENROUTER_API_KEY:
        raise HTTPException(status_code=500, detail="OPENROUTER_API_KEY is not configured.")
    user = db.query(User).filter(User.id == req.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Guest not found.")
    user_id, user_name = user.id, user.name

    def event_source():
        # The request-scoped session is closed before a streamed body is sent, so the stream owns its own.
        stream_db = SessionLocal()
        try:
            for event in stream_agent_turn(
                db=stream_db,
                user_id=user_id,
                user_name=user_name,
                conversation_id=req.conversation_id,
                user_message=req.message,
                model_override=req.model_override
            ):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as exc:
            detail = getattr(exc, "message", None) or str(exc) or "The model request failed."
            yield f"data: {json.dumps({'type': 'error', 'detail': detail}, ensure_ascii=False)}\n\n"
        finally:
            stream_db.close()

    return StreamingResponse(
        event_source(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )

@app.get("/api/admin/metrics")
def admin_metrics(tz_offset_minutes: int = 0, db: Session = Depends(get_db)):
    """Totals for the host. Reset does not clear them. Days are grouped in the viewer's time zone."""
    return metrics_summary(db, max(-840, min(840, tz_offset_minutes)))

@app.post("/api/reset-demo")
def reset_demo_data(db: Session = Depends(get_db)):
    """Allows reviewers to reset the database back to clean initial demo personas at any time."""
    reset_demo(db)
    return {"status": "reset_complete"}

# Mount compiled frontend in production (Docker / Coolify)
DIST_DIR = os.path.abspath("frontend/dist")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("application/manifest+json", ".webmanifest")

if os.path.isdir(DIST_DIR):
    app.mount("/assets", StaticFiles(directory=os.path.join(DIST_DIR, "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404)
        candidate = os.path.abspath(os.path.join(DIST_DIR, full_path))
        if candidate.startswith(DIST_DIR + os.sep) and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(os.path.join(DIST_DIR, "index.html"))
