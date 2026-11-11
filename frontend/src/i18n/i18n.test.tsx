import { render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error -- plain JS build tooling, no types
import { I18N, areas, extract, hardCoded, placeholders, readDictionary, renderEnglish } from "../../scripts/i18n-lib.mjs";
import { Pager } from "../components/Pager";
import { TableState } from "../components/states";
import { Table, TableBody } from "../components/ui/table";
import { navFor } from "../nav";
import { money } from "../utils";
import { formatNumber, normalizeLanguage, t, tn, tp } from "./index";

describe("catalog", () => {
  const { keys, problems } = extract();

  it("is generated from the source (npm run i18n)", () => {
    expect(problems).toEqual([]);
    expect(fs.readFileSync(path.join(I18N, "en.ts"), "utf8")).toBe(renderEnglish(keys));
  });

  it("has a Bangla translation for every key and nothing else", () => {
    const bn = readDictionary("bn");
    expect([...keys.keys()].filter((k) => !bn[k])).toEqual([]);
    expect(Object.keys(bn).filter((k) => !keys.has(k))).toEqual([]);
  });

  it("keeps every {placeholder} in the Bangla text", () => {
    const bn = readDictionary("bn");
    const wrong = [...keys.keys()].filter((k) => JSON.stringify(placeholders(k)) !== JSON.stringify(placeholders(bn[k] ?? "")));
    expect(wrong).toEqual([]);
  });

  it("files every key in one area", () => {
    const filed = Object.values(areas(keys) as Record<string, string[]>).flat();
    expect(filed.length).toBe(keys.size);
  });

  it("finds no hard-coded interface text", () => {
    expect(hardCoded()).toEqual([]);
  });
});

describe("English (default)", () => {
  it("returns the source text unchanged", () => {
    expect(t("Save")).toBe("Save");
    expect(t("Delete {name}?", { name: "Term 1" })).toBe("Delete Term 1?");
    expect(t("{from}–{to} of {total}", { from: 1, to: 50, total: 312 })).toBe("1–50 of 312");
  });

  it("chooses the plural form", () => {
    expect(tp(1, "{count} school day", "{count} school days")).toBe("1 school day");
    expect(tp(0, "{count} school day", "{count} school days")).toBe("0 school days");
    expect(tp(3, "{count} school day", "{count} school days")).toBe("3 school days");
  });

  it("puts elements into text", () => {
    render(<p>{tn("Good morning, {name}", { name: <strong>Rina</strong> })}</p>);
    expect(screen.getByText("Rina").tagName).toBe("STRONG");
    expect(screen.getByText(/Good morning,/)).toHaveTextContent("Good morning, Rina");
  });

  it("formats numbers and money as before", () => {
    expect(formatNumber(1234.5)).toBe("1234.5");
    expect(money(1500, "usd")).toBe(new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(1500));
  });

  it("renders shared components with the same English text", () => {
    render(<Pager page={0} pageSize={50} total={312} onPage={() => {}} />);
    expect(screen.getByText("1–50 of 312")).toBeInTheDocument();
    render(
      <Table>
        <TableBody>
          <TableState empty colSpan={1} />
        </TableBody>
      </Table>,
    );
    expect(screen.getByText("No records yet")).toBeInTheDocument();
    expect(navFor("admin").slice(0, 4).map((n) => n.label)).toEqual(["Dashboard", "Analytics", "Students", "Teachers"]);
  });
});

it("maps the school's language setting", () => {
  expect(normalizeLanguage("english")).toBe("en");
  expect(normalizeLanguage("bengali")).toBe("bn");
  expect(normalizeLanguage("Bangla")).toBe("bn");
  expect(normalizeLanguage(null)).toBe("en");
});

describe("Bangla", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
    document.documentElement.lang = "en";
  });

  it("translates, with Latin digits unless Bangla digits are chosen", async () => {
    localStorage.setItem("sms.language", "bn");
    const i18n = await import("./index");
    await i18n.ready;
    expect(i18n.lang).toBe("bn");
    expect(document.documentElement.lang).toBe("bn");
    expect(i18n.t("Save")).toBe("সংরক্ষণ করুন");
    expect(i18n.t("Delete {name}?", { name: "Term 1" })).toBe("Term 1 মুছে ফেলবেন?");
    expect(i18n.tp(3, "{count} unpaid invoice", "{count} unpaid invoices")).toBe("3টি অপরিশোধিত ইনভয়েস");
    expect(i18n.formatNumber(1234)).toBe("1,234");

    vi.resetModules();
    localStorage.setItem("sms.digits", "beng");
    const withDigits = await import("./index");
    await withDigits.ready;
    expect(withDigits.formatNumber(1234)).toBe("১,২৩৪");
    expect(withDigits.t("Present {present}", { present: 12 })).toBe("উপস্থিত ১২");
    // ids and rolls: digits change, no thousands separator
    expect(withDigits.t("#{invoice_id}", { invoice_id: 12345 })).toBe("#১২৩৪৫");
  });

  it("names months in Bangla but keeps dates sent to the API in Latin digits", async () => {
    localStorage.setItem("sms.language", "bn");
    localStorage.setItem("sms.digits", "beng");
    await import("./index");
    const { default: dayjs } = await import("dayjs");
    expect(dayjs("2026-03-04").format("MMMM")).toBe("মার্চ");
    expect(dayjs("2026-03-04").format("YYYY-MM-DD")).toBe("2026-03-04");
    dayjs.locale("en");
  });
});

describe("choosing a language", () => {
  const reload = vi.fn();
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    reload.mockReset();
    vi.stubGlobal("location", { ...window.location, reload });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("remembers the person's choice and reloads", async () => {
    const i18n = await import("./index");
    i18n.setLanguage("bn");
    expect(localStorage.getItem("sms.language")).toBe("bn");
    expect(reload).toHaveBeenCalledOnce();
    i18n.setLanguage("en"); // already showing English: nothing to rebuild
    expect(reload).toHaveBeenCalledOnce();
  });

  it("follows the school default until the person picks one", async () => {
    const i18n = await import("./index");
    i18n.applySchoolLanguage("bengali");
    expect(localStorage.getItem("sms.schoolLanguage")).toBe("bn");
    expect(reload).toHaveBeenCalledOnce();
    i18n.applySchoolLanguage("bengali"); // unchanged: no second reload
    expect(reload).toHaveBeenCalledOnce();

    vi.resetModules();
    localStorage.setItem("sms.language", "en");
    const chosen = await import("./index");
    chosen.applySchoolLanguage("english");
    chosen.applySchoolLanguage("bengali");
    expect(reload).toHaveBeenCalledOnce(); // the person's own choice wins
  });
});
