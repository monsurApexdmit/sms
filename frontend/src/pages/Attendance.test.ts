import { describe, expect, it } from "vitest";

import { offTitle, type MonthCalendar } from "./Attendance";

const cal: MonthCalendar = { holidays: { "16": "Victory Day", "4": "Founders' day" }, off_days: [4, 11], working_days: 20 };

describe("offTitle", () => {
  it("names the holiday, even when it falls on a weekly day off", () => {
    expect(offTitle(cal, 16)).toBe("Victory Day");
    expect(offTitle(cal, 4)).toBe("Founders' day");
  });

  it("marks weekly days off", () => expect(offTitle(cal, 11)).toBe("Weekly day off"));

  it("is undefined on school days", () => expect(offTitle(cal, 12)).toBeUndefined());
});
