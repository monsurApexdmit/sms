"""Texts the server sends to people (in-app notifications, emails, SMS), in the school's
language: the legacy `language` setting ("english", "bengali", ...). English is the default
and is exactly what was sent before; add a language by adding its column to CATALOG.

API error messages (`detail`) stay in English; the web app shows its own translations.
"""

import re
from datetime import date

from sqlalchemy.orm import Session

from app.services.settings import get_setting

LANGS = ("en", "bn")

CATALOG: dict[str, dict[str, str]] = {
    # attendance
    "attendance.absent.title": {"en": "{name} is absent", "bn": "{name} অনুপস্থিত"},
    "attendance.absent.text": {"en": "Your child {name} is absent today ({date}).", "bn": "আপনার সন্তান {name} আজ ({date}) অনুপস্থিত।"},
    # leave
    "leave.title.approved": {"en": "Leave request approved", "bn": "ছুটির আবেদন অনুমোদিত"},
    "leave.title.rejected": {"en": "Leave request rejected", "bn": "ছুটির আবেদন প্রত্যাখ্যাত"},
    "leave.text.approved": {"en": "Leave for {name} ({span}) was approved.{note}", "bn": "{name}-এর ছুটি ({span}) অনুমোদিত হয়েছে।{note}"},
    "leave.text.rejected": {"en": "Leave for {name} ({span}) was rejected.{note}", "bn": "{name}-এর ছুটি ({span}) প্রত্যাখ্যাত হয়েছে।{note}"},
    "leave.span": {"en": "{start} to {end}", "bn": "{start} থেকে {end}"},
    "leave.note": {"en": " Note: {note}", "bn": " নোট: {note}"},
    "word.your_child": {"en": "your child", "bn": "আপনার সন্তান"},
    "word.you": {"en": "you", "bn": "আপনার"},
    # homework
    "homework.graded.title": {"en": "Homework graded: {title}", "bn": "বাড়ির কাজ মূল্যায়িত: {title}"},
    "homework.graded.text": {"en": "{name}'s homework \"{title}\" has been graded: {score}.", "bn": "{name}-এর বাড়ির কাজ \"{title}\" মূল্যায়ন করা হয়েছে: {score}।"},
    "homework.graded.feedback": {"en": "\n\nFeedback:\n{feedback}", "bn": "\n\nমতামত:\n{feedback}"},
    "homework.no_marks": {"en": "no marks", "bn": "নম্বর ছাড়া"},
    # fees
    "fees.reminder.title": {"en": "Fee reminder: {title}", "bn": "ফি পরিশোধের অনুস্মারক: {title}"},
    "fees.reminder.is_due": {"en": "{name}: {title} ({amount} {currency}) is due on {date}.", "bn": "{name}: {title} ({amount} {currency}) পরিশোধের শেষ তারিখ {date}।"},
    "fees.reminder.was_due": {"en": "{name}: {title} ({amount} {currency}) was due on {date}.", "bn": "{name}: {title} ({amount} {currency}) পরিশোধের শেষ তারিখ ছিল {date}।"},
    "fees.reminder.body": {"en": "{text}\n\nPlease pay at the school office or online.\n\n{school}", "bn": "{text}\n\nঅনুগ্রহ করে বিদ্যালয়ের অফিসে অথবা অনলাইনে পরিশোধ করুন।\n\n{school}"},
    # parent-teacher meetings
    "meetings.subject.booked": {"en": "Parent-teacher meeting booked: {when}", "bn": "অভিভাবক-শিক্ষক সভা নির্ধারিত: {when}"},
    "meetings.subject.cancelled": {"en": "Parent-teacher meeting cancelled: {when}", "bn": "অভিভাবক-শিক্ষক সভা বাতিল: {when}"},
    "meetings.location": {"en": "\nLocation: {location}", "bn": "\nস্থান: {location}"},
    "meetings.body": {
        "en": "{title}\n{when}{where}\n\nStudent: {child}\nParent: {parent}\nTeacher: {teacher}\n{agenda}\n\n{school}",
        "bn": "{title}\n{when}{where}\n\nশিক্ষার্থী: {child}\nঅভিভাবক: {parent}\nশিক্ষক: {teacher}\n{agenda}\n\n{school}",
    },
    "meetings.agenda": {"en": "Agenda: {note}", "bn": "আলোচ্য বিষয়: {note}"},
    "meetings.short": {"en": "{child} with {teacher}, {when}", "bn": "{child}, {teacher}-এর সাথে, {when}"},
    "word.the_teacher": {"en": "the teacher", "bn": "শিক্ষক"},
    # admissions
    "admissions.subject": {"en": "{school}: admission application {reference}", "bn": "{school}: ভর্তির আবেদন {reference}"},
    "admissions.greeting": {"en": "Dear {name},", "bn": "প্রিয় {name},"},
    "admissions.accepted": {
        "en": "We are pleased to tell you that the application for {name} has been accepted. The school office will contact you about enrolment.",
        "bn": "আমরা আনন্দের সাথে জানাচ্ছি যে {name}-এর আবেদন গৃহীত হয়েছে। ভর্তির বিষয়ে বিদ্যালয়ের অফিস আপনার সাথে যোগাযোগ করবে।",
    },
    "admissions.rejected": {
        "en": "We are sorry to tell you that we cannot offer a place to {name} at this time.",
        "bn": "দুঃখের সাথে জানাচ্ছি যে এই মুহূর্তে আমরা {name}-কে ভর্তির সুযোগ দিতে পারছি না।",
    },
    "admissions.reference": {"en": "Application reference: {reference}", "bn": "আবেদনের রেফারেন্স: {reference}"},
    # notices
    "notices.text": {"en": "{title} on {date}", "bn": "{title}, {date}"},
    "notices.default_title": {"en": "New notice", "bn": "নতুন নোটিশ"},
    # notifications
    "notifications.test.title": {"en": "Test notification", "bn": "পরীক্ষামূলক বিজ্ঞপ্তি"},
    "notifications.test.text": {"en": "Notifications are working.", "bn": "বিজ্ঞপ্তি ঠিকমতো কাজ করছে।"},
}

_BN_MONTHS = ("জানু", "ফেব্রু", "মার্চ", "এপ্রিল", "মে", "জুন", "জুলাই", "আগস্ট", "সেপ্ট", "অক্টো", "নভে", "ডিসে")
_PLACEHOLDER = re.compile(r"\{(\w+)\}")


def normalize(raw: str | None) -> str:
    """The legacy setting ("english", "bengali", "bangla", "bn", ...) as a catalog language."""
    return "bn" if re.match(r"(bn|bangla|bangali|bengali)", (raw or "").strip(), re.I) else "en"


def school_language(db: Session) -> str:
    return normalize(get_setting(db, "language", "english"))


def msg(lang: str, key: str, **values: object) -> str:
    """The message `key` in `lang` (falls back to English) with its {placeholders} filled in."""
    texts = CATALOG[key]
    text = texts.get(lang) or texts["en"]
    return _PLACEHOLDER.sub(lambda m: str(values[m.group(1)]) if m.group(1) in values else m.group(0), text)


def short_date(lang: str, d: date) -> str:
    """"04 Mar 2026" (as before) in English, "04 মার্চ 2026" in Bangla."""
    if lang == "bn":
        return f"{d.day:02d} {_BN_MONTHS[d.month - 1]} {d.year}"
    return d.strftime("%d %b %Y")
