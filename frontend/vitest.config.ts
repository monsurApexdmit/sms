import { defineConfig, mergeConfig } from "vitest/config";

import viteConfig from "./vite.config";

// Same dates and number formats on every machine; test workers inherit these.
process.env.TZ = "UTC";
process.env.LC_ALL = "en_US.UTF-8";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      include: ["src/**/*.test.{ts,tsx}"],
      restoreMocks: true,
    },
  }),
);
