"""PayPal REST (Orders v2). Orders are created and captured on the server; the
browser only approves them on paypal.com."""

import logging
from typing import Any

import httpx

log = logging.getLogger("paypal")

BASE_URLS = {"sandbox": "https://api-m.sandbox.paypal.com", "production": "https://api-m.paypal.com"}
ZERO_DECIMAL = {"HUF", "JPY", "TWD"}


class PayPalError(Exception):
    pass


def _call(method: str, url: str, **kwargs: Any) -> httpx.Response:
    return httpx.request(method, url, timeout=20, **kwargs)


def format_amount(value: float, currency: str) -> str:
    return f"{value:.0f}" if currency in ZERO_DECIMAL else f"{value:.2f}"


class PayPalClient:
    def __init__(self, mode: str, client_id: str, secret: str):
        self.base = BASE_URLS["sandbox" if mode == "sandbox" else "production"]
        self.client_id, self.secret = client_id, secret
        self._token: str | None = None

    def _request(self, method: str, path: str, *, expect: tuple[int, ...] = (200, 201), **kwargs: Any) -> dict:
        if self._token is None:
            r = self._send(
                "POST", "/v1/oauth2/token", auth=(self.client_id, self.secret), data={"grant_type": "client_credentials"}
            )
            if r.status_code != 200:
                raise PayPalError(f"token request failed with {r.status_code}")
            self._token = r.json().get("access_token")
        headers = {"Authorization": f"Bearer {self._token}", **kwargs.pop("headers", {})}
        r = self._send(method, path, headers=headers, **kwargs)
        if r.status_code not in expect:
            raise PayPalError(f"{method} {path} failed with {r.status_code}: {r.text[:300]}")
        return r.json()

    def _send(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        try:
            return _call(method, self.base + path, **kwargs)
        except httpx.HTTPError as exc:
            raise PayPalError(f"{method} {path}: {exc}") from exc

    def create_order(
        self, *, invoice_id: int, title: str, amount: str, currency: str, return_url: str, cancel_url: str, brand: str
    ) -> dict:
        body = {
            "intent": "CAPTURE",
            "purchase_units": [
                {
                    "reference_id": str(invoice_id),
                    "custom_id": str(invoice_id),
                    "description": title[:127],
                    "amount": {"currency_code": currency, "value": amount},
                }
            ],
            "application_context": {
                "brand_name": brand[:127],
                "shipping_preference": "NO_SHIPPING",
                "user_action": "PAY_NOW",
                "return_url": return_url,
                "cancel_url": cancel_url,
            },
        }
        return self._request("POST", "/v2/checkout/orders", json=body)

    def get_order(self, order_id: str) -> dict:
        return self._request("GET", f"/v2/checkout/orders/{order_id}", expect=(200,))

    def capture_order(self, order_id: str) -> dict:
        # The request id makes PayPal answer repeated captures of the same order with the same result.
        return self._request(
            "POST",
            f"/v2/checkout/orders/{order_id}/capture",
            json={},
            headers={"PayPal-Request-Id": f"capture-{order_id}", "Prefer": "return=representation"},
        )


def approve_link(order: dict) -> str | None:
    for link in order.get("links", []):
        if link.get("rel") in ("approve", "payer-action"):
            return link.get("href")
    return None


def order_invoice_id(order: dict) -> int | None:
    units = order.get("purchase_units") or [{}]
    raw = units[0].get("custom_id") or units[0].get("reference_id") or ""
    return int(raw) if str(raw).isdigit() else None


def completed_capture(order: dict) -> dict | None:
    units = order.get("purchase_units") or [{}]
    for cap in (units[0].get("payments") or {}).get("captures", []):
        if cap.get("status") == "COMPLETED":
            return cap
    return None
