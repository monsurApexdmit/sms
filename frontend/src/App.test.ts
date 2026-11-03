import { describe, expect, it } from "vitest";

import appSource from "./App.tsx?raw";

// App.tsx loads pages with page(() => import("./pages/X"), "Name"); a wrong name only fails at runtime.
const LAZY = [...appSource.matchAll(/page\(\(\) => import\("(\.\/pages\/[^"]+)"\), "(\w+)"\)/g)].map((m) => [m[1]!, m[2]!] as const);
const modules = import.meta.glob("./pages/**/*.tsx");

describe("lazy pages", () => {
  it("finds the page list", () => expect(LAZY.length).toBeGreaterThan(40));

  it.each(LAZY)("%s exports %s", async (path, name) => {
    const load = modules[`${path}.tsx`];
    expect(load, `${path}.tsx exists`).toBeDefined();
    const mod = (await load!()) as Record<string, unknown>;
    expect(typeof mod[name]).toBe("function");
  });
});
