import { describe, expect, it } from "vitest";

import { underPrefix } from "./hooks";

describe("underPrefix", () => {
  it("covers the path, its params and its sub-paths", () => {
    expect(underPrefix(["/students", { class_id: 1 }], ["/students"])).toBe(true);
    expect(underPrefix(["/students/5", undefined], ["/students"])).toBe(true);
    expect(underPrefix(["/admissions/1", undefined], ["/admissions"])).toBe(true);
    expect(underPrefix(["/admissions/summary", undefined], ["/admissions"])).toBe(true);
  });

  it("does not reach unrelated paths", () => {
    expect(underPrefix(["/students-extra"], ["/students"])).toBe(false);
    expect(underPrefix(["/teachers"], ["/students"])).toBe(false);
    // with params, only the same path matches
    expect(underPrefix(["/students/5", { a: 1 }], ["/students", { a: 1 }])).toBe(false);
    expect(underPrefix(["/students", { a: 1, b: 2 }], ["/students", { a: 1 }])).toBe(true);
  });
});
