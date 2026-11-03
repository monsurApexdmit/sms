"""bKash, Nagad and SSLCommerz (Bangladesh, BDT only).

Same model as PayPal: the server starts each payment for the amount still due on the
invoice, and records it only after asking the gateway itself (server to server) that
it was paid, for that amount, in BDT. The browser never tells us an amount or a result.

Each gateway's settings are one `settings` row holding a JSON object (key = gateway).
Endpoints and payloads follow the gateways' public developer documentation; see the
README section "bKash, Nagad and SSLCommerz" for what to re-check in each sandbox.
"""

import base64
import json
import logging
import secrets
import time
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from sqlalchemy.orm import Session

from app.core.redis import get_redis
from app.services.settings import MASK, get_setting

log = logging.getLogger("local_gateways")

LABELS = {"bkash": "bKash", "nagad": "Nagad", "sslcommerz": "SSLCommerz"}
FIELDS: dict[str, tuple[str, ...]] = {
    "sslcommerz": ("active", "mode", "store_id", "store_password"),
    "bkash": ("active", "mode", "app_key", "app_secret", "username", "password"),
    "nagad": ("active", "mode", "merchant_id", "merchant_number", "merchant_private_key", "nagad_public_key"),
}
SECRET_FIELDS = {"store_password", "app_secret", "password", "merchant_private_key"}
MODES = ("sandbox", "live")


class GatewayError(Exception):
    pass


def _call(method: str, url: str, **kwargs: Any) -> httpx.Response:
    return httpx.request(method, url, timeout=30, **kwargs)


def _json(method: str, url: str, **kwargs: Any) -> Any:
    try:
        r = _call(method, url, **kwargs)
    except httpx.HTTPError as exc:
        raise GatewayError(f"{method} {url.split('?')[0]}: {exc}") from exc
    if r.status_code >= 400:
        raise GatewayError(f"{method} {url.split('?')[0]} failed with {r.status_code}: {r.text[:300]}")
    try:
        return r.json()
    except ValueError:
        raise GatewayError(f"{method} {url.split('?')[0]} did not return JSON") from None


def money(value: float) -> str:
    return f"{value:.2f}"


def same_amount(reported: Any, expected: float) -> bool:
    try:
        return abs(float(reported) - expected) <= 0.005
    except (TypeError, ValueError):
        return False


# --- settings -------------------------------------------------------------------


def get_config(db: Session, gateway: str) -> dict[str, str]:
    try:
        data = json.loads(get_setting(db, gateway, "{}") or "{}")
    except ValueError:
        return {}
    if not isinstance(data, dict):
        return {}
    return {k: str(v) for k, v in data.items() if k in FIELDS[gateway] and v is not None}


def masked_config(db: Session, gateway: str) -> dict[str, str]:
    cfg = get_config(db, gateway)
    out = {k: cfg.get(k, "") for k in FIELDS[gateway]}
    out.setdefault("mode", "sandbox")
    out["mode"] = out["mode"] or "sandbox"
    out["active"] = out["active"] or "0"
    return {k: (MASK if k in SECRET_FIELDS and v else v) for k, v in out.items()}


def merge_config(db: Session, gateway: str, incoming: dict[str, Any]) -> str:
    """New stored JSON. "********" (or a missing key) keeps the stored value. Raises ValueError on bad input."""
    unknown = set(incoming) - set(FIELDS[gateway])
    if unknown:
        raise ValueError(f"Unknown {LABELS[gateway]} settings: {', '.join(sorted(unknown))}")
    clean = {k: "" if v is None else str(v).strip() for k, v in incoming.items() if v != MASK}
    if clean.get("active", "0") not in ("0", "1"):
        raise ValueError("active must be \"0\" or \"1\"")
    if clean.get("mode", "sandbox") not in MODES:
        raise ValueError("mode must be sandbox or live")
    return json.dumps({**get_config(db, gateway), **clean})


def bdt_currency(db: Session) -> bool:
    return get_setting(db, "currency", "usd").strip().lower() == "bdt"


def enabled_config(db: Session, gateway: str) -> dict[str, str] | None:
    """The gateway's settings when it is switched on, fully configured and the school bills in BDT."""
    cfg = get_config(db, gateway)
    if cfg.get("active") != "1" or not bdt_currency(db):
        return None
    if any(not cfg.get(k) for k in FIELDS[gateway] if k not in ("active", "mode")):
        return None
    cfg["mode"] = cfg.get("mode") if cfg.get("mode") in MODES else "sandbox"
    return cfg


def enabled_gateways(db: Session) -> list[str]:
    return [g for g in FIELDS if enabled_config(db, g) is not None]


# --- SSLCommerz ---------------------------------------------------------------------
# Hosted checkout: init a session, send the payer to GatewayPageURL; the result is
# confirmed with the validation API (val_id), never from the posted form itself.

SSL_BASE = {"sandbox": "https://sandbox.sslcommerz.com", "live": "https://securepay.sslcommerz.com"}
SSL_OK = ("VALID", "VALIDATED")


