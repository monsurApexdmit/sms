import base64
import json
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from sqlalchemy import select

from app.db import SessionLocal
from app.models import AuditLog, GatewayTransaction, Invoice, Payment
from app.services import local_gateways as gw
from app.services.settings import MASK


def _keypair():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private = base64.b64encode(
        key.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    ).decode()
    public = base64.b64encode(
        key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    ).decode()
    return key, private, public


MERCHANT_KEY, MERCHANT_PRIVATE, MERCHANT_PUBLIC = _keypair()
NAGAD_KEY, _, NAGAD_PUBLIC = _keypair()


class FakeGateways:
    """Stands in for the SSLCommerz, bKash and Nagad sandboxes."""

    def __init__(self):
        self.calls: list[tuple[str, str]] = []
        self.ssl_sessions: dict[str, dict] = {}
        self.ssl_paid: dict[str, dict] = {}  # tran_id -> validation answer
        self.bkash: dict[str, dict] = {}  # paymentID -> payment
        self.bkash_executes = 0
        self.nagad: dict[str, dict] = {}  # paymentRefId -> payment
        self.tokens = 0

    def __call__(self, method, url, **kw):
        path = urlparse(url).path
        self.calls.append((method, path))
        req = httpx.Request(method, url)
        reply = lambda body, code=200: httpx.Response(code, json=body, request=req)  # noqa: E731

        # --- SSLCommerz
        if path == "/gwprocess/v4/api.php":
            data = kw["data"]
            self.ssl_sessions[data["tran_id"]] = data
            return reply({"status": "SUCCESS", "GatewayPageURL": f"https://ssl.test/pay/{data['tran_id']}", "sessionkey": "S"})
        if path == "/validator/api/validationserverAPI.php":
            for tran_id, v in self.ssl_paid.items():
                if v["val_id"] == kw["params"]["val_id"]:
                    return reply({**v, "tran_id": tran_id})
            return reply({"status": "INVALID_TRANSACTION"})
        if path == "/validator/api/merchantTransIDvalidationAPI.php":
            tran_id = kw["params"]["tran_id"]
            found = [{**self.ssl_paid[tran_id], "tran_id": tran_id}] if tran_id in self.ssl_paid else []
            return reply({"APIConnect": "DONE", "no_of_trans_found": len(found), "element": found})

        # --- bKash
        if path.endswith("/token/grant"):
            assert kw["headers"]["username"] == "user" and kw["json"]["app_secret"] == "app-secret"
            self.tokens += 1
            return reply({"statusCode": "0000", "id_token": "TOKEN", "expires_in": 3600})
        if "/tokenized/checkout/" in path:
            assert kw["headers"]["Authorization"] == "TOKEN" and kw["headers"]["X-APP-Key"] == "app-key"
            body = kw["json"]
            if path.endswith("/create"):
                pid = f"PAY{len(self.bkash) + 1}"
                self.bkash[pid] = {"request": body, "state": "Initiated", "amount": body["amount"]}
                return reply({"statusCode": "0000", "paymentID": pid, "bkashURL": f"https://bkash.test/{pid}"})
            p = self.bkash.get(body["paymentID"])
            if p is None:
                return reply({"statusCode": "2056", "statusMessage": "Invalid Payment State"})
            result = {
                "paymentID": body["paymentID"], "trxID": "TRX" + body["paymentID"], "amount": p["amount"], "currency": "BDT",
                "merchantInvoiceNumber": p["request"]["merchantInvoiceNumber"],
            }  # fmt: skip
            if path.endswith("/execute"):
                self.bkash_executes += 1
                if p["state"] == "Approved":
                    p["state"] = "Completed"
                    return reply({**result, "statusCode": "0000", "transactionStatus": "Completed"})
                return reply({"statusCode": "2117", "statusMessage": "Payment execution already been called before"})
            return reply({**result, "statusCode": "0000", "transactionStatus": p["state"]})

        # --- Nagad
        if "/check-out/initialize/" in path:
            sensitive = self._nagad_open(kw["json"])
            assert sensitive["merchantId"] == "M1" and kw["json"]["accountNumber"] == "01711111111"
            ref = f"NREF{len(self.nagad) + 1}"
            self.nagad[ref] = {"orderId": sensitive["orderId"], "challenge": "C" + ref, "status": "Initiated"}
            answer = json.dumps({"paymentReferenceId": ref, "challenge": "C" + ref}).encode()
            return reply({
                "sensitiveData": base64.b64encode(MERCHANT_KEY.public_key().encrypt(answer, padding.PKCS1v15())).decode(),
                "signature": base64.b64encode(NAGAD_KEY.sign(answer, padding.PKCS1v15(), hashes.SHA256())).decode(),
            })  # fmt: skip
        if "/check-out/complete/" in path:
            ref = path.rsplit("/", 1)[1]
            order = self._nagad_open(kw["json"])
            assert order["challenge"] == self.nagad[ref]["challenge"] and order["currencyCode"] == "050"
            self.nagad[ref]["amount"] = order["amount"]
            return reply({"status": "Success", "callBackUrl": f"https://nagad.test/pay/{ref}"})
        if "/verify/payment/" in path:
            ref = path.rsplit("/", 1)[1]
            p = self.nagad.get(ref)
            if p is None:
                return reply({"reason": "not found"}, 404)
            return reply({
                "merchantId": "M1", "orderId": p["orderId"], "paymentRefId": ref, "amount": p.get("amount"),
                "status": p["status"], "issuerPaymentRefNo": "ISS" + ref,
            })  # fmt: skip
        raise AssertionError(f"unexpected call {method} {url}")

    @staticmethod
    def _nagad_open(body: dict) -> dict:
        plain = NAGAD_KEY.decrypt(base64.b64decode(body["sensitiveData"]), padding.PKCS1v15())
        MERCHANT_KEY.public_key().verify(base64.b64decode(body["signature"]), plain, padding.PKCS1v15(), hashes.SHA256())
        return json.loads(plain)


