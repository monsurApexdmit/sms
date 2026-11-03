from datetime import date

import pytest
from fastapi import BackgroundTasks
from sqlalchemy import select

from app.db import SessionLocal
from app.models import FeeInvoice, Invoice, Parent, Setting
from app.services import fees, notify
from tests.conftest import YEAR

DUE_1, DUE_2 = "2026-01-10", "2026-06-10"


def _plan(client, headers, **overrides) -> dict:
    tuition = client.post("/api/fee-heads", headers=headers, json={"name": "Tuition"}).json()["fee_head_id"]
    bus = client.post("/api/fee-heads", headers=headers, json={"name": "Bus"}).json()["fee_head_id"]
    body = {
        "name": "Class Ten fees", "class_id": 1, "year": YEAR,
        "items": [{"fee_head_id": tuition, "amount": 1000}, {"fee_head_id": bus, "amount": 200}],
        "instalments": [
            {"name": "Term 1", "due_date": DUE_1, "share_percent": 50},
            {"name": "Term 2", "due_date": DUE_2, "share_percent": 50},
        ],
        **overrides,
    }  # fmt: skip
    r = client.post("/api/fee-plans", headers=headers, json=body)
    assert r.status_code == 201, r.text
    return r.json()


def _invoices(student_id: int | None = None) -> list[Invoice]:
    with SessionLocal() as db:
        stmt = select(Invoice).order_by(Invoice.student_id)
        if student_id:
            stmt = stmt.where(Invoice.student_id == student_id)
        return list(db.scalars(stmt))


# --- plans and invoice generation ------------------------------------------------------


def test_plan_totals_and_validation(client, as_role):
    admin = as_role("admin")
    plan = _plan(client, admin)
    assert plan["total"] == 1200 and [i["amount"] for i in plan["instalments"]] == [600, 600]
    assert plan["class_name"] == "Ten"

    bad = {**{k: plan[k] for k in ("name", "class_id", "year")}, "items": [{"fee_head_id": plan["items"][0]["fee_head_id"], "amount": 10}]}
    r = client.post("/api/fee-plans", headers=admin, json={**bad, "instalments": [{"name": "x", "due_date": DUE_1, "share_percent": 60}]})
    assert r.status_code == 422 and "100" in r.text
    r = client.post("/api/fee-plans", headers=admin, json={**bad, "late_fine_type": "flat", "instalments": [{"name": "x", "due_date": DUE_1, "share_percent": 100}]})
    assert r.status_code == 422
    assert client.get("/api/fee-plans", headers=as_role("teacher")).status_code == 403


def test_generate_applies_discounts_and_is_idempotent(client, as_role):
    admin = as_role("admin")
    plan = _plan(client, admin)
    term1 = plan["instalments"][0]["fee_instalment_id"]
    for discount in (
        {"student_id": 2, "year": YEAR, "kind": "percent", "value": 10, "reason": "Sibling"},
        {"student_id": 2, "fee_plan_id": plan["fee_plan_id"], "year": YEAR, "kind": "amount", "value": 100, "reason": "Scholarship"},
        {"student_id": 1, "year": "2024-2025", "kind": "percent", "value": 50},  # other year: ignored
    ):
        assert client.post("/api/fee-discounts", headers=admin, json=discount).status_code == 201
    assert client.post("/api/fee-discounts", headers=admin, json={"student_id": 2, "year": YEAR, "kind": "percent", "value": 120}).status_code == 422

    url = f"/api/fee-plans/{plan['fee_plan_id']}/generate"
    assert client.post(url, headers=admin, json={"fee_instalment_id": term1}).json() == {"created": 2, "skipped": 0, "waived": 0}
    # 600 for student 1; student 2: 600 less 10% less half of the 100 scholarship
    assert [(i.student_id, i.amount, i.due, i.status) for i in _invoices()] == [(1, 600, "600", "unpaid"), (2, 490, "490", "unpaid")]
    assert client.post(url, headers=admin, json={"fee_instalment_id": term1}).json() == {"created": 0, "skipped": 2, "waived": 0}
    assert len(_invoices()) == 2

    # a billed instalment cannot be removed, nor the plan deleted
    keep_only_term2 = {**{k: plan[k] for k in ("name", "class_id", "year")}, "items": [{"fee_head_id": i["fee_head_id"], "amount": i["amount"]} for i in plan["items"]],
                       "instalments": [{"name": "All", "due_date": DUE_2, "share_percent": 100}]}  # fmt: skip
    assert client.put(f"/api/fee-plans/{plan['fee_plan_id']}", headers=admin, json=keep_only_term2).status_code == 409
    assert client.delete(f"/api/fee-plans/{plan['fee_plan_id']}", headers=admin).status_code == 409


def test_full_scholarship_is_waived_and_deleted_invoice_can_be_regenerated(client, as_role):
    admin = as_role("admin")
    plan = _plan(client, admin)
    term1 = plan["instalments"][0]["fee_instalment_id"]
    client.post("/api/fee-discounts", headers=admin, json={"student_id": 2, "year": YEAR, "kind": "percent", "value": 100})
    url = f"/api/fee-plans/{plan['fee_plan_id']}/generate"
    assert client.post(url, headers=admin, json={"fee_instalment_id": term1}).json() == {"created": 1, "skipped": 0, "waived": 1}

    (inv,) = _invoices(1)
    assert client.delete(f"/api/invoices/{inv.invoice_id}", headers=admin).status_code == 204
    assert client.post(url, headers=admin, json={"fee_instalment_id": term1}).json()["created"] == 1


# --- late fines --------------------------------------------------------------------------