def ssl_init(cfg: dict[str, str], *, tran_id: str, amount: float, urls: dict[str, str], customer: dict[str, str], product: str) -> str:
    data = {
        "store_id": cfg["store_id"], "store_passwd": cfg["store_password"],
        "total_amount": money(amount), "currency": "BDT", "tran_id": tran_id,
        "success_url": urls["success"], "fail_url": urls["fail"], "cancel_url": urls["cancel"], "ipn_url": urls["ipn"],
        "product_name": product[:255], "product_category": "Education", "product_profile": "non-physical-goods",
        "shipping_method": "NO", "num_of_item": "1",
        "cus_name": customer.get("name") or "Customer", "cus_email": customer.get("email") or "noreply@example.com",
        "cus_phone": customer.get("phone") or "01700000000", "cus_add1": customer.get("address") or "N/A",
        "cus_city": "N/A", "cus_country": "Bangladesh",
    }  # fmt: skip
    body = _json("POST", f"{SSL_BASE[cfg['mode']]}/gwprocess/v4/api.php", data=data)
    url = body.get("GatewayPageURL") if isinstance(body, dict) else None
    if not url or str(body.get("status", "")).upper() != "SUCCESS":
        raise GatewayError(f"SSLCommerz session failed: {str(body.get('failedreason') if isinstance(body, dict) else body)[:200]}")
    return url


def ssl_validate(cfg: dict[str, str], val_id: str) -> dict:
    params = {"val_id": val_id, "store_id": cfg["store_id"], "store_passwd": cfg["store_password"], "v": "1", "format": "json"}
    body = _json("GET", f"{SSL_BASE[cfg['mode']]}/validator/api/validationserverAPI.php", params=params)
    return body if isinstance(body, dict) else {}


def ssl_find_valid(cfg: dict[str, str], tran_id: str) -> str | None:
    """val_id of a successful payment for our tran_id, if SSLCommerz has one."""
    params = {"tran_id": tran_id, "store_id": cfg["store_id"], "store_passwd": cfg["store_password"], "format": "json"}
    body = _json("GET", f"{SSL_BASE[cfg['mode']]}/validator/api/merchantTransIDvalidationAPI.php", params=params)
    for row in (body.get("element") or []) if isinstance(body, dict) else []:
        if str(row.get("status", "")).upper() in SSL_OK and row.get("tran_id") == tran_id and row.get("val_id"):
            return str(row["val_id"])
    return None


# --- bKash (tokenized checkout) --------------------------------------------------------

BKASH_BASE = {"sandbox": "https://tokenized.sandbox.bka.sh/v1.2.0-beta", "live": "https://tokenized.pay.bka.sh/v1.2.0-beta"}
_bkash_tokens: dict[str, tuple[str, float]] = {}


def _bkash_token(cfg: dict[str, str]) -> str:
    """id_token from the grant API, cached until shortly before it expires (Redis when configured)."""
    key = f"bkash:token:{cfg['mode']}:{cfg['app_key']}"
    redis = get_redis()
    if redis is not None:
        cached = redis.get(key)
        if cached:
            return cached.decode() if isinstance(cached, bytes) else str(cached)
    else:
        token, expires = _bkash_tokens.get(key, ("", 0.0))
        if token and expires > time.time():
            return token
    body = _json(
        "POST", f"{BKASH_BASE[cfg['mode']]}/tokenized/checkout/token/grant",
        headers={"username": cfg["username"], "password": cfg["password"], "Accept": "application/json"},
        json={"app_key": cfg["app_key"], "app_secret": cfg["app_secret"]},
    )  # fmt: skip
    token = body.get("id_token") if isinstance(body, dict) else None
    if not token:
        raise GatewayError(f"bKash token grant failed: {str(body)[:200]}")
    ttl = max(int(body.get("expires_in") or 3600) - 120, 60)
    if redis is not None:
        redis.setex(key, ttl, token)
    else:
        _bkash_tokens[key] = (token, time.time() + ttl)
    return token


def _bkash(cfg: dict[str, str], path: str, payload: dict) -> dict:
    headers = {"Authorization": _bkash_token(cfg), "X-APP-Key": cfg["app_key"], "Accept": "application/json"}
    body = _json("POST", f"{BKASH_BASE[cfg['mode']]}/tokenized/checkout/{path}", headers=headers, json=payload)
    return body if isinstance(body, dict) else {}


def bkash_create(cfg: dict[str, str], *, amount: float, invoice_number: str, callback_url: str) -> dict:
    body = _bkash(cfg, "create", {
        "mode": "0011", "payerReference": invoice_number, "callbackURL": callback_url,
        "amount": money(amount), "currency": "BDT", "intent": "sale", "merchantInvoiceNumber": invoice_number,
    })  # fmt: skip
    if body.get("statusCode") != "0000" or not body.get("paymentID") or not body.get("bkashURL"):
        raise GatewayError(f"bKash create failed: {body.get('statusCode')} {body.get('statusMessage')}")
    return body


