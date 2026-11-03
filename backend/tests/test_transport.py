from datetime import datetime, timedelta, timezone

from app.db.session import SessionLocal
from app.models import Parent, Student


def _route(client, admin, name="North") -> int:
    r = client.post("/api/transports", headers=admin, json={"route_name": name, "route_fare": "500"})
    assert r.status_code == 201, r.text
    return r.json()["transport_id"]


def _stop(client, admin, route_id, name, **extra) -> int:
    r = client.post(f"/api/transport/routes/{route_id}/stops", headers=admin, json={"name": name, **extra})
    assert r.status_code == 201, r.text
    return r.json()["stop_id"]


def test_stops_order_and_validation(client, as_role):
    admin = as_role("admin")
    route = _route(client, admin)
    a = _stop(client, admin, route, "Gate", pickup_time="07:10", drop_time="14:05")
    b = _stop(client, admin, route, "Market", fare="650")
    assert client.post(f"/api/transport/routes/{route}/stops", headers=admin, json={"name": "x", "pickup_time": "7:10"}).status_code == 422
    assert client.post("/api/transport/routes/999/stops", headers=admin, json={"name": "x"}).status_code == 404

    r = client.put(f"/api/transport/routes/{route}/stop-order", headers=admin, json={"stop_ids": [b, a]})
    assert [s["stop_id"] for s in r.json()] == [b, a]
    assert client.put(f"/api/transport/routes/{route}/stop-order", headers=admin, json={"stop_ids": [b]}).status_code == 422

    routes = client.get("/api/transport/routes", headers=as_role("teacher")).json()
    assert [s["name"] for s in routes[0]["stops"]] == ["Market", "Gate"]


def test_assignment_keeps_legacy_transport_id_in_sync(client, as_role):
    admin = as_role("admin")
    north, south = _route(client, admin, "North"), _route(client, admin, "South")
    gate = _stop(client, admin, north, "Gate")
    south_stop = _stop(client, admin, south, "Bridge")

    r = client.put("/api/transport/assignments/1", headers=admin, json={"route_id": north, "stop_id": south_stop})
    assert r.status_code == 422  # stop is on another route
    r = client.put("/api/transport/assignments/1", headers=admin, json={"route_id": north, "stop_id": gate, "drop": False})
    assert r.status_code == 200, r.text
    with SessionLocal() as db:
        assert db.get(Student, 1).transport_id == north

    rows = client.get("/api/transport/assignments", headers=admin, params={"class_id": 1, "section_id": 1}).json()
    one = next(r for r in rows if r["student_id"] == 1)
    assert (one["route_name"], one["stop_name"], one["drop"]) == ("North", "Gate", False)

    # route changed on the old student form: the stale stop is no longer shown
    with SessionLocal() as db:
        db.get(Student, 1).transport_id = south
        db.commit()
    one = next(r for r in client.get("/api/transport/assignments", headers=admin, params={"class_id": 1}).json() if r["student_id"] == 1)
    assert (one["route_name"], one["stop_id"]) == ("South", None)

    assert client.delete("/api/transport/assignments/1", headers=admin).status_code == 204
    with SessionLocal() as db:
        assert db.get(Student, 1).transport_id is None


def test_bulk_assignment_and_capacity_warning(client, as_role):
    admin = as_role("admin")
    route = _route(client, admin)
    r = client.post("/api/transport/vehicles", headers=admin, json={"registration_no": "dhaka ga 11", "capacity": 1, "route_id": route})
    assert r.status_code == 201 and r.json()["registration_no"] == "DHAKA GA 11"
    assert client.post("/api/transport/vehicles", headers=admin, json={"registration_no": "Dhaka  GA 11"}).status_code == 409

    r = client.post("/api/transport/assignments/bulk", headers=admin, json={"route_id": route, "class_id": 1, "section_id": 1})
    assert r.status_code == 200, r.text
    assert r.json() == {"assigned": 2, "capacity": {"assigned": 2, "capacity": 1, "over_capacity": True}}
    assert client.post("/api/transport/assignments/bulk", headers=admin, json={"route_id": route}).status_code == 422

    roster = client.get(f"/api/transport/routes/{route}/roster", headers=as_role("teacher")).json()
    assert roster["over_capacity"] and roster["stops"][-1]["stop"] is None
    assert {s["student_id"] for s in roster["stops"][-1]["students"]} == {1, 2}


