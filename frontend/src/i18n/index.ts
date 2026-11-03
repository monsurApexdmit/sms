/**
 * Interface languages.
 *
 * Messages are keyed by their English text: `t("Save")` returns "Save" in English and the
 * dictionary entry in other languages. The English catalog (./en.ts) is generated from the
 * source by `npm run i18n` and types every key, so a misspelt or new string fails the
 * typecheck until the catalog is regenerated; each other language is a
 * `Record<MessageKey, string>` and so must translate every key.
 *
 * The language is fixed for a page load (module-level labels such as the menu call `t()`
 * when they are first imported), so switching language reloads the page.
 */
import dayjs from "dayjs";
import "dayjs/locale/bn";
import { Fragment, createElement, type ReactNode } from "react";

import { bn } from "./bn";
import type { MessageKey } from "./en";

export type { MessageKey } from "./en";

export type Lang = "en" | "bn";
export type Digits = "latn" | "beng";

export const LANGUAGES: { code: Lang; label: string }[] = [
  { code: "en", label: "English" },
  { code: "bn", label: "বাংলা" },
];

const DICTIONARIES: Record<Exclude<Lang, "en">, Record<MessageKey, string>> = { bn };

const USER_KEY = "sms.language";
const SCHOOL_KEY = "sms.schoolLanguage";
const DIGITS_KEY = "sms.digits";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // private mode or blocked storage: the choice lasts for this page only
  }
}

/** Maps the school's `language` setting (legacy values like "english", "bangla", "bengali") to a language code. */
export function normalizeLanguage(raw: string | null | undefined): Lang {
  return /^(bn|bangla|bangali|bengali|বাংলা)/i.test((raw ?? "").trim()) ? "bn" : "en";
}

const isLang = (v: string | null): v is Lang => v === "en" || v === "bn";

function detect(): Lang {
  const user = read(USER_KEY);
  if (isLang(user)) return user;
  const school = read(SCHOOL_KEY);
  return isLang(school) ? school : "en";
}

/** The language of this page load. */
export const lang: Lang = detect();
/**
 * Bangla digits (০১২…) or Latin digits (012…) for numbers in Bangla (marks, money, counts).
 * Latin by default: easier to read and to type back. Dates always use Latin digits, because
 * the same dayjs formatting also builds the dates sent to the API.
 */
export const digits: Digits = read(DIGITS_KEY) === "beng" ? "beng" : "latn";

const dictionary: Record<string, string> | null = lang === "en" ? null : DICTIONARIES[lang];

if (typeof document !== "undefined") document.documentElement.lang = lang;
// month and weekday names in Bangla; code that compares day names must use .locale("en")
if (lang === "bn") dayjs.locale("bn");

/** BCP 47 locale for Intl formatting; undefined keeps the browser default in English (as before). */
export function intlLocale(): string | undefined {
  if (lang === "en") return undefined;
  return digits === "beng" ? "bn-BD" : "bn-BD-u-nu-latn";
}

type Vars = Record<string, string | number | null | undefined>;

const PLACEHOLDER = /\{(\w+)\}/g;

function lookup(key: string): string {
  // an empty entry is an untranslated key: show the English text
  return dictionary?.[key] || key;
}

function show(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return typeof value === "number" ? formatNumber(value) : value;
}

/** Translated text with `{name}` placeholders filled in. */
export function t(key: MessageKey, vars?: Vars): string {
  const text = lookup(key);
  return vars ? text.replace(PLACEHOLDER, (m, name: string) => (name in vars ? show(vars[name]) : m)) : text;
}

/** Like `t`, for text whose placeholders are elements (links, badges, formatted values). */
export function tn(key: MessageKey, vars: Record<string, ReactNode>): ReactNode {
  const text = lookup(key);
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(PLACEHOLDER)) {
    const name = m[1]!;
    if (m.index! > last) parts.push(text.slice(last, m.index));
    const value = name in vars ? vars[name] : m[0];
    parts.push(typeof value === "number" ? formatNumber(value) : value);
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.map((p, i) => createElement(Fragment, { key: i }, p));
}

/**
 * Count-dependent text: `tp(n, "{count} day", "{count} days")`. The form is chosen with
 * Intl.PluralRules for the active language; both forms are catalog keys.
 */
export function tp(count: number, one: MessageKey, other: MessageKey, vars?: Vars): string {
  const form = new Intl.PluralRules(lang === "en" ? "en" : lang).select(count) === "one" ? one : other;
  return t(form, { count, ...vars });
}

/**
 * Translation of text that is only known at run time (e.g. a status coming from the API).
 * Falls back to the text itself; keys it can find are the ones in the catalog.
 */
export function tDynamic(text: string): string {
  return lookup(text);
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  if (lang === "en" && !options) return String(value);
  return new Intl.NumberFormat(intlLocale(), options).format(value);
}

/** Choose a language for this browser; reloads the page so every label is rebuilt. */
export function setLanguage(next: Lang) {
  write(USER_KEY, next);
  if (next !== lang) location.reload();
}

export function setDigits(next: Digits) {
  write(DIGITS_KEY, next);
  if (next !== digits) location.reload();
}

/**
 * The school's default language (System settings → language). Used until the person
 * picks one; reloads once if it changes what this page shows.
 */
export function applySchoolLanguage(raw: string | null | undefined) {
  const school = normalizeLanguage(raw);
  if (read(SCHOOL_KEY) === school) return;
  write(SCHOOL_KEY, school);
  if (!isLang(read(USER_KEY)) && school !== lang) location.reload();
}
