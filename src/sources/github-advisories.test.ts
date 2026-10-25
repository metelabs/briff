import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { resetEnvCache } from "@/lib/env";

import {
  advisoriesToItems,
  advisoriesUrl,
  advisoryListSchema,
  advisoryRepoSlug,
  fetchAdvisories,
} from "./github-advisories";

// GET /repos/php/php-src/security-advisories on 22 Oct 2026 (descriptions trimmed).
const fixture = advisoryListSchema.parse(
  JSON.parse(
    readFileSync(new URL("./__fixtures__/github-advisories-php.json", import.meta.url), "utf8")
  )
);

describe("github security advisories", () => {
  it("turns each advisory into an item keyed by its GHSA id", () => {
    const items = advisoriesToItems(fixture, "php");
    expect(items.map((i) => [i.guid, i.title])).toEqual([
      ["GHSA-w8hw-w9fx-j79w", "PHP security advisory: RCE via OOM corruption (CVE-2026-109618)"],
      [
        "GHSA-6wmf-4rv5-p3rp",
        "PHP security advisory: RCE via stale global state (CVE-2026-109619)",
      ],
      [
        "GHSA-7875-c8px-7q5f",
        "PHP security advisory: Out-of-bounds read in the HTTP stream wrapper when following a redirect with an empty Location header (CVE-2026-93682)",
      ],
    ]);
    const first = items[0];
    expect(first.url).toBe(
      "https://github.com/php/php-src/security/advisories/GHSA-w8hw-w9fx-j79w"
    );
    expect(first.publishedAt).toEqual(new Date("2026-10-21T13:34:25Z"));
    expect(first.rawText.startsWith("## Summary\n")).toBe(true);
    expect(first.metadata).toEqual({
      kind: "advisory",
      ghsaId: "GHSA-w8hw-w9fx-j79w",
      updatedAt: "2026-10-21T13:34:25Z",
      cveIds: ["CVE-2026-109618"],
      severity: "critical",
      cvssScore: 9.2,
      fixedVersions: ["8.2.35", "8.3.36", "8.4.27", "8.5.12"],
      affected: [
        { package: "php/php-src", vulnerable: "< 8.2.35", patched: "8.2.35" },
        { package: "php/php-src", vulnerable: "< 8.3.36", patched: "8.3.36" },
        { package: "php/php-src", vulnerable: "< 8.4.27", patched: "8.4.27" },
        { package: "php/php-src", vulnerable: "< 8.5.12", patched: "8.5.12" },
      ],
    });
    expect(items[2].metadata?.severity).toBe("medium");
    expect(items[2].metadata?.cvssScore).toBe(5.3);
  });

  it("drops withdrawn advisories and falls back to the GHSA id without a CVE", () => {
    const [a, b] = fixture;
    const items = advisoriesToItems(
      [
        { ...a, withdrawn_at: "2026-10-22T00:00:00Z" },
        { ...b, cve_id: null, identifiers: [{ type: "GHSA", value: b.ghsa_id }] },
      ],
      null
    );
    expect(items.map((i) => i.title)).toEqual([
      "Security advisory: RCE via stale global state (GHSA-6wmf-4rv5-p3rp)",
    ]);
    expect(items[0].metadata?.cveIds).toEqual([]);
  });

  it("only accepts api.github.com security-advisories URLs", () => {
    expect(advisoriesUrl("php", "php-src")).toBe(
      "https://api.github.com/repos/php/php-src/security-advisories"
    );
    expect(advisoryRepoSlug(advisoriesUrl("php", "php-src"))).toBe("php/php-src");
    expect(
      advisoryRepoSlug("https://evil.example/repos/php/php-src/security-advisories")
    ).toBeNull();
  });
});

describe("fetchAdvisories", () => {
  const saved = { ...process.env };
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...saved };
    resetEnvCache();
  });

  const source = {
    kind: "github_advisories",
    url: advisoriesUrl("php", "php-src"),
    name: "php/php-src security advisories",
    etag: 'W/"old"',
    lastModified: null,
    runtime: "php",
  };

  function stub(response: Response) {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    vi.stubGlobal("fetch", async (input: string, init: RequestInit) => {
      calls.push({ url: String(input), headers: init.headers as Record<string, string> });
      return response;
    });
    Object.assign(process.env, {
      DATABASE_URL: "postgresql://x/y",
      BETTER_AUTH_SECRET: "x".repeat(32),
      BETTER_AUTH_URL: "https://app.example.com",
      GITHUB_TOKEN: "ghp_test",
    });
    resetEnvCache();
    return calls;
  }

  it("sends the token and the stored ETag, newest first", async () => {
    const calls = stub(
      new Response(
        readFileSync(new URL("./__fixtures__/github-advisories-php.json", import.meta.url)),
        {
          status: 200,
          headers: { etag: 'W/"new"' },
        }
      )
    );
    const outcome = await fetchAdvisories(source);
    expect(calls[0].url).toBe(
      "https://api.github.com/repos/php/php-src/security-advisories?state=published&sort=published&direction=desc&per_page=30"
    );
    expect(calls[0].headers.Authorization).toBe("Bearer ghp_test");
    expect(calls[0].headers["If-None-Match"]).toBe('W/"old"');
    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") {
      expect(outcome.items).toHaveLength(3);
      expect(outcome.etag).toBe('W/"new"');
    }
  });

  it("reports 304 as not modified", async () => {
    stub(new Response(null, { status: 304 }));
    expect(await fetchAdvisories(source)).toEqual({ status: "not_modified", httpStatus: 304 });
  });
});
