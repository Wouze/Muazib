import sys
from datetime import datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.database import Base
from backend.models import Conversation, Message, User, UserMemory, VisitOrder
from backend.memory_engine import (
    confirm_order_for_visit,
    dishes_outside_lasting_profile,
    last_confirmed_order,
    load_menu,
    order_thanks,
    record_order_thanks,
    revalidate_order,
    upsert_user_memory,
    visit_company_quote,
)
from backend.agent import (
    _parse_final_text,
    dishes_named_in,
    format_last_order,
    ground_recommended_ids,
    menu_step_label,
    narrow_confirmed_ids,
    order_tool_calls,
)


def create_test_db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine)()


def guest(db, user_id="u1", conv_id="c1", title="Visit"):
    db.add(User(id=user_id, name="Guest"))
    db.add(Conversation(id=conv_id, user_id=user_id, title=title))
    db.commit()


def stamp(db, conv_id, when):
    db.query(Conversation).filter(Conversation.id == conv_id).one().created_at = when
    db.commit()


def vegan(db, user_id="u1", conv_id="c1"):
    upsert_user_memory(
        db, user_id, conv_id, "diet", "vegan", "required", "hard_constraint", "I am vegan", "diet"
    )


def tree_nuts(db, user_id="u1", conv_id="c1"):
    upsert_user_memory(
        db, user_id, conv_id, "allergy", "tree_nuts", "restricted", "hard_constraint",
        "I have a tree nut allergy", "allergy"
    )


def test_1_confirm_saves_safe_dishes_in_order():
    db = create_test_db()
    guest(db)
    vegan(db)
    result = confirm_order_for_visit(db, "u1", "c1", ["main_02", "main_07"])
    assert result["status"] == "confirmed"
    assert [item["id"] for item in result["accepted"]] == ["main_02", "main_07"]
    assert result["total_price"] == 30.5
    stored = db.query(VisitOrder).filter(VisitOrder.conversation_id == "c1").one()
    assert stored.item_ids == ["main_02", "main_07"]
    assert stored.total_price == 30.5


def test_2_allergy_keeps_the_safe_dish_and_refuses_the_other():
    db = create_test_db()
    guest(db)
    vegan(db)
    tree_nuts(db)
    result = confirm_order_for_visit(db, "u1", "c1", ["main_02", "main_07"])
    assert result["status"] == "confirmed"
    assert [item["id"] for item in result["accepted"]] == ["main_07"]
    assert result["total_price"] == 14.5
    refused = result["refused"][0]
    assert refused["id"] == "main_02"
    assert any("tree_nuts" in reason for reason in refused["reasons"])
    stored = db.query(VisitOrder).filter(VisitOrder.conversation_id == "c1").one()
    assert stored.item_ids == ["main_07"]


def test_3_refusing_everything_keeps_the_existing_order():
    db = create_test_db()
    guest(db)
    vegan(db)
    confirm_order_for_visit(db, "u1", "c1", ["main_07"])
    tree_nuts(db)
    result = confirm_order_for_visit(db, "u1", "c1", ["main_02"])
    assert result["status"] == "refused_all"
    assert result["kept_existing"] is True
    assert result["accepted"] == []
    stored = db.query(VisitOrder).filter(VisitOrder.conversation_id == "c1").one()
    assert stored.item_ids == ["main_07"]


def test_4_duplicates_and_blanks_collapse():
    db = create_test_db()
    guest(db)
    vegan(db)
    result = confirm_order_for_visit(db, "u1", "c1", ["main_07", "main_07", ""])
    assert [item["id"] for item in result["accepted"]] == ["main_07"]
    stored = db.query(VisitOrder).filter(VisitOrder.conversation_id == "c1").one()
    assert stored.item_ids == ["main_07"]


def test_5_unknown_id_is_refused_and_the_safe_dish_is_saved():
    db = create_test_db()
    guest(db)
    vegan(db)
    result = confirm_order_for_visit(db, "u1", "c1", ["no_such_dish", "main_07"])
    assert [item["id"] for item in result["accepted"]] == ["main_07"]
    unknown = next(item for item in result["refused"] if item["id"] == "no_such_dish")
    assert unknown["reasons"] == ["Not on the menu"]


