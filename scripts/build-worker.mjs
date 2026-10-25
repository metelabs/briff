// Bundles the worker into a single ESM file so the runtime image needs no
// extra node_modules beyond what ships with the Next standalone output.
import { build } from "esbuild";

await build({
  entryPoints: ["src/worker/index.ts"],
  outfile: "dist/worker.mjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  logLevel: "info",
  alias: { "server-only": "./src/test/empty.ts" },
  // Optional native addon of `pg`; never installed.
  external: ["pg-native"],
  // CJS dependencies bundled into ESM still call require/__dirname.
  banner: {
    js: [
      "import { createRequire as __briffCreateRequire } from 'node:module';",
      "import { fileURLToPath as __briffFileURLToPath } from 'node:url';",
      "import { dirname as __briffDirname } from 'node:path';",
      "const require = __briffCreateRequire(import.meta.url);",
      "const __filename = __briffFileURLToPath(import.meta.url);",
      "const __dirname = __briffDirname(__filename);",
    ].join("\n"),
  },
});
