import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@crm/schemas": new URL("../schemas/src/index.ts", import.meta.url).pathname,
      "@crm/core/forecast": new URL("../core/src/forecast/index.ts", import.meta.url).pathname,
      "@crm/core": new URL("../core/src/index.ts", import.meta.url).pathname,
    },
  },
});