SETTINGS = {
    "sslcommerz": {"active": "1", "mode": "sandbox", "store_id": "store1", "store_password": "store-pass"},
    "bkash": {"active": "1", "mode": "sandbox", "app_key": "app-key", "app_secret": "app-secret", "username": "user", "password": "pass"},
    "nagad": {
        "active": "1", "mode": "sandbox", "merchant_id": "M1", "merchant_number": "01711111111",
        "merchant_private_key": MERCHANT_PRIVATE, "nagad_public_key": NAGAD_PUBLIC,
    },
}  # fmt: skip


@pytest.fixture
def gateways(client, as_role, monkeypatch):
    fake = FakeGateways()
    monkeypatch.setattr(gw, "_call", fake)
    gw._bkash_tokens.clear()
    admin = as_role("admin")
    assert client.put("/api/settings", headers=admin, json={"currency": "bdt"}).status_code == 200
    assert client.put("/api/payment-gateways/settings", headers=admin, json=SETTINGS).status_code == 200
    return fake


def _invoice(client, as_role, student_id=1) -> int:
    r = client.post("/api/invoices", headers=as_role("admin"), json={"student_id": student_id, "title": "Fee", "amount": 1000, "amount_paid": 300})
    return r.json()["invoice_id"]


def _paid_rows(invoice_id: int, method: str) -> list[Payment]:
    with SessionLocal() as db:
        return list(db.scalars(select(Payment).where(Payment.invoice_id == invoice_id, Payment.method == method)))


# --- settings ---------------------------------------------------------------------------


def test_settings_masked_and_public_flags(client, as_role, gateways):
    admin = as_role("admin")
    got = client.get("/api/payment-gateways/settings", headers=admin).json()
    assert got["bkash"]["app_secret"] == MASK and got["bkash"]["password"] == MASK and got["bkash"]["app_key"] == "app-key"
    assert got["sslcommerz"]["store_password"] == MASK and got["nagad"]["merchant_private_key"] == MASK
    assert got["currency_is_bdt"] is True
    # sending the mask back keeps the stored secret
    client.put("/api/payment-gateways/settings", headers=admin, json={"bkash": got["bkash"]})
    assert gw.get_config(SessionLocal(), "bkash")["app_secret"] == "app-secret"
    assert sorted(client.get("/api/settings/public").json()["local_gateways"]) == ["bkash", "nagad", "sslcommerz"]

    assert client.put("/api/payment-gateways/settings", headers=admin, json={"bkash": {"mode": "moon"}}).status_code == 422
    assert client.put("/api/payment-gateways/settings", headers=admin, json={"nagad": {"bogus": "1"}}).status_code == 422
    assert client.get("/api/payment-gateways/settings", headers=as_role("teacher")).status_code == 403
    # secrets never reach the audit log
    with SessionLocal() as db:
        logged = " ".join(r.changes or "" for r in db.scalars(select(AuditLog).where(AuditLog.table_name == "settings")))
    assert "app-secret" not in logged and "store-pass" not in logged and MERCHANT_PRIVATE[:60] not in logged
    assert "[hidden]" in logged

    # only when the school bills in BDT
    client.put("/api/settings", headers=admin, json={"currency": "usd"})
    assert client.get("/api/settings/public").json()["local_gateways"] == []