def test_expiring_documents(client, as_role):
    admin = as_role("admin")
    today = datetime.now(timezone.utc).date()  # SCHOOL_TIMEZONE defaults to UTC
    client.post("/api/transport/vehicles", headers=admin, json={
        "registration_no": "A-1", "insurance_expiry": (today + timedelta(days=10)).isoformat(),
        "fitness_expiry": (today + timedelta(days=90)).isoformat(),
    })  # fmt: skip
    client.post("/api/transport/vehicles", headers=admin, json={"registration_no": "OLD", "insurance_expiry": "2000-01-01", "active": False})
    r = client.post("/api/transport/drivers", headers=admin, json={"name": "Karim", "licence_expiry": (today - timedelta(days=2)).isoformat()})
    assert r.status_code == 201, r.text

    items = client.get("/api/transport/expiring", headers=admin).json()
    assert [(i["kind"], i["label"], i["days_left"]) for i in items] == [("licence", "Karim", -2), ("insurance", "A-1", 10)]
    assert client.get("/api/transport/expiring", headers=as_role("teacher")).status_code == 403


def test_my_transport_for_student_and_parent(client, as_role):
    admin = as_role("admin")
    route = _route(client, admin)
    stop = _stop(client, admin, route, "Gate", pickup_time="07:10", fare="650")
    driver = client.post("/api/transport/drivers", headers=admin, json={"name": "Karim", "phone": "+8801700000000"}).json()["driver_id"]
    client.post("/api/transport/vehicles", headers=admin, json={"registration_no": "BUS-1", "route_id": route, "driver_id": driver, "capacity": 40})
    client.put("/api/transport/assignments/1", headers=admin, json={"route_id": route, "stop_id": stop})

    mine = client.get("/api/transport/mine", headers=as_role("student")).json()
    assert (mine["route_name"], mine["stop"]["pickup_time"], mine["fare"]) == ("North", "07:10", "650")
    assert mine["vehicles"] == [{"registration_no": "BUS-1", "model": None, "driver_name": "Karim", "driver_phone": "+8801700000000"}]

    parent = as_role("parent")
    assert client.get("/api/transport/mine", headers=parent).json()["student_id"] == 1  # only child
    assert client.get("/api/transport/mine", headers=parent, params={"student_id": 2}).status_code == 403
    assert client.get("/api/transport/mine", headers=as_role("student"), params={"student_id": 2}).status_code == 403

    # a parent with two children must say which one
    with SessionLocal() as db:
        db.get(Student, 2).parent_id = db.query(Parent).first().parent_id
        db.commit()
    assert client.get("/api/transport/mine", headers=parent).status_code == 422
    other = client.get("/api/transport/mine", headers=parent, params={"student_id": 2}).json()
    assert other["route_id"] is None and other["vehicles"] == []


def test_teacher_and_students_cannot_edit(client, as_role):
    admin = as_role("admin")
    route = _route(client, admin)
    teacher, student = as_role("teacher"), as_role("student")
    assert client.post(f"/api/transport/routes/{route}/stops", headers=teacher, json={"name": "x"}).status_code == 403
    assert client.post("/api/transport/vehicles", headers=teacher, json={"registration_no": "X"}).status_code == 403
    assert client.post("/api/transport/drivers", headers=teacher, json={"name": "X"}).status_code == 403
    assert client.put("/api/transport/assignments/1", headers=teacher, json={"route_id": route}).status_code == 403
    assert client.get(f"/api/transport/routes/{route}/roster", headers=student).status_code == 403
    assert client.get("/api/transport/drivers", headers=student).status_code == 403
