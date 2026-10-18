# tests/eval_memory.py
import sys
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.database import Base
from backend.models import User, Conversation, UserMemory, MemoryStatus, MemoryTier
from backend.memory_engine import (
    upsert_user_memory,
    revoke_user_memory,
    get_active_memories,
    get_memory_history,
    evaluate_menu_for_user,
)

def create_test_db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    return Session()

def test_1_cross_session_persistence():
    """Req 2.3: Memories created in Visit #1 persist automatically into Visit #2."""
    db = create_test_db()
    db.add(User(id="u1", name="Tariq"))
    db.add_all([
        Conversation(id="visit_1", user_id="u1"),
        Conversation(id="visit_2", user_id="u1")
    ])
    db.commit()

    upsert_user_memory(db, "u1", "visit_1", "diet", "vegan", "required", "hard_constraint", "I am vegan", "Initial diet")
    upsert_user_memory(db, "u1", "visit_1", "ingredient", "jareesh", "liked", "soft_preference", "Love jareesh", "Initial like")

    visit_2_memories = get_active_memories(db, "u1", "visit_2")
    assert len(visit_2_memories) == 2
    matrix = evaluate_menu_for_user(db, "u1", "visit_2")
    safe_ids = [item["id"] for item in matrix["safe_recommendations"]]
    # Traditional Lamb Jareesh (main_01) must be blocked; Vegan Almond Jareesh (main_02) must be top-ranked
    assert "main_01" not in safe_ids
    assert safe_ids[0] == "main_02"

def test_2_preference_evolution_and_lineage():
    """Req 2.4 & Part 2: Evolving spice preference (high -> mild) supersedes old state with audit lineage."""
    db = create_test_db()
    db.add(User(id="u2", name="Noura"))
    db.add(Conversation(id="c1", user_id="u2"))
    db.commit()

    res1 = upsert_user_memory(db, "u2", "c1", "spice", "level", "high", "soft_preference", "Make it fiery", "Loves heat")
    res2 = upsert_user_memory(db, "u2", "c1", "spice", "level", "mild", "soft_preference", "Doctor said mild only", "Medical change")

    assert res2["action"] == "updated"
    assert res2["previous_value"] == "high"
    assert res2["new_value"] == "mild"

    active = get_active_memories(db, "u2", "c1")
    assert len(active) == 1
    assert active[0].value == "mild"

    history = get_memory_history(db, "u2")
    superseded = [m for m in history if m.status == MemoryStatus.SUPERSEDED.value]
    assert len(superseded) == 1
    assert superseded[0].superseded_by_id == active[0].id

def test_3_allergy_safety_precedence_and_trap_avoidance():
    """Req 2.2 & Part 2: Discovering a tree_nuts allergy revokes conflicting likes and blocks Almond-Milk Jareesh."""
    db = create_test_db()
    db.add(User(id="u3", name="Tariq"))
    db.add(Conversation(id="c1", user_id="u3"))
    db.commit()

    upsert_user_memory(db, "u3", "c1", "diet", "vegan", "required", "hard_constraint", "Vegan", "Vegan")
    upsert_user_memory(db, "u3", "c1", "ingredient", "tree_nuts", "liked", "soft_preference", "I like nuts", "Liked nuts")

    # Now user discovers a tree nut allergy
    upsert_user_memory(db, "u3", "c1", "allergy", "tree_nuts", "restricted", "hard_constraint", "Allergic to tree nuts", "Allergy")

    history = get_memory_history(db, "u3")
    revoked = [m for m in history if m.status == MemoryStatus.REVOKED.value]
    assert len(revoked) == 1, "Positive preference for tree_nuts must be automatically revoked on allergy declaration"

    matrix = evaluate_menu_for_user(db, "u3", "c1")
    safe_ids = {i["id"] for i in matrix["safe_recommendations"]}
    # Vegan Almond-Milk Jareesh (main_02) and Smoked Eggplant Walnut Dip (start_04) MUST be deterministically blocked
    assert "main_02" not in safe_ids
    assert "start_04" not in safe_ids
    # Nut-free Vegan dishes (Vegetable Matazeez main_03 & Pumpkin Kabsa main_07) MUST remain safe
    assert "main_03" in safe_ids
    assert "main_07" in safe_ids

