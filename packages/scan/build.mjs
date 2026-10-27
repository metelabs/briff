// Bundles the CLI and its parsing dependencies (yaml, smol-toml, fast-xml-parser) into dist/cli.mjs, so
// `npx briff-scan` installs nothing else. Runs from any directory; esbuild resolves from the repo root.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const require = createRequire(import.meta.url);
// The package root holds the licence; smol-toml's `exports` hide its package.json, so walk up
// from the resolved entry point to the `node_modules/<pkg>` directory.
const licenseOf = (pkg) => {
  const entry = require.resolve(pkg);
  const marker = `${path.sep}node_modules${path.sep}${pkg}${path.sep}`;
  return readFile(
    path.join(entry.slice(0, entry.lastIndexOf(marker) + marker.length), "LICENSE"),
    "utf8"
  );
};
const yamlLicense = await licenseOf("yaml");
const tomlLicense = await licenseOf("smol-toml");
const xmlLicense = await licenseOf("fast-xml-parser");

await build({
  entryPoints: [here("./src/cli.ts")],
  outfile: here("./dist/cli.mjs"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  // Readable output: the package is what users audit before giving it their lockfiles.
  minify: false,
  legalComments: "eof",
  logLevel: "info",
  // yaml's Node build is CommonJS and requires node builtins; give the ESM bundle a require.
  banner: {
    js: [
      "#!/usr/bin/env node",
      "import { createRequire as __briffCreateRequire } from 'node:module';",
      "const require = __briffCreateRequire(import.meta.url);",
    ].join("\n"),
  },
  footer: {
    js: [
      `/*! Bundled dependency yaml (ISC licence):\n${yamlLicense.trim()}\n*/`,
      `/*! Bundled dependency smol-toml (BSD-3-Clause licence):\n${tomlLicense.trim()}\n*/`,
      `/*! Bundled dependency fast-xml-parser (MIT licence):\n${xmlLicense.trim()}\n*/`,
    ].join("\n"),
  },
});
