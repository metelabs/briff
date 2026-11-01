import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PRIVATE_PREFIXES } from "@/components/landing/links";

import { importGraph, runtimeImports } from "./import-graph";

// The public pages (landing, replays, robots, sitemap) and the proxy that picks the landing
// page for `/` must not be able to read a session or tenant data. Walk their runtime imports
// and fail on anything that opens the database, the auth layer, the request's cookies or a
// Server Action module. Like the "use server" check next door, this reads source, not a build.
// The replay engine shares pure planning with the worker (runtime-urgent-plan.ts, matcher.ts,
// triage-rule.ts); the DB-bound halves next to them stay out of reach.

const ROOT = path.resolve(__dirname, "../..");

const ENTRIES = [
  "src/app/landing/page.tsx",
  "src/app/replay/[id]/page.tsx",
  "src/app/terms/page.tsx",
  "src/app/privacy/page.tsx",
  "src/app/refunds/page.tsx",
  "src/app/dpa/page.tsx",
  "src/app/robots.ts",
  "src/app/sitemap.ts",
  "src/proxy.ts",
];

/** Modules a public route may not reach, with why. */
const FORBIDDEN: { test: (mod: string) => boolean; why: string }[] = [
  { test: (m) => m.startsWith("src/lib/db/"), why: "database client or tenant layer" },
  { test: (m) => m.startsWith("src/lib/auth/"), why: "session" },
  { test: (m) => m.startsWith("src/generated/"), why: "Prisma client" },
  { test: (m) => /^(@prisma\/|pg$)/.test(m), why: "database driver" },
  { test: (m) => m === "next/headers", why: "request cookies and headers" },
  {
    test: (m) =>
      m === "better-auth" || (m.startsWith("better-auth/") && m !== "better-auth/cookies"),
    why: "auth server (the proxy only reads the cookie name)",
  },
];

function isUseServer(mod: string): boolean {
  if (!/\.tsx?$/.test(mod)) return false;
  return /^\s*["']use server["']/.test(readFileSync(path.join(ROOT, mod), "utf8"));
}

describe("public routes", () => {
  const graph = importGraph(ENTRIES);

  it("walk a real graph", () => {
    expect(graph.has("src/lib/db/client.ts")).toBe(false);
    expect(graph.has("src/components/bulletin/bulletin-content.tsx")).toBe(true);
    expect(graph.has("src/replay/engine.ts")).toBe(true);
    expect(graph.has("better-auth/cookies")).toBe(true);
    expect(graph.has("packages/scan/src/ecosystems.ts")).toBe(true);
    expect(graph.has("packages/scan/src/runtimes.ts")).toBe(true);
  });

  it("import nothing that reads a session or tenant data", () => {
    const bad: string[] = [];
    for (const [mod, chain] of graph) {
      const hit = FORBIDDEN.find((f) => f.test(mod));
      if (hit) bad.push(`${hit.why}: ${chain.join(" -> ")}`);
      else if (isUseServer(mod)) bad.push(`Server Action module: ${chain.join(" -> ")}`);
    }
    expect(bad).toEqual([]);
  });

  it("the checker sees value imports and skips type-only ones", () => {
    const text = [
      'import type { A } from "@/lib/db/client";',
      'import { type B, type C } from "@/lib/auth/session";',
      'import { getDb } from "@/lib/db/client";',
      'import { x, type Y } from "./x";',
      'export { z } from "./z";',
      'export type { W } from "./w";',
      'import "server-only";',
      'const later = () => import("./lazy");',
    ].join("\n");
    expect(runtimeImports("x.ts", text)).toEqual([
      "@/lib/db/client",
      "./x",
      "./z",
      "server-only",
      "./lazy",
    ]);
  });

  it("the dashboard at / is still the tenant page (the proxy, not the page, picks the landing)", () => {
    const dashboard = importGraph(["src/app/page.tsx"]);
    expect(dashboard.has("src/lib/db/client.ts")).toBe(true);
  });
});

describe("robots", () => {
  it("closes every app route folder except the public ones", () => {
    const PUBLIC = new Set(["replay", "terms", "privacy", "refunds", "dpa"]);
    const folders = readdirSync(path.join(ROOT, "src/app"), { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("_") && e.name !== "fonts")
      .map((e) => e.name)
      .filter((name) => !PUBLIC.has(name));
    const closed = PRIVATE_PREFIXES.map((p) => p.replace(/^\/|\/$/g, ""));
    expect(closed.sort()).toEqual(folders.sort());
  });
});
