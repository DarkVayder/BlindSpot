import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@blindspot\/([a-z-]+)$/,
        replacement: fileURLToPath(new URL("./packages/$1/src/index.ts", import.meta.url)),
      },
    ],
  },
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
  },
});