def bkash_execute(cfg: dict[str, str], payment_id: str) -> dict:
    return _bkash(cfg, "execute", {"paymentID": payment_id})


def bkash_query(cfg: dict[str, str], payment_id: str) -> dict:
    return _bkash(cfg, "payment/status", {"paymentID": payment_id})


# --- Nagad (merchant API) ---------------------------------------------------------------
# Sensitive data is RSA-encrypted with Nagad's public key and signed (SHA256withRSA) with
# the merchant's private key; Nagad answers encrypted with the merchant's public key.

NAGAD_BASE = {
    "sandbox": "http://sandbox.mynagad.com:10080/remote-payment-gateway-1.0/api/dfs",
    "live": "https://api.mynagad.com/api/dfs",
}
NAGAD_HEADERS = {"X-KM-Api-Version": "v-0.2.0", "X-KM-Client-Type": "PC_WEB", "Accept": "application/json"}


def _key_bytes(raw: str) -> bytes:
    """PEM, or the bare base64 key Nagad hands out."""
    text = raw.strip()
    if text.startswith("-----BEGIN"):
        return text.encode()
    return base64.b64decode("".join(text.split()))


def _public_key(raw: str):
    data = _key_bytes(raw)
    return serialization.load_pem_public_key(data) if data.startswith(b"-----") else serialization.load_der_public_key(data)


def _private_key(raw: str):
    data = _key_bytes(raw)
    load = serialization.load_pem_private_key if data.startswith(b"-----") else serialization.load_der_private_key
    return load(data, password=None)


def _encrypt(cfg: dict[str, str], payload: dict) -> str:
    plain = json.dumps(payload, separators=(",", ":")).encode()
    return base64.b64encode(_public_key(cfg["nagad_public_key"]).encrypt(plain, padding.PKCS1v15())).decode()


def _sign(cfg: dict[str, str], payload: dict) -> str:
    plain = json.dumps(payload, separators=(",", ":")).encode()
    return base64.b64encode(_private_key(cfg["merchant_private_key"]).sign(plain, padding.PKCS1v15(), hashes.SHA256())).decode()


def _decrypt_and_verify(cfg: dict[str, str], sensitive: str, signature: str) -> dict:
    try:
        plain = _private_key(cfg["merchant_private_key"]).decrypt(base64.b64decode(sensitive), padding.PKCS1v15())
        _public_key(cfg["nagad_public_key"]).verify(base64.b64decode(signature), plain, padding.PKCS1v15(), hashes.SHA256())
        return json.loads(plain)
    except Exception as exc:  # bad key, padding, signature or JSON
        raise GatewayError(f"Nagad response could not be decrypted or verified: {exc.__class__.__name__}") from None


def nagad_checkout(cfg: dict[str, str], *, order_id: str, amount: float, callback_url: str, client_ip: str, invoice_id: int) -> tuple[str, str]:
    """Initialize + complete; returns (paymentReferenceId, URL to send the payer to)."""
    base, merchant = NAGAD_BASE[cfg["mode"]], cfg["merchant_id"]
    headers = {**NAGAD_HEADERS, "X-KM-IP-V4": client_ip}
    stamp = datetime.now(ZoneInfo("Asia/Dhaka")).strftime("%Y%m%d%H%M%S")
    init_data = {"merchantId": merchant, "datetime": stamp, "orderId": order_id, "challenge": secrets.token_hex(20)}
    body = _json("POST", f"{base}/check-out/initialize/{merchant}/{order_id}", headers=headers, json={
        "accountNumber": cfg["merchant_number"], "dateTime": stamp,
        "sensitiveData": _encrypt(cfg, init_data), "signature": _sign(cfg, init_data),
    })  # fmt: skip
    if not isinstance(body, dict) or not body.get("sensitiveData"):
        raise GatewayError(f"Nagad initialize failed: {str(body)[:200]}")
    reply = _decrypt_and_verify(cfg, body["sensitiveData"], body.get("signature", ""))
    ref, challenge = reply.get("paymentReferenceId"), reply.get("challenge")
    if not ref or not challenge:
        raise GatewayError("Nagad initialize returned no payment reference")
    order = {"merchantId": merchant, "orderId": order_id, "currencyCode": "050", "amount": money(amount), "challenge": challenge}
    done = _json("POST", f"{base}/check-out/complete/{ref}", headers=headers, json={
        "sensitiveData": _encrypt(cfg, order), "signature": _sign(cfg, order),
        "merchantCallbackURL": callback_url, "additionalMerchantInfo": {"invoice_id": str(invoice_id)},
    })  # fmt: skip
    url = done.get("callBackUrl") if isinstance(done, dict) else None
    if not url or str(done.get("status", "")).lower() != "success":
        raise GatewayError(f"Nagad complete failed: {str(done)[:200]}")
    return str(ref), url


def nagad_verify(cfg: dict[str, str], payment_ref_id: str) -> dict:
    body = _json("GET", f"{NAGAD_BASE[cfg['mode']]}/verify/payment/{payment_ref_id}", headers=NAGAD_HEADERS)
    return body if isinstance(body, dict) else {}
