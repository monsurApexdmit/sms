"""Email and SMS delivery using the providers configured in the `settings` table.
Run as jobs (app.services.jobs.enqueue) so requests never wait on SMTP/SMS. Delivery
errors are raised so the job queue can retry them; missing configuration is only logged."""

import logging
import smtplib
from email.message import EmailMessage

import httpx

from sqlalchemy.orm import Session

from app.db import new_session
from app.services.settings import get_setting

log = logging.getLogger("notify")


def sms_enabled(db: Session) -> bool:
    return get_setting(db, "active_sms_service", "disabled") not in ("", "disabled")


def send_email(to: str, subject: str, body: str) -> None:
    with new_session() as db:
        host = get_setting(db, "smtp_host")
        port = int(get_setting(db, "smtp_port", "0") or 0)
        user = get_setting(db, "smtp_user")
        password = get_setting(db, "smtp_pass")
        sender = get_setting(db, "system_email") or user
        school = get_setting(db, "system_name", "School")
    if not (host and port and user):
        log.warning("SMTP not configured; email to %s not sent. Subject=%r\n%s", to, subject, body)
        return
    msg = EmailMessage()
    msg["From"] = f"{school} <{sender}>"
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    use_ssl = host.startswith("ssl://")
    host = host.removeprefix("ssl://").removeprefix("tls://")
    if use_ssl or port == 465:
        with smtplib.SMTP_SSL(host, port, timeout=20) as smtp:
            smtp.login(user, password)
            smtp.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=20) as smtp:
            smtp.starttls()
            smtp.login(user, password)
            smtp.send_message(msg)


def send_sms(phone: str, text: str) -> None:
    with new_session() as db:
        service = get_setting(db, "active_sms_service", "disabled")
        cfg = {
            key: get_setting(db, key)
            for key in (
                "clickatell_user", "clickatell_password", "clickatell_api_id",
                "twilio_account_sid", "twilio_auth_token", "twilio_sender_phone_number",
                "msg91_authentication_key", "msg91_sender_ID", "msg91_route", "msg91_country_code",
            )
        }  # fmt: skip
    if service == "clickatell" and cfg["clickatell_api_id"]:
        # Clickatell HTTP API (user/password/api_id credentials, as configured in the legacy app).
        r = httpx.get(
            "https://api.clickatell.com/http/sendmsg",
            params={
                "user": cfg["clickatell_user"],
                "password": cfg["clickatell_password"],
                "api_id": cfg["clickatell_api_id"],
                "to": phone,
                "text": text,
            },
            timeout=20,
        )
        r.raise_for_status()
        if not r.text.startswith("ID:"):
            log.error("Clickatell rejected SMS to %s: %s", phone, r.text.strip()[:200])
    elif service == "twilio" and cfg["twilio_account_sid"]:
        sid = cfg["twilio_account_sid"]
        httpx.post(
            f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json",
            auth=(sid, cfg["twilio_auth_token"]),
            data={"From": cfg["twilio_sender_phone_number"], "To": phone, "Body": text},
            timeout=20,
        ).raise_for_status()
    elif service == "msg91" and cfg["msg91_authentication_key"]:
        httpx.get(
            "https://api.msg91.com/api/sendhttp.php",
            params={
                "authkey": cfg["msg91_authentication_key"],
                "mobiles": phone,
                "message": text,
                "sender": cfg["msg91_sender_ID"],
                "route": cfg["msg91_route"],
                "country": cfg["msg91_country_code"],
            },
            timeout=20,
        ).raise_for_status()
    else:
        log.info("SMS service %r not configured; SMS to %s skipped: %s", service, phone, text)
