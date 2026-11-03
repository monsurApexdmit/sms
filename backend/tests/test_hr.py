from datetime import date

from sqlalchemy import func, select

from app.core.security import hash_password
from app.db import SessionLocal
from app.models import Accountant, ExpenseCategory, Payment, StaffAttendance
from app.services.payroll import clear_staff_leave, record_staff_leave
from tests.conftest import PASSWORD, login

MARCH = "2026-03"


def _calendar(client, admin):
    """March 2026: Fridays off, 20-22 holiday -> 25 working days."""
    client.put("/api/settings", headers=admin, json={"weekly_off_days": "4"})
    client.post("/api/calendar", headers=admin, json={"title": "Eid", "start_date": "2026-03-20", "end_date": "2026-03-22", "kind": "holiday"})


def _mark(client, admin, day: str, **statuses):
    items = [{"staff_role": "teacher", "staff_id": int(k[1:]), "status": v} for k, v in statuses.items()]
    r = client.put("/api/hr/attendance/sheet", headers=admin, json={"date": day, "items": items})
    assert r.status_code == 200, r.text
    return r.json()


def _structure(client, admin, staff_id=1, basic=2500, effective="2026-01-01", **extra):
    body = {"staff_role": "teacher", "staff_id": staff_id, "basic": basic, "effective_from": effective, **extra}
    r = client.post("/api/hr/salary-structures", headers=admin, json=body)
    assert r.status_code == 201, r.text
    return r.json()


def _accountant(client) -> dict:
    with SessionLocal() as db:
        db.add(Accountant(name="Acc", email="acc@example.com", password=hash_password(PASSWORD)))
        db.commit()
    return login(client, "acc@example.com")


# --- staff attendance -----------------------------------------------------------------


def test_attendance_sheet_save_update_and_clear(client, as_role):
    admin = as_role("admin")
    sheet = client.get("/api/hr/attendance/sheet", headers=admin, params={"date": "2026-03-04"}).json()
    assert [(r["staff_role"], r["staff_id"], r["status"]) for r in sheet["rows"]] == [("teacher", 1, None), ("teacher", 2, None)]

    items = [
        {"staff_role": "teacher", "staff_id": 1, "status": "present", "check_in": "08:55"},
        {"staff_role": "teacher", "staff_id": 2, "status": "absent", "note": "sick"},
    ]
    client.put("/api/hr/attendance/sheet", headers=admin, json={"date": "2026-03-04", "items": items})
    rows = _mark(client, admin, "2026-03-04", t1="late")["rows"]
    assert {r["staff_id"]: r["status"] for r in rows} == {1: "late", 2: "absent"}
    assert rows[0]["check_in"] is None and rows[1]["note"] == "sick"
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(StaffAttendance)) == 2  # updated in place, one row per day

    _mark(client, admin, "2026-03-04", t2=None)
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(StaffAttendance)) == 1

    bad = {"date": "2026-03-04", "items": [{"staff_role": "teacher", "staff_id": 99, "status": "present"}]}
    assert client.put("/api/hr/attendance/sheet", headers=admin, json=bad).status_code == 422
    future = {"date": "2099-01-01", "items": []}
    assert client.put("/api/hr/attendance/sheet", headers=admin, json=future).status_code == 422
    bad_time = {"date": "2026-03-04", "items": [{"staff_role": "teacher", "staff_id": 1, "status": "present", "check_in": "25:00"}]}
    assert client.put("/api/hr/attendance/sheet", headers=admin, json=bad_time).status_code == 422
    assert client.get("/api/hr/attendance/sheet", headers=as_role("teacher"), params={"date": "2026-03-04"}).status_code == 403