def test_6_last_visit_is_rechecked_without_changing_it():
    db = create_test_db()
    guest(db, conv_id="a", title="Visit A")
    db.add(Conversation(id="b", user_id="u1", title="Visit B"))
    db.commit()
    now = datetime.utcnow()
    stamp(db, "a", now - timedelta(days=1))
    stamp(db, "b", now)
    vegan(db, conv_id="a")
    confirm_order_for_visit(db, "u1", "a", ["main_02", "main_07"])
    tree_nuts(db, conv_id="b")
    previous = last_confirmed_order(db, "u1", "b")
    assert previous.conversation_id == "a"
    checked = {item["id"]: item for item in revalidate_order(db, "u1", "b", previous)}
    assert checked["main_02"]["still_safe"] is False
    assert any("tree_nuts" in reason for reason in checked["main_02"]["reasons"])
    assert checked["main_07"]["still_safe"] is True
    stored = db.query(VisitOrder).filter(VisitOrder.conversation_id == "a").one()
    assert stored.item_ids == ["main_02", "main_07"]


def test_7_ephemeral_meat_order_does_not_survive_the_next_visit():
    db = create_test_db()
    guest(db, conv_id="tonight")
    db.add(Conversation(id="tomorrow", user_id="u1", title="Tomorrow"))
    db.commit()
    now = datetime.utcnow()
    stamp(db, "tonight", now - timedelta(days=1))
    stamp(db, "tomorrow", now)
    vegan(db, conv_id="tonight")
    upsert_user_memory(
        db, "u1", "tonight", "diet", "meat_allowed", "true", "ephemeral",
        "Ordering for a friend who eats meat", "this visit only"
    )
    result = confirm_order_for_visit(db, "u1", "tonight", ["main_01"])
    assert result["status"] == "confirmed"
    assert result["accepted"][0]["id"] == "main_01"
    previous = last_confirmed_order(db, "u1", "tomorrow")
    checked = revalidate_order(db, "u1", "tomorrow", previous)[0]
    assert checked["id"] == "main_01"
    assert checked["still_safe"] is False


def test_11_reset_clears_chats_orders_and_extra_guests():
    from backend.main import reset_demo

    db = create_test_db()
    guest(db, user_id="extra", conv_id="extra_visit", title="A visit that should vanish")
    db.add(Message(conversation_id="extra_visit", role="assistant", content="حيّاك الله. Thank you."))
    db.commit()
    confirm_order_for_visit(db, "extra", "extra_visit", ["main_07"])

    reset_demo(db)

    assert sorted(user.id for user in db.query(User).all()) == ["guest_noura", "guest_salman", "guest_tariq"]
    assert sorted(conv.id for conv in db.query(Conversation).all()) == [
        "conv_noura_1", "conv_noura_2", "conv_salman_1", "conv_tariq_1", "conv_tariq_2"
    ]
    assert db.query(Message).filter(Message.conversation_id == "conv_tariq_1").count() == 4
    assert db.query(Message).filter(Message.conversation_id == "conv_tariq_2").count() == 0
    assert db.query(Message).filter(Message.conversation_id == "conv_noura_1").count() == 4
    assert db.query(Message).filter(Message.conversation_id == "conv_noura_2").count() == 0
    assert db.query(Message).filter(Message.conversation_id == "conv_salman_1").count() == 0
    assert db.query(Message).filter(Message.conversation_id == "extra_visit").count() == 0
    tariq_order = db.query(VisitOrder).filter(VisitOrder.conversation_id == "conv_tariq_1").one()
    assert tariq_order.item_ids == ["main_02"]
    assert db.query(VisitOrder).filter(VisitOrder.conversation_id == "conv_tariq_2").one_or_none() is None
    noura_order = db.query(VisitOrder).filter(VisitOrder.conversation_id == "conv_noura_1").one()
    assert noura_order.item_ids == ["main_06", "side_01"]
    assert db.query(VisitOrder).filter(VisitOrder.conversation_id == "conv_noura_2").one_or_none() is None
    assert last_confirmed_order(db, "guest_tariq", "conv_tariq_2").conversation_id == "conv_tariq_1"
    assert last_confirmed_order(db, "guest_tariq", "conv_tariq_1") is None
    assert db.query(UserMemory).filter(UserMemory.user_id == "extra").count() == 0


