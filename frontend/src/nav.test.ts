import { describe, expect, it } from "vitest";

import type { Role } from "./api/types";
import appSource from "./App.tsx?raw";
import { NAV, canAccess, navFor } from "./nav";

const ROLES: Role[] = ["admin", "teacher", "student", "parent", "librarian", "accountant"];

// Pages that hold other people's data or school-wide settings.
const ONLY: Record<string, Role[]> = {
  settings: ["admin"],
  "audit-log": ["admin"],
  "school-years": ["admin"],
  staff: ["admin"],
  parents: ["admin"],
  "salary-structures": ["admin"],
  "staff-attendance": ["admin"],
  "cards-devices": ["admin"],
  invoices: ["admin", "accountant"],
  accounting: ["admin", "accountant"],
  payroll: ["admin", "accountant"],
  "fee-setup": ["admin", "accountant"],
  students: ["admin", "teacher"],
  marks: ["admin", "teacher"],
  attendance: ["admin", "teacher"],
  analytics: ["admin", "teacher", "accountant"],
  "my-invoices": ["student", "parent"],
  "book-meeting": ["parent"],
};

describe("navigation access", () => {
  it.each(Object.entries(ONLY))("%s is open only to its roles", (path, allowed) => {
    for (const role of ROLES) expect(canAccess(role, path), `${role} → ${path}`).toBe(allowed.includes(role));
  });

  it.each(ROLES)("%s reaches the pages every role needs", (role) => {
    for (const path of ["dashboard", "profile", "notifications", "leave", "calendar"]) expect(canAccess(role, path)).toBe(true);
  });

  it("navFor lists exactly the pages canAccess allows", () => {
    for (const role of ROLES) {
      const paths = new Set(navFor(role).map((n) => n.path));
      for (const item of NAV) expect(paths.has(item.path), `${role} ${item.path}`).toBe(canAccess(role, item.path));
    }
  });

  it("unknown pages are closed", () => {
    expect(canAccess("admin", "no-such-page")).toBe(false);
  });

  it("every menu entry has a route", () => {
    const routed = new Set([...appSource.matchAll(/^\s*\["([a-z-]+)",\s*</gm)].map((m) => m[1]));
    const missing = NAV.filter((n) => !n.path.startsWith("/") && !routed.has(n.path)).map((n) => n.path);
    expect(missing).toEqual([]);
  });

  it("no page is listed twice for the same role", () => {
    for (const role of ROLES) {
      const paths = navFor(role).map((n) => n.path);
      expect(new Set(paths).size).toBe(paths.length);
    }
  });
});