def test_disabled_gateway_refused(client, as_role, gateways):
    invoice_id = _invoice(client, as_role)
    client.put("/api/payment-gateways/settings", headers=as_role("admin"), json={"bkash": {"active": "0"}})
    assert client.post(f"/api/invoices/{invoice_id}/bkash-checkout", headers=as_role("student")).status_code == 400
    client.put("/api/settings", headers=as_role("admin"), json={"currency": "usd"})
    assert client.post(f"/api/invoices/{invoice_id}/nagad-checkout", headers=as_role("student")).status_code == 400
    assert gateways.calls == []


# --- SSLCommerz ------------------------------------------------------------------------


def test_sslcommerz_amount_from_server_and_ipn_records_once(client, as_role, gateways):
    invoice_id = _invoice(client, as_role)
    url = f"/api/invoices/{invoice_id}/sslcommerz-checkout"
    assert client.post(url).status_code == 401
    assert client.post(url, headers=as_role("student2")).status_code == 403
    # the body is ignored: the amount is what the invoice still owes
    r = client.post(url, headers=as_role("parent"), json={"amount": 1})
    assert r.status_code == 200
    (tran_id, sent), = gateways.ssl_sessions.items()
    assert r.json() == {"redirect_url": f"https://ssl.test/pay/{tran_id}"}
    assert sent["total_amount"] == "700.00" and sent["currency"] == "BDT"
    assert sent["ipn_url"].endswith("/api/payments/sslcommerz/ipn") and sent["success_url"].endswith("/return/success")

    # an IPN with an unknown val_id records nothing
    client.post("/api/payments/sslcommerz/ipn", data={"tran_id": tran_id, "val_id": "FORGED", "status": "VALID"})
    assert _paid_rows(invoice_id, "sslcommerz") == []

    gateways.ssl_paid[tran_id] = {"status": "VALID", "val_id": "VAL1", "amount": "700.00", "currency": "BDT", "bank_tran_id": "BANK1"}
    for _ in range(2):
        assert client.post("/api/payments/sslcommerz/ipn", data={"tran_id": tran_id, "val_id": "VAL1"}).json() == {"received": True}
    r = client.post("/api/payments/sslcommerz/confirm", headers=as_role("student"), json={"ref": tran_id})
    assert r.json() == {"status": "paid", "invoice_id": invoice_id}
    rows = _paid_rows(invoice_id, "sslcommerz")
    assert len(rows) == 1 and rows[0].amount == "700" and rows[0].description == f"sslcommerz:{tran_id}"
    with SessionLocal() as db:
        assert db.get(Invoice, invoice_id).status == "paid"
        tx = db.scalars(select(GatewayTransaction)).one()
        assert (tx.status, tx.gateway_trx_id, tx.gateway_ref, tx.payment_id) == ("paid", "BANK1", "VAL1", rows[0].payment_id)


def test_sslcommerz_wrong_amount_or_currency_not_recorded(client, as_role, gateways):
    invoice_id = _invoice(client, as_role)
    client.post(f"/api/invoices/{invoice_id}/sslcommerz-checkout", headers=as_role("student"))
    (tran_id,) = gateways.ssl_sessions
    gateways.ssl_paid[tran_id] = {"status": "VALID", "val_id": "VAL1", "amount": "10.00", "currency": "BDT"}
    assert client.post("/api/payments/sslcommerz/confirm", headers=as_role("student"), json={"ref": tran_id}).status_code == 409
    gateways.ssl_paid[tran_id] = {"status": "VALID", "val_id": "VAL1", "amount": "700.00", "currency": "USD"}
    client.post("/api/payments/sslcommerz/ipn", data={"tran_id": tran_id, "val_id": "VAL1"})
    assert _paid_rows(invoice_id, "sslcommerz") == []
    # not paid yet at the gateway
    gateways.ssl_paid.clear()
    r = client.post("/api/payments/sslcommerz/confirm", headers=as_role("student"), json={"ref": tran_id})
    assert r.json() == {"status": "pending", "invoice_id": invoice_id}


def test_return_endpoints_only_redirect(client, as_role, gateways):
    r = client.post("/api/payments/sslcommerz/return/success", data={"tran_id": "INV1XABC", "val_id": "VAL1"}, follow_redirects=False)
    assert r.status_code == 303
    target = urlparse(r.headers["location"])
    assert target.path == "/app/my-invoices"
    assert parse_qs(target.query) == {"gateway": ["sslcommerz"], "result": ["success"], "ref": ["INV1XABC"]}
    r = client.get("/api/payments/bkash/return?paymentID=PAY9&status=cancel", follow_redirects=False)
    assert parse_qs(urlparse(r.headers["location"]).query) == {"gateway": ["bkash"], "result": ["cancel"], "ref": ["PAY9"]}
    r = client.get("/api/payments/nagad/return?payment_ref_id=../evil&status=Success", follow_redirects=False)
    assert parse_qs(urlparse(r.headers["location"]).query) == {"gateway": ["nagad"], "result": ["success"]}
    assert gateways.calls == []