def test_10_confirmed_order_thanks_the_guest_and_names_the_table():
    text = order_thanks(
        "Tariq Al-iban (Returning Vegan Guest)",
        {
            "accepted": [{
                "id": "main_07",
                "name": "Roasted Najdi Pumpkin & Chickpea Kabsa (كبسة)",
                "price": 14.5
            }],
            "refused": [{
                "id": "main_02",
                "name": "Vegan Almond-Milk & Wild Mushroom Jareesh (جريش)",
                "reasons": ["Contains restricted allergen(s): tree_nuts"]
            }],
            "total_price": 14.5
        }
    )
    assert text.startswith("حيّاك الله.")
    assert "Tariq, your table is ready:" in text
    assert "**Roasted Najdi Pumpkin & Chickpea Kabsa** — $14.50" in text
    assert "**Total $14.50.**" in text
    assert "Thank you for dining at Dar Najd tonight" in text
    assert "I left Vegan Almond-Milk & Wild Mushroom Jareesh off the order: Contains restricted allergen(s): tree_nuts." in text


def test_12_a_later_meal_is_not_treated_as_the_past():
    db = create_test_db()
    guest(db, conv_id="older")
    db.add(Conversation(id="newer", user_id="u1", title="Newer"))
    db.commit()
    now = datetime.utcnow()
    stamp(db, "older", now - timedelta(days=2))
    stamp(db, "newer", now)
    vegan(db, conv_id="older")
    confirm_order_for_visit(db, "u1", "newer", ["main_07"])
    assert last_confirmed_order(db, "u1", "older") is None
    confirm_order_for_visit(db, "u1", "older", ["main_02"])
    previous = last_confirmed_order(db, "u1", "newer")
    assert previous.conversation_id == "older"


def test_13_a_friend_dish_is_not_called_the_guests_own():
    db = create_test_db()
    guest(db, conv_id="tonight")
    db.add(Conversation(id="tomorrow", user_id="u1", title="Tomorrow"))
    db.commit()
    now = datetime.utcnow()
    stamp(db, "tonight", now - timedelta(days=1))
    stamp(db, "tomorrow", now)
    vegan(db, conv_id="tonight")
    upsert_user_memory(
        db, "u1", "tonight", "diet", "omnivore", "true", "ephemeral",
        "My friend wants a rich traditional meat dish.", "this visit only"
    )
    confirm_order_for_visit(db, "u1", "tonight", ["main_04"])
    previous = last_confirmed_order(db, "u1", "tomorrow")
    quote = visit_company_quote(db, previous.conversation_id)
    text = format_last_order(revalidate_order(db, "u1", "tomorrow", previous), quote)
    assert "Said at that table: My friend wants a rich traditional meat dish." in text
    assert "not for this guest" in text
    assert "Do not call it their old dish" in text
    assert "Braised Lamb & Pine Nut Qursan" in text


def test_14_confirming_the_same_table_does_not_thank_twice():
    db = create_test_db()
    guest(db)
    vegan(db)
    first_result = confirm_order_for_visit(db, "u1", "c1", ["main_07"])
    first = record_order_thanks(db, "c1", "Tariq Al-iban (Returning Vegan Guest)", first_result)
    assert first is not None
    again = record_order_thanks(db, "c1", "Tariq Al-iban (Returning Vegan Guest)", first_result)
    assert again is None
    assert db.query(Message).filter(Message.conversation_id == "c1").count() == 1
    changed = confirm_order_for_visit(db, "u1", "c1", ["main_02"])
    second = record_order_thanks(db, "c1", "Tariq Al-iban (Returning Vegan Guest)", changed)
    assert second is not None
    assert db.query(Message).filter(Message.conversation_id == "c1").count() == 2


def test_15_just_the_qursan_does_not_pull_in_the_guests_own_dish():
    menu = load_menu()
    text = "Just the Qursan for him. I will stay with what I already like."
    assert narrow_confirmed_ids(["main_04", "main_02"], text, menu) == ["main_04"]


def test_16_vegan_jareesh_does_not_keep_the_lamb_jareesh():
    menu = load_menu()
    assert narrow_confirmed_ids(["main_01", "main_02"], "The vegan jareesh, please.", menu) == ["main_02"]
    assert narrow_confirmed_ids(["main_02", "main_01"], "We'll take the lamb jareesh.", menu) == ["main_01"]