def test_attendance_report_and_own_view(client, as_role):
    admin = as_role("admin")
    _calendar(client, admin)
    _mark(client, admin, "2026-03-02", t1="present", t2="absent")
    _mark(client, admin, "2026-03-03", t1="half_day")

    report = client.get("/api/hr/attendance/report", headers=admin, params={"month": MARCH}).json()
    assert report["working_days"] == 25 and report["holidays"]["20"] == "Eid"
    t1 = next(r for r in report["rows"] if r["staff_id"] == 1)
    assert t1["days"] == {"2": "present", "3": "half_day"} and t1["present"] == 1 and t1["half_day"] == 1

    mine = client.get("/api/hr/attendance/mine", headers=as_role("teacher2"), params={"month": MARCH}).json()
    assert [r["staff_id"] for r in mine["rows"]] == [2] and mine["rows"][0]["absent"] == 1
    assert client.get("/api/hr/attendance/mine", headers=as_role("student"), params={"month": MARCH}).status_code == 403


def test_leave_hook_marks_school_days_only(client, as_role):
    admin = as_role("admin")
    _calendar(client, admin)
    _mark(client, admin, "2026-03-02", t1="present")
    with SessionLocal() as db:
        # Mon 2 .. Mon 9 has 7 school days (Fri 6 is off); Mon 2 is already present -> 6 marked
        assert record_staff_leave(db, "teacher", 1, date(2026, 3, 2), date(2026, 3, 9), "admin-1") == 6
        db.commit()
        statuses = dict(db.execute(select(StaffAttendance.date, StaffAttendance.status).where(StaffAttendance.staff_id == 1)).all())
        assert statuses[date(2026, 3, 2)] == "present" and date(2026, 3, 6) not in statuses
        assert sum(1 for s in statuses.values() if s == "leave") == 6
        clear_staff_leave(db, "teacher", 1, date(2026, 3, 2), date(2026, 3, 9))
        db.commit()
        assert db.scalar(select(func.count()).select_from(StaffAttendance)) == 1


# --- payroll -------------------------------------------------------------------------------


def _march_attendance(client, admin):
    _calendar(client, admin)
    _mark(client, admin, "2026-03-02", t1="absent")
    _mark(client, admin, "2026-03-03", t1="absent")
    _mark(client, admin, "2026-03-04", t1="half_day")
    _mark(client, admin, "2026-03-05", t1="leave")
    _mark(client, admin, "2026-03-06", t1="absent")  # Friday: weekly day off, not counted
    _mark(client, admin, "2026-03-09", t1="late")


def test_payslip_maths_with_and_without_absence_deduction(client, as_role):
    admin = as_role("admin")
    _march_attendance(client, admin)
    _structure(client, admin, basic=1000, effective="2025-01-01")  # superseded
    _structure(client, admin, allowances=[{"name": "House", "amount": 500}], deductions=[{"name": "Tax", "amount": 100}])
    _structure(client, admin, basic=9999, effective="2026-04-01")  # not yet in effect

    run = client.post("/api/hr/payroll", headers=admin, json={"month": MARCH}).json()
    assert run["status"] == "draft" and run["staff"] == 1  # teacher 2 has no salary structure
    (slip,) = run["payslips"]
    assert slip["basic"] == 2500 and slip["gross"] == 3000 and slip["net"] == 2900
    assert slip["working_days"] == 25 and slip["absent_days"] == 2.5 and slip["present_days"] == 22.5 and slip["leave_days"] == 1
    assert slip["absence_deduction"] == 0

    assert client.put("/api/hr/settings", headers=admin, json={"deduct_absence": True}).status_code == 200
    (slip,) = client.post(f"/api/hr/payroll/{run['payroll_run_id']}/recalculate", headers=admin).json()["payslips"]
    assert slip["absence_deduction"] == 250  # 2500 / 25 working days x 2.5 unpaid days
    assert slip["net"] == 2650
    assert client.post("/api/hr/payroll", headers=admin, json={"month": MARCH}).status_code == 409


