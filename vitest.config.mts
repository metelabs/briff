import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      // `server-only` throws outside a React Server bundle; stub it for tests.
      "server-only": fileURLToPath(new URL("./src/test/empty.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts", "packages/*/src/**/*.test.ts"],
    // DB-backed tests share one database, and the urgent pass and collect-sources work on
    // every org and source in it: run files one at a time when that database is in play.
    fileParallelism: !process.env.TEST_DATABASE_URL,
  },
});
