from datetime import datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.database import Base
from backend.metrics import metrics_summary, record_order, record_turn
from backend.models import MetricEvent


def create_test_db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine)()


def test_summary_counts_guests_tokens_memories_and_orders():
    db = create_test_db()
    record_turn(
        db, "g1", "Tariq Al-iban (Returning Vegan Guest)", "c1", "deepseek/x", 100, 20,
        [
            {"action": "created", "tier": "hard_constraint"},
            {"action": "unchanged", "tier": "ephemeral"},
        ],
        {"status": "confirmed", "accepted": [{"id": "main_02"}], "refused": []},
    )
    record_turn(db, "g1", "Tariq", "c2", "other/model", 0, 0, None, None)
    record_turn(
        db, "g2", "Noura Al-Sudairi (Dairy-Free & Spicy)", "c3", "deepseek/x", 50, 10,
        [
            {"action": "updated", "tier": "soft_preference"},
            {"action": "revoked", "tier": "soft_preference"},
        ],
        {"status": "refused_all", "accepted": [], "refused": [{"id": "main_01"}]},
    )
    record_order(
        db, "g2", "Noura", "c3",
        {"status": "confirmed", "accepted": [{}, {}], "refused": [{}]},
    )

    summary = metrics_summary(db)
    assert summary["guests"] == 2
    assert summary["visits"] == 3
    assert summary["turns"] == 3
    assert summary["prompt_tokens"] == 150
    assert summary["completion_tokens"] == 30
    assert summary["total_tokens"] == 180
    assert summary["turns_with_usage"] == 2
    assert summary["memories"] == {
        "created": 1,
        "updated": 1,
        "revoked": 1,
        "tiers": {"hard_constraint": 1, "soft_preference": 1, "ephemeral": 0},
    }
    assert summary["orders"]["confirmed"] == 2
    assert summary["orders"]["refused"] == 1
    assert summary["orders"]["dishes_accepted"] == 3
    assert summary["orders"]["dishes_refused"] == 2
    assert summary["recent"][0]["guest"] == "Noura"
    by_model = {row["model"]: row for row in summary["models"]}
    assert by_model["deepseek/x"] == {"model": "deepseek/x", "turns": 2, "tokens": 180}
    assert by_model["other/model"]["tokens"] == 0


def test_days_tiers_and_average_are_grouped_for_the_viewer():
    db = create_test_db()
    record_turn(
        db, "g1", "Tariq", "c1", "m", 90, 10,
        [
            {"action": "created", "tier": "hard_constraint"},
            {"action": "updated", "tier": "soft_preference"},
            {"action": "created", "tier": "ephemeral"},
            {"action": "revoked", "tier": "soft_preference"},
        ],
        None,
    )
    record_turn(db, "g1", "Tariq", "c1", "m", 0, 0, None, None)
    record_turn(db, "g2", "Noura", "c2", "m", 150, 50, None, None)
    rows = db.query(MetricEvent).filter(MetricEvent.kind == "turn").order_by(MetricEvent.id).all()
    rows[0].created_at = datetime(2026, 10, 18, 22, 30)
    rows[1].created_at = datetime(2026, 10, 18, 20, 0)
    rows[2].created_at = datetime(2026, 10, 1, 12, 0)
    db.commit()

    summary = metrics_summary(db, tz_offset_minutes=180, now=datetime(2026, 10, 18, 22, 45))
    daily = summary["daily"]
    assert len(daily) == 14
    assert daily[-1] == {"date": "2026-10-19", "turns": 1, "tokens": 100}
    assert daily[-2] == {"date": "2026-10-18", "turns": 1, "tokens": 0}
    assert sum(day["turns"] for day in daily) == 2
    assert summary["memories"]["tiers"] == {"hard_constraint": 1, "soft_preference": 1, "ephemeral": 1}
    assert summary["avg_tokens_per_turn"] == 150


def test_reset_keeps_the_ledger():
    from backend.main import reset_demo

    db = create_test_db()
    record_turn(
        db, "g1", "Tariq", "c1", "deepseek/x", 10, 5,
        [{"action": "created", "tier": "hard_constraint"}],
        None,
    )
    before = db.query(MetricEvent).count()

    reset_demo(db)

    assert db.query(MetricEvent).count() == before
    assert metrics_summary(db)["turns"] == 1
    assert metrics_summary(db)["total_tokens"] == 15
    assert metrics_summary(db)["memories"]["created"] == 1