def _billed_plan(client, as_role, **fine) -> int:
    admin = as_role("admin")
    plan = _plan(client, admin, **fine)
    client.post(f"/api/fee-plans/{plan['fee_plan_id']}/generate", headers=admin, json={"fee_instalment_id": plan["instalments"][0]["fee_instalment_id"]})
    return plan["fee_plan_id"]


def _apply(day: str) -> int:
    with SessionLocal() as db:
        changed = fees.apply_late_fines(db, date.fromisoformat(day))
        db.commit()
    return changed


def test_flat_late_fine_after_grace_days(client, as_role):
    _billed_plan(client, as_role, late_fine_type="flat", late_fine_amount=50, grace_days=2)
    assert _apply("2026-01-12") == 0  # due 10th + 2 grace days
    assert _apply("2026-01-13") == 2
    assert [(i.amount, i.due) for i in _invoices()] == [(650, "650"), (650, "650")]
    assert _apply("2026-01-13") == 0 and _apply("2026-02-01") == 0  # flat: charged once
    assert [i.amount for i in _invoices()] == [650, 650]


def test_per_day_fine_recalculates_and_stops_once_paid(client, as_role):
    _billed_plan(client, as_role, late_fine_type="per_day", late_fine_amount=10)
    assert _apply("2026-01-13") == 2
    assert [i.amount for i in _invoices()] == [630, 630]
    assert _apply("2026-01-13") == 0

    admin = as_role("admin")
    (inv,) = _invoices(1)
    assert client.post(f"/api/invoices/{inv.invoice_id}/payments", headers=admin, json={"amount": 630}).status_code == 200
    assert _apply("2026-01-15") == 1  # only the unpaid one moves on
    assert [(i.amount, i.status) for i in _invoices()] == [(630, "paid"), (650, "unpaid")]

    # a manual edit becomes the new base; the fine is added on top of it
    (other,) = _invoices(2)
    client.put(f"/api/invoices/{other.invoice_id}", headers=admin, json={"title": other.title, "amount": 550})
    _apply("2026-01-15")
    assert _invoices(2)[0].amount == 550
    with SessionLocal() as db:
        link = db.scalars(select(FeeInvoice).where(FeeInvoice.invoice_id == other.invoice_id)).one()
        assert (link.base_amount, link.fine_amount) == (500, 50)


# --- reminders ---------------------------------------------------------------------------


def _remind(day: str) -> tuple[int, list[tuple[str, tuple]]]:
    tasks = BackgroundTasks()
    with SessionLocal() as db:
        count = fees.send_due_reminders(db, tasks, date.fromisoformat(day))
        db.commit()
    return count, [(t.args[0].__name__, t.args[1:]) for t in tasks.tasks]


def test_due_reminders_once_per_day(client, as_role):
    _billed_plan(client, as_role)
    with SessionLocal() as db:
        db.add(Setting(type="active_sms_service", description="twilio"))
        db.get(Parent, 1).phone = "+15550100"
        db.commit()

    assert _remind("2026-01-01") == (0, [])  # more than 3 days ahead
    count, sent = _remind("2026-01-08")
    assert count == 2
    assert sorted(name for name, _ in sent) == ["send_email", "send_email", "send_email", "send_sms"]  # parent+student, student, parent SMS
    sms = next(args for name, args in sent if name == "send_sms")
    assert sms[0] == "+15550100" and "Kid One" in sms[1] and "is due on 10 Jan 2026" in sms[1]
    assert _remind("2026-01-08") == (0, [])
    count, sent = _remind("2026-01-20")  # overdue: reminded again on a later day
    assert count == 2 and any("was due" in args[1] for name, args in sent if name == "send_sms")


def test_daily_jobs_endpoint(client, as_role, monkeypatch):
    sent = []
    monkeypatch.setattr(notify, "send_email", lambda *a: sent.append(a))
    monkeypatch.setattr(fees, "send_email", lambda *a: sent.append(a))
    monkeypatch.setattr(fees, "school_today", lambda: date(2026, 1, 9))
    _billed_plan(client, as_role)
    assert client.post("/api/fees/daily-jobs", headers=as_role("teacher")).status_code == 403
    r = client.post("/api/fees/daily-jobs", headers=as_role("admin"))
    assert r.json() == {"fines_updated": 0, "reminders_sent": 2}
    assert len(sent) == 3


# --- receipts ------------------------------------------------------------------------------


@pytest.fixture
def paid(client, as_role) -> int:
    admin = as_role("admin")
    inv = client.post("/api/invoices", headers=admin, json={"student_id": 1, "title": "Fee", "amount": 1000, "amount_paid": 400}).json()
    detail = client.get(f"/api/invoices/{inv['invoice_id']}", headers=admin).json()
    return detail["payments"][0]["payment_id"]


def test_receipt_access(client, as_role, paid):
    r = client.get(f"/api/payments/{paid}/receipt", headers=as_role("student"))
    assert r.status_code == 200
    body = r.json()
    assert body["amount"] == 400 and body["invoice"]["due"] == 600 and body["student"]["name"] == "Kid One"
    assert body["class_name"] == "Ten" and body["school"]["system_name"] == "Test School"
    assert client.get(f"/api/payments/{paid}/receipt", headers=as_role("parent")).status_code == 200
    assert client.get(f"/api/payments/{paid}/receipt", headers=as_role("admin")).status_code == 200
    assert client.get(f"/api/payments/{paid}/receipt", headers=as_role("student2")).status_code == 403
    assert client.get(f"/api/payments/{paid}/receipt", headers=as_role("teacher")).status_code == 403

    expense = client.post("/api/expenses", headers=as_role("admin"), json={"title": "Chalk", "amount": 5}).json()
    assert client.get(f"/api/payments/{expense['payment_id']}/receipt", headers=as_role("admin")).status_code == 404