# --- bKash -------------------------------------------------------------------------------


def test_bkash_execute_records_once(client, as_role, gateways):
    invoice_id = _invoice(client, as_role)
    r = client.post(f"/api/invoices/{invoice_id}/bkash-checkout", headers=as_role("student"), json={"amount": 5})
    assert r.json() == {"redirect_url": "https://bkash.test/PAY1"}
    sent = gateways.bkash["PAY1"]["request"]
    assert sent["amount"] == "700.00" and sent["currency"] == "BDT" and sent["callbackURL"].endswith("/api/payments/bkash/return")

    confirm = {"ref": "PAY1"}
    assert client.post("/api/payments/bkash/confirm", headers=as_role("student2"), json=confirm).status_code == 403
    assert gateways.bkash_executes == 0  # nothing executed for a caller who may not pay this invoice
    # not approved by the payer yet
    assert client.post("/api/payments/bkash/confirm", headers=as_role("student"), json=confirm).json()["status"] == "pending"
    gateways.bkash["PAY1"]["state"] = "Approved"
    r = client.post("/api/payments/bkash/confirm", headers=as_role("parent"), json=confirm)
    assert r.json() == {"status": "paid", "invoice_id": invoice_id}
    assert client.post("/api/payments/bkash/confirm", headers=as_role("student"), json=confirm).json()["status"] == "paid"
    rows = _paid_rows(invoice_id, "bkash")
    assert len(rows) == 1 and rows[0].amount == "700"
    assert gateways.tokens == 1  # the token is reused


def test_bkash_mismatch_and_cancel(client, as_role, gateways):
    invoice_id = _invoice(client, as_role)
    client.post(f"/api/invoices/{invoice_id}/bkash-checkout", headers=as_role("student"))
    gateways.bkash["PAY1"].update(state="Approved", amount="1.00")
    assert client.post("/api/payments/bkash/confirm", headers=as_role("student"), json={"ref": "PAY1"}).status_code == 409
    assert _paid_rows(invoice_id, "bkash") == []

    client.post(f"/api/invoices/{invoice_id}/bkash-checkout", headers=as_role("student"))
    gateways.bkash["PAY2"]["state"] = "Cancelled"
    assert client.post("/api/payments/bkash/confirm", headers=as_role("student"), json={"ref": "PAY2"}).json()["status"] == "failed"
    assert client.post("/api/payments/bkash/confirm", headers=as_role("student"), json={"ref": "NOPE"}).status_code == 404
    assert client.post("/api/payments/bkash/confirm", headers=as_role("student"), json={"ref": "../x"}).status_code == 422


# --- Nagad ------------------------------------------------------------------------------


def test_nagad_signed_flow_and_verify(client, as_role, gateways):
    invoice_id = _invoice(client, as_role)
    r = client.post(f"/api/invoices/{invoice_id}/nagad-checkout", headers=as_role("parent"))
    assert r.status_code == 200 and r.json() == {"redirect_url": "https://nagad.test/pay/NREF1"}
    assert gateways.nagad["NREF1"]["amount"] == "700.00"

    confirm = {"ref": "NREF1"}
    assert client.post("/api/payments/nagad/confirm", headers=as_role("student"), json=confirm).json()["status"] == "pending"
    gateways.nagad["NREF1"]["status"] = "Success"
    assert client.post("/api/payments/nagad/confirm", headers=as_role("student"), json=confirm).json()["status"] == "paid"
    assert client.post("/api/payments/nagad/confirm", headers=as_role("parent"), json=confirm).json()["status"] == "paid"
    rows = _paid_rows(invoice_id, "nagad")
    assert len(rows) == 1 and rows[0].amount == "700"


def test_nagad_rejects_other_order_and_bad_signature(client, as_role, gateways, monkeypatch):
    invoice_id = _invoice(client, as_role)
    client.post(f"/api/invoices/{invoice_id}/nagad-checkout", headers=as_role("student"))
    gateways.nagad["NREF1"].update(status="Success", orderId="SOMEONEELSE")
    assert client.post("/api/payments/nagad/confirm", headers=as_role("student"), json={"ref": "NREF1"}).status_code == 409
    assert _paid_rows(invoice_id, "nagad") == []

    # a reply not signed by Nagad's key is refused before anything is sent to the payer
    _, _, other_public = _keypair()
    client.put("/api/payment-gateways/settings", headers=as_role("admin"), json={"nagad": {"nagad_public_key": other_public}})
    monkeypatch.setattr(FakeGateways, "_nagad_open", staticmethod(lambda body: {"merchantId": "M1", "orderId": "X"}))
    assert client.post(f"/api/invoices/{invoice_id}/nagad-checkout", headers=as_role("student")).status_code == 502