def test_finalize_locks_and_paying_records_expenses_once(client, as_role):
    admin = as_role("admin")
    _structure(client, admin)
    _structure(client, admin, staff_id=2, basic=0)  # nothing to pay: no payment row
    run_id = client.post("/api/hr/payroll", headers=admin, json={"month": MARCH}).json()["payroll_run_id"]
    assert client.post(f"/api/hr/payroll/{run_id}/pay", headers=admin, json={}).status_code == 409  # still draft

    assert client.post(f"/api/hr/payroll/{run_id}/finalize", headers=admin).json()["status"] == "finalized"
    assert client.post(f"/api/hr/payroll/{run_id}/recalculate", headers=admin).status_code == 409
    assert client.delete(f"/api/hr/payroll/{run_id}", headers=admin).status_code == 409

    paid = client.post(f"/api/hr/payroll/{run_id}/pay", headers=admin, json={"method": "bank", "date": "2026-04-01"}).json()
    assert paid["status"] == "paid" and all(p["paid_on"] == "2026-04-01" for p in paid["payslips"])
    client.post(f"/api/hr/payroll/{run_id}/pay", headers=admin, json={})  # again: nothing new
    with SessionLocal() as db:
        (payment,) = db.scalars(select(Payment)).all()
        category = db.get(ExpenseCategory, payment.expense_category_id)
    assert payment.payment_type == "expense" and payment.amount == "2500" and category.name == "Salary"
    assert payment.title == "Salary 2026-03 – Teacher One"
    expenses = client.get("/api/payments", headers=admin, params={"payment_type": "expense"}).json()
    assert expenses["total"] == 1 and expenses["amount_total"] == 2500


def test_staff_see_only_their_own_finalized_payslips(client, as_role):
    admin = as_role("admin")
    _structure(client, admin)
    _structure(client, admin, staff_id=2)
    run = client.post("/api/hr/payroll", headers=admin, json={"month": MARCH}).json()
    mine = next(p for p in run["payslips"] if p["staff_id"] == 1)

    teacher = as_role("teacher")
    assert client.get("/api/hr/payslips/mine", headers=teacher).json() == []  # draft runs are hidden
    assert client.get(f"/api/hr/payslips/{mine['payslip_id']}", headers=teacher).status_code == 403
    client.post(f"/api/hr/payroll/{run['payroll_run_id']}/finalize", headers=admin)

    assert [p["payslip_id"] for p in client.get("/api/hr/payslips/mine", headers=teacher).json()] == [mine["payslip_id"]]
    r = client.get(f"/api/hr/payslips/{mine['payslip_id']}", headers=teacher)
    assert r.status_code == 200 and r.json()["school"] == "Test School"
    assert client.get(f"/api/hr/payslips/{mine['payslip_id']}", headers=as_role("teacher2")).status_code == 403
    assert client.get(f"/api/hr/payslips/{mine['payslip_id']}", headers=as_role("student")).status_code == 403
    assert client.get("/api/hr/payslips/mine", headers=as_role("parent")).status_code == 403


def test_payroll_permissions(client, as_role):
    teacher = as_role("teacher")
    assert client.post("/api/hr/payroll", headers=teacher, json={"month": MARCH}).status_code == 403
    assert client.get("/api/hr/payroll", headers=teacher).status_code == 403
    assert client.get("/api/hr/salary-structures", headers=teacher).status_code == 403

    accountant = _accountant(client)
    body = {"staff_role": "teacher", "staff_id": 1, "basic": 100, "effective_from": "2026-01-01"}
    assert client.post("/api/hr/salary-structures", headers=accountant, json=body).status_code == 403
    assert client.put("/api/hr/settings", headers=accountant, json={"deduct_absence": True}).status_code == 403
    assert client.post("/api/hr/payroll", headers=accountant, json={"month": MARCH}).status_code == 201

    admin = as_role("admin")
    assert client.post("/api/hr/salary-structures", headers=admin, json={**body, "staff_id": 99}).status_code == 404
    assert client.post("/api/hr/payroll", headers=admin, json={"month": "2026-13"}).status_code == 422