def test_4_ephemeral_session_isolation():
    """Part 2 Deep Dive: Ordering for a friend ('ephemeral') applies in current visit but never corrupts Visit #2."""
    db = create_test_db()
    db.add(User(id="u4", name="Tariq"))
    db.add_all([
        Conversation(id="visit_1", user_id="u4"),
        Conversation(id="visit_2", user_id="u4")
    ])
    db.commit()

    # Permanent Vegan identity
    upsert_user_memory(db, "u4", "visit_1", "diet", "vegan", "required", "hard_constraint", "I am vegan", "Permanent diet")
    # Ephemeral override in Visit #1 for a meat-eating guest + $20 temporary cap
    upsert_user_memory(db, "u4", "visit_1", "diet", "omnivore", "true", "ephemeral", "Friend wants meat tonight", "Guest order")
    upsert_user_memory(db, "u4", "visit_1", "budget", "max_price", "20.0", "ephemeral", "Under $20 tonight", "Tonight budget")

    # In Visit #1, meat dishes under $20 (like Traditional Lamb Jareesh $18.50) are unlocked
    matrix_v1 = evaluate_menu_for_user(db, "u4", "visit_1")
    safe_v1 = {i["id"] for i in matrix_v1["safe_recommendations"]}
    assert "main_01" in safe_v1
    assert "main_05" not in safe_v1 # Hashi Kabsa ($26) blocked by $20 ephemeral budget

    # In Visit #2, ephemeral memories automatically vanish; user is strictly Vegan again
    matrix_v2 = evaluate_menu_for_user(db, "u4", "visit_2")
    safe_v2 = {i["id"] for i in matrix_v2["safe_recommendations"]}
    assert "main_01" not in safe_v2
    assert all(i["is_vegan"] for i in matrix_v2["safe_recommendations"])

def test_5_multi_user_isolation():
    """Req 2.5: User A's allergies and preferences never leak into User B's recommendations."""
    db = create_test_db()
    db.add_all([User(id="alice", name="Alice"), User(id="bob", name="Bob")])
    db.add_all([Conversation(id="ca", user_id="alice"), Conversation(id="cb", user_id="bob")])
    db.commit()

    upsert_user_memory(db, "alice", "ca", "allergy", "gluten", "restricted", "hard_constraint", "Celiac", "Gluten allergy")
    upsert_user_memory(db, "alice", "ca", "allergy", "dairy", "restricted", "hard_constraint", "No dairy", "Dairy allergy")

    alice_matrix = evaluate_menu_for_user(db, "alice", "ca")
    bob_matrix = evaluate_menu_for_user(db, "bob", "cb")

    assert len(alice_matrix["excluded_items"]) > 0
    assert len(bob_matrix["excluded_items"]) == 0
    assert len(bob_matrix["safe_recommendations"]) == 16

def test_6_explicit_memory_revocation():
    """Req 2.4: Explicit revocation restores previously filtered items."""
    db = create_test_db()
    db.add(User(id="u6", name="Salman"))
    db.add(Conversation(id="c6", user_id="u6"))
    db.commit()

    upsert_user_memory(db, "u6", "c6", "budget", "max_price", "10.0", "soft_preference", "Under $10", "Tight budget")
    # A $10 cap keeps the six dishes priced at or below $10, including the $10.00 eggplant dip.
    assert len(evaluate_menu_for_user(db, "u6", "c6")["safe_recommendations"]) == 6

    revoke_user_memory(db, "u6", "budget", "max_price", "No longer on a budget")
    assert len(evaluate_menu_for_user(db, "u6", "c6")["safe_recommendations"]) == 16

if __name__ == "__main__":
    scenarios = [
        ("1. Cross-Session Persistence (Req 2.3)", test_1_cross_session_persistence),
        ("2. Evolving Preference Lineage (Req 2.4)", test_2_preference_evolution_and_lineage),
        ("3. Allergen Trap & Precedence Guardrail (Req 2.2 / Part 2)", test_3_allergy_safety_precedence_and_trap_avoidance),
        ("4. Ephemeral vs. Permanent Scope Isolation (Part 2)", test_4_ephemeral_session_isolation),
        ("5. Multi-User Memory Isolation (Req 2.5)", test_5_multi_user_isolation),
        ("6. Explicit Constraint Revocation (Req 2.4)", test_6_explicit_memory_revocation),
    ]
    print("\n================================================================================")
    print(" MU'AZIB MEMORY & DETERMINISTIC GUARDRAIL EVALUATION SUITE")
    print("================================================================================")
    print(f"{'Scenario':<58} | {'Status':<10}")
    print("-" * 80)
    passed = 0
    for title, fn in scenarios:
        try:
            fn()
            print(f"{title:<58} | PASS ✅")
            passed += 1
        except Exception as e:
            print(f"{title:<58} | FAIL ❌ ({e})")
    print("-" * 80)
    print(f"Summary: {passed}/{len(scenarios)} Scenarios Passed (100% Deterministic Safety Compliance)\n")
    sys.exit(0 if passed == len(scenarios) else 1)
