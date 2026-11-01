import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

// The public tree must not name the maintainer's private repos, customers, servers or
// accounts. Fixtures use synthetic names (acme, sigma/*, *.example) instead. The list is kept
// as sha256 hashes of lower-cased tokens so that this test does not publish the names it
// guards; the maintainer keeps the plain list outside the repository. To add a name:
//   printf %s "name" | sha256sum
const PRIVATE_TOKEN_HASHES = new Set([
  "86af935430534e7ab13ab0f4b93c044f492c1a84d966eb68e6bbe83e3a80722b",
  "983f27a707f45241a33a89080a77e10e6ba70cc0d7bef2990431245dd3ed732a",
  "467b46ae7c561d1b629f8000eef16bf88e6dc976f99ce1ff95511a0e4f4ea7f0",
  "68943e475d2a41271c84fd26f13737a9ca76fa66f00685ff74ca5f86033ba57b",
  "7fa5d52b2d02a2ee35ae6c38e0b585419dc40ab11b6b694858793d96750efbe0",
  "c796fc74628aee28c0c830412827548dd2532d2eb79cceb74dbd9d0376c1ff75",
  "0036d0ff78f94a8bca776d4a28ec7703baabbc3f54a0f9ae1c1d380681d8d7cd",
  "ef2040b7279cfcfd9e2b91a2100911032b3ba4e94fb3051961fb8a75bd118793",
  "901eb0c320a0e057c54c793c968b2d6cad7633964cc2d2d46ad7fe445904f671",
  "194cd75061f3359c87cbca5dfb9bbf5b352aecf4c4bf7d8279050f3202b02b22",
  "949cf01c2c5166b277dbe6d11fd2b70bcc30ea9fd55007bb0d89349e5ca95026",
  "a38e567fec432004f6e13a290a52ff111d0adb9f8f13895e14ee43f28fef76c1",
  "1f001832615208855b9d44132a0c60738e8956139263bcbe5a98bf83a3dd605d",
  "a6d78b9a00650e431c987a03585514fada9ff64a68ed87cb326fdf4cfc8d7d83",
  "7c8c8292c02c951a3494c526f516b386fc5edce20578d27f622ac3f5c1223145",
  "fc94fa91352d29f30f7888d7ea0122e4c1f1c67f7edb23f9b9f09f15713dab84",
  "5edcfe7d0b9dbb17f93b4170cd3bb97dee494a5ce4bf94f4512b8694010ce8e9",
  "8e1e6aaee12769e88b0d10710d75921587b061c84de3bff314d831b633d84fca",
  "6fc893aa3927072bbf6adaf17d9b757682f5d346293ab9e10a7aefcc028e4244",
  "c21b962e71f1969d6aea8af9083cc2ec3267ac9c32939d88368ab876f514624d",
  "3690e264cd927435e8c6c37a2309a6fdbbc910a783caa9cef7228fb1b41e312e",
  "423a2d91b863827b74b3a533ad61decf0255be482860235e7d768def91627bd3",
  "af8afd5ffcc61ba5ee30291b0bb56d4edb455a65266907dea4b50ad3bcef898f",
  "4d402ff78b2b68745abadcdf7053ebccd87af0cb43c8401856c6240725d76569",
  "58783dcc03e86a551f5e00c78babb3708231ef67bddaf1973343ebb0a452b4ee",
  "e7afa0e7b455e96c86387fd26c02114cfe52944958ba92add9408b6412137f86",
]);

// The maker's brand is public: it owns the repository and appears in the footers.
const ALLOWED: Record<string, string[]> = {};

// Addresses in the tree must be placeholders or public project addresses.
const ALLOWED_EMAIL_DOMAINS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "github.com",
  "python.org",
  "lists.php.net",
  "studio.dev",
  "briff.dev",
]);
// Recorded GitHub API responses of a public repo (vercel/ms) carry its committers' addresses.
const EMAIL_EXEMPT_DIRS = ["src/lib/github/__fixtures__/"];

const ROOT = join(__dirname, "..", "..");
const SCANNED_DIRS = ["src", "packages", "docs", "scripts", "deploy", ".github", "prisma"];
const SCANNED_FILES = ["README.md", "CLAUDE.md", "AGENTS.md", ".env.example", "Dockerfile"];
const SKIPPED_DIRS = new Set(["node_modules", "dist", ".next", "generated"]);

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!SKIPPED_DIRS.has(name)) out.push(...filesUnder(path));
    } else {
      out.push(path);
    }
  }
  return out;
}

function scannedFiles(): string[] {
  const files = SCANNED_DIRS.flatMap((d) => filesUnder(join(ROOT, d)));
  for (const f of SCANNED_FILES) files.push(join(ROOT, f));
  return files;
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

// Tokens split on everything but letters and digits, and again keeping `-` and `@`/`.`, so
// `x-y`, `x.com` and `a@b.example` are tested whole as well as by their parts.
function tokensOf(text: string): Set<string> {
  const lower = text.toLowerCase();
  const tokens = new Set<string>();
  for (const re of [/[a-z0-9]+/g, /[a-z0-9-]+/g, /[a-z0-9.@_+-]+/g]) {
    for (const m of lower.matchAll(re)) tokens.add(m[0].replace(/^[.-]+|[.-]+$/g, ""));
  }
  return tokens;
}

describe("public tree", () => {
  const files = scannedFiles()
    .map((path) => ({ path: relative(ROOT, path), body: readFileSync(path) }))
    .filter(({ body }) => !body.includes(0))
    .map(({ path, body }) => ({ path, text: body.toString("utf8") }));

  it("names no private repo, customer, server or account", () => {
    const hits: string[] = [];
    for (const { path, text } of files) {
      for (const token of tokensOf(text)) {
        const hash = sha256(token);
        if (!PRIVATE_TOKEN_HASHES.has(hash)) continue;
        if (ALLOWED[hash]?.includes(path)) continue;
        hits.push(`${path}: ${token}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("carries no real email address", () => {
    const hits: string[] = [];
    for (const { path, text } of files) {
      if (EMAIL_EXEMPT_DIRS.some((d) => path.startsWith(d))) continue;
      for (const m of text.matchAll(/[\w.+-]+@([\w-]+(?:\.[\w-]+)*\.[a-z]{2,})\b/gi)) {
        const domain = m[1].toLowerCase();
        if (ALLOWED_EMAIL_DOMAINS.has(domain) || domain.endsWith(".example")) continue;
        hits.push(`${path}: ${m[0]}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("reads a meaningful part of the tree", () => {
    expect(files.length).toBeGreaterThan(200);
  });
});
