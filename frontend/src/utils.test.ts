import { describe, expect, it } from "vitest";

import { fromUnix, initials, money, titleCase, toOptions } from "./utils";

describe("fromUnix", () => {
  it("formats unix seconds stored as numbers or strings", () => {
    expect(fromUnix(1772582400)).toBe("04 Mar 2026");
    expect(fromUnix("1772582400", "YYYY-MM-DD")).toBe("2026-03-04");
  });

  it("shows a dash for empty, zero or invalid values", () => {
    for (const value of [null, undefined, "", "0", 0, "abc", -5]) expect(fromUnix(value)).toBe("—");
  });
});

describe("money", () => {
  it("formats with the currency code, accepting legacy text amounts", () => {
    const formatted = money("1234.5", "usd");
    expect(formatted).toContain("1,234.50");
    expect(formatted).toMatch(/\$|USD/);
  });

  it("treats missing amounts as zero", () => {
    expect(money(null, "usd")).toContain("0.00");
  });

  it("falls back to a plain amount for an unknown currency code", () => {
    expect(money(12, "not-a-currency")).toBe("12.00 NOT-A-CURRENCY");
  });
});

describe("small helpers", () => {
  it("titleCase", () => expect(titleCase("payment_method")).toBe("Payment Method"));
  it("initials", () => {
    expect(initials("Rahim Uddin Khan")).toBe("RU");
    expect(initials(null)).toBe("");
  });
  it("toOptions", () => {
    expect(toOptions([{ id: 1, name: "Ten" }, { id: 2, name: null }], "id", "name")).toEqual([
      { value: "1", label: "Ten" },
      { value: "2", label: "" },
    ]);
  });
});
