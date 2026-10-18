# backend/models.py
from datetime import datetime
from enum import Enum
from typing import Optional, List
from pydantic import BaseModel, Field
from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, Text, JSON, Float
from backend.database import Base

class MemoryTier(str, Enum):
    HARD_CONSTRAINT = "hard_constraint"   # Allergies, strict vegan/vegetarian, strict medical/religious rules
    SOFT_PREFERENCE = "soft_preference"   # Spice tolerance, liked/disliked ingredients, usual budget
    EPHEMERAL_CONTEXT = "ephemeral"       # Session-only context: "ordering for a friend", "light meal tonight"

class MemoryStatus(str, Enum):
    ACTIVE = "active"
    SUPERSEDED = "superseded"             # Overwritten by a newer preference update
    REVOKED = "revoked"                   # Explicitly removed by the user or invalidated by a hard constraint

class User(Base):
    __tablename__ = "users"
    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    avatar_role = Column(String, default="Guest")
    created_at = Column(DateTime, default=datetime.utcnow)

class Conversation(Base):
    __tablename__ = "conversations"
    id = Column(String, primary_key=True, index=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String, default="Visit to Dar Najd")
    created_at = Column(DateTime, default=datetime.utcnow)

class Message(Base):
    __tablename__ = "messages"
    id = Column(Integer, primary_key=True, autoincrement=True)
    conversation_id = Column(String, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(String, nullable=False) # "user" or "assistant"
    content = Column(Text, nullable=False)
    recommended_item_ids = Column(JSON, default=list) # Grounded item IDs shown in UI cards
    memory_events = Column(JSON, default=list)        # Audit log of memory mutations triggered in this turn
    created_at = Column(DateTime, default=datetime.utcnow)

class MetricEvent(Base):
    """A count that outlives the demo. Reset deletes guests and chats, not these rows."""
    __tablename__ = "metric_events"
    id = Column(Integer, primary_key=True, autoincrement=True)
    kind = Column(String, nullable=False, index=True)  # turn | memory | order
    user_id = Column(String, nullable=False, index=True)
    guest_name = Column(String, default="")
    conversation_id = Column(String, default="")
    model = Column(String, default="")
    prompt_tokens = Column(Integer, default=0)
    completion_tokens = Column(Integer, default=0)
    action = Column(String, default="")  # created | updated | revoked | confirmed | refused_all
    tier = Column(String, default="")
    accepted_count = Column(Integer, default=0)
    refused_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

class VisitOrder(Base):
    __tablename__ = "visit_orders"
    id = Column(Integer, primary_key=True, autoincrement=True)
    conversation_id = Column(String, ForeignKey("conversations.id", ondelete="CASCADE"), unique=True, nullable=False, index=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    item_ids = Column(JSON, default=list)
    refused = Column(JSON, default=list)
    total_price = Column(Float, default=0.0)
    updated_at = Column(DateTime, default=datetime.utcnow)

class UserMemory(Base):
    __tablename__ = "user_memories"
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    conversation_id = Column(String, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=True, index=True)

    # Normalized composite key: (category, attribute)
    category = Column(String, nullable=False)   # allergy | diet | spice | ingredient | budget | tag_preference
    attribute = Column(String, nullable=False)  # gluten | dairy | tree_nuts | sesame | eggs | vegan | vegetarian | level | max_price | <ingredient_name>
    value = Column(String, nullable=False)      # restricted | required | none | mild | medium | high | liked | disliked | <float_str>

    tier = Column(String, nullable=False, default=MemoryTier.SOFT_PREFERENCE.value)
    status = Column(String, nullable=False, default=MemoryStatus.ACTIVE.value)

    source_quote = Column(Text, nullable=True)
    reason = Column(Text, nullable=True)
    superseded_by_id = Column(Integer, ForeignKey("user_memories.id"), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
