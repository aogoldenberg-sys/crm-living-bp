import { defineConfig } from "vitest/config";
import { webcrypto } from "node:crypto";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./src/test-setup.ts"],
  },
});

// Подавить предупреждение о неиспользуемом импорте
void webcrypto;