def test_17_an_unnamed_yes_keeps_the_offered_dishes():
    menu = load_menu()
    assert narrow_confirmed_ids(["main_07", "start_02"], "Yes, those please.", menu) == ["main_07", "start_02"]


def test_18_pumpkin_kabsa_does_not_keep_the_other_kabsas():
    menu = load_menu()
    assert narrow_confirmed_ids(
        ["start_02", "main_07", "main_06", "main_05"],
        "Yes, the soup and the pumpkin kabsa",
        menu,
    ) == ["start_02", "main_07"]


def test_19_a_nut_allergy_does_not_count_as_naming_the_qursan():
    menu = load_menu()
    assert "main_04" not in dishes_named_in("I have a severe tree nut allergy.", menu)


def test_20_a_friends_dish_is_thanked_as_company_and_the_guests_is_not():
    text = order_thanks(
        "Tariq Al-iban (Returning Vegan Guest)",
        {
            "accepted": [
                {"id": "main_04", "name": "Braised Lamb & Pine Nut Qursan (قرصان)", "price": 21},
                {"id": "main_02", "name": "Vegan Almond-Milk & Wild Mushroom Jareesh (جريش)", "price": 16},
            ],
            "refused": [],
            "total_price": 37,
        },
        ["main_04"],
    )
    assert "**Braised Lamb & Pine Nut Qursan** — $21.00, for your company" in text
    assert "**Vegan Almond-Milk & Wild Mushroom Jareesh** — $16.00\n" in text
    assert "Your own profile stays as it is. I will remember who this was for." in text


def test_21_lasting_profile_flags_meat_even_when_this_visit_unlocked_it():
    db = create_test_db()
    guest(db, conv_id="tonight")
    vegan(db, conv_id="tonight")
    upsert_user_memory(
        db, "u1", "tonight", "diet", "omnivore", "true", "ephemeral",
        "My friend wants a meat dish.", "this visit only"
    )
    assert dishes_outside_lasting_profile(db, "u1", ["main_04", "main_02"]) == ["main_04"]


def test_22_the_menu_step_says_when_meat_is_open_for_someone_else():
    opened = menu_step_label(
        {"safe_recommendations": list(range(16)), "excluded_items": []},
        [{"tier": "ephemeral", "category": "diet", "attribute": "omnivore", "action": "created"}],
    )
    assert opened == (
        "Checked the menu: 16 safe, 0 blocked — meat is open for someone else at this table"
    )
    plain = menu_step_label(
        {"safe_recommendations": list(range(7)), "excluded_items": list(range(9))},
        [],
    )
    assert plain == "Checked the menu: 7 safe, 9 blocked"


def test_23_four_safe_suggestions_become_three_cards():
    safe = {"main_01", "main_04", "main_05", "main_02"}
    cards = ground_recommended_ids(["main_01", "main_04", "main_05", "main_02"], safe)[:3]
    assert cards == ["main_01", "main_04", "main_05"]


def test_8_memory_tools_are_ordered_before_confirm():
    calls = [
        {"id": "c", "name": "confirm_visit_order"},
        {"id": "a", "name": "upsert_guest_memory"},
        {"id": "b", "name": "revoke_guest_memory"},
        {"id": "m", "name": "get_curated_menu_recommendations"},
    ]
    assert [call["name"] for call in order_tool_calls(calls)] == [
        "upsert_guest_memory",
        "revoke_guest_memory",
        "get_curated_menu_recommendations",
        "confirm_visit_order",
    ]


def test_9_a_named_blocked_dish_does_not_stay_recommended():
    menu = load_menu()
    text = (
        "The Vegan Almond-Milk & Wild Mushroom Jareesh is blocked now. "
        "The Roasted Najdi Pumpkin & Chickpea Kabsa is still a good fit."
    )
    _, recommended_ids, _ = _parse_final_text(text, menu)
    assert "main_02" in recommended_ids
    assert "main_07" in recommended_ids
    assert ground_recommended_ids(recommended_ids, {"main_07"}) == ["main_07"]


if __name__ == "__main__":
    sys.exit(0)
