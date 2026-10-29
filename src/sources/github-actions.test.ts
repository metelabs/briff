import { fixedFor } from "@/security/plan";
import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { collectFromFiles } from "@scan/collect";
import { ecosystemLabel } from "@scan/ecosystems";
import { dedupeDependencies } from "@/lib/scan/ingest";
import { fixCommand } from "@/pipeline/fixes";

import { actionTags, isPublicAction, ActionVisibilityDeferred } from "./github-actions";
import {
  queryOsvBatchHits,
  actionConstraintAffected,
  actionTagAffected,
  osvQueryOf,
  osvVulnSchema,
  toAdvisoryFields,
} from "./osv";

const recorded = (name: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`./__fixtures__/github-actions/${name}.json`, import.meta.url), "utf8")
  );
const advisory = osvVulnSchema.parse(recorded("changed-files"));

describe("GitHub Actions coverage", () => {
  it("reads the recorded integer fix boundary without inventing a same-line fix", () => {
    const vuln = osvVulnSchema.parse(recorded("changed-files-injection"));
    expect(actionTagAffected(vuln, "tj-actions/changed-files", "v40.0.0")).toBe(true);
    expect(actionTagAffected(vuln, "tj-actions/changed-files", "v41.0.0")).toBe(false);
    expect(actionConstraintAffected(vuln, "tj-actions/changed-files", "v40")).toBe(true);
    const fields = toAdvisoryFields(vuln, "tj-actions/changed-files", "GitHub Actions");
    expect(fields.fixedVersion).toBe("41.0.0");
    expect(
      fixedFor({
        ecosystem: "GitHub Actions",
        osvId: vuln.id,
        packageName: "tj-actions/changed-files",
        summary: fields.summary,
        severity: fields.severity,
        affected: fields.affected,
        fallbackFixed: fields.fixedVersion,
        repos: [{ name: "acme/web", installedVersion: "v40.0.0", direct: true }],
      })
    ).not.toContain("@v41");
  });
  it("queries exact release tags by package and filters the recorded advisory locally", async () => {
    const query = {
      ecosystem: "GitHub Actions" as const,
      name: "tj-actions/changed-files",
      version: "v40.0.0",
    };
    expect(osvQueryOf(query)).toEqual({
      package: { ecosystem: query.ecosystem, name: query.name },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (input: string | URL | Request) =>
          new Response(
            JSON.stringify(
              String(input).endsWith("querybatch")
                ? { results: [{ vulns: [{ id: advisory.id }] }, { vulns: [{ id: advisory.id }] }] }
                : advisory
            )
          )
      )
    );
    try {
      const hits = await queryOsvBatchHits([query, { ...query, version: "v46.0.1" }]);
      expect(hits.map((list) => list.map((hit) => hit.id))).toEqual([[advisory.id], []]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it.each([500, 502, 503])(
    "retries transient HTTP %i through the deferred visibility path",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(null, { status }))
      );
      try {
        await expect(isPublicAction("acme/tool")).rejects.toThrow(`HTTP ${status}`);
      } finally {
        vi.unstubAllGlobals();
      }
    }
  );

  it("preserves the reset time when visibility hits the unauthenticated limit", async () => {
    const reset = Math.ceil(Date.now() / 1000) + 3600;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(null, {
            status: 403,
            headers: {
              "x-ratelimit-remaining": "0",
              "x-ratelimit-reset": String(reset),
            },
          })
      )
    );
    try {
      await expect(isPublicAction("acme/tool")).rejects.toMatchObject({
        retryAt: new Date(reset * 1000),
      });
      await expect(isPublicAction("acme/tool")).rejects.toBeInstanceOf(ActionVisibilityDeferred);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("requires an explicit public repository response without authentication", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    try {
      for (const [response, expected] of [
        [Response.json(recorded("checkout-visibility")), true],
        [Response.json({ private: true }), false],
        [Response.json({}), false],
        [new Response(null, { status: 404 }), false],
        [new Response(null, { status: 403 }), false],
      ] as const) {
        fetcher.mockResolvedValueOnce(response);
        expect(await isPublicAction("acme/tool")).toBe(expected);
      }
      expect(fetcher).toHaveBeenCalledWith(
        "https://api.github.com/repos/acme/tool",
        expect.objectContaining({ headers: { Accept: "application/vnd.github+json" } })
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses the same workflow parser for uploaded and GitHub App files", async () => {
    const workflow = readFileSync(
      new URL("../../packages/scan/src/__fixtures__/actions/workflow.yml", import.meta.url),
      "utf8"
    );
    const repo = await collectFromFiles(
      "acme/web",
      { ".github/workflows/check.yml": workflow, ".github/ignored.yml": "uses: acme/ignored@v1" },
      { warn: () => undefined }
    );
    expect(repo?.dependencies).toHaveLength(4);
    const rows = dedupeDependencies(repo?.dependencies ?? []);
    expect(rows[0]).toMatchObject({
      ecosystem: "GitHub Actions",
      name: "acme/tool",
      metadata: { subpath: "sub-action" },
    });
    expect(rows.find((row) => row.name === "actions/checkout")?.constraint).toBe(true);
    expect(ecosystemLabel("GitHub Actions")).toBe("Actions");
  });

  it("never sends a floating major as an exact OSV version", () => {
    expect(
      osvQueryOf({
        ecosystem: "GitHub Actions",
        name: "actions/checkout",
        version: "v4",
        constraint: true,
      })
    ).toEqual({ package: { ecosystem: "GitHub Actions", name: "actions/checkout" } });
    const sha = "a".repeat(40);
    expect(
      osvQueryOf({ ecosystem: "GitHub Actions", name: "acme/action", version: sha })
    ).toMatchObject({ commit: sha });
    expect(actionConstraintAffected(advisory, "tj-actions/changed-files", "v45")).toBe(true);
    expect(actionConstraintAffected(advisory, "tj-actions/changed-files", "v46")).toBe(false);
    expect(actionConstraintAffected(advisory, "actions/checkout", "v45")).toBe(false);
  });

  it("never recommends the next major even when the recorded advisory fixes only that major", () => {
    const fields = toAdvisoryFields(advisory, "tj-actions/changed-files", "GitHub Actions");
    expect(fields.fixedVersion).toBe("46.0.1");
    expect(
      fixCommand("tj-actions/changed-files", null, [
        {
          repo: "acme/web",
          installed: "v45.0.7",
          fix: fields.fixedVersion,
          ecosystem: "GitHub Actions",
        },
      ])
    ).toBeNull();
  });

  it("pins an on-line fix to the SHA recorded by the tags API when available", () => {
    const tags = actionTags(recorded("checkout-tags"));
    expect(Object.keys(tags).length).toBeGreaterThan(0);
    const sha = "a".repeat(40);
    expect(
      fixCommand("acme/action", null, [
        {
          repo: "acme/web",
          installed: "v4.1.0",
          fix: "4.2.1",
          ecosystem: "GitHub Actions",
          actionTags: { "v4.2.1": sha },
        },
      ])
    ).toBe(`pin acme/action to v4.2.1 (sha ${sha})`);
  });
});

it("keeps an Actions security email on the installed line", () => {
  const fields = toAdvisoryFields(advisory, "tj-actions/changed-files", "GitHub Actions");
  expect(
    fixedFor({
      osvId: advisory.id,
      packageName: "tj-actions/changed-files",
      summary: null,
      severity: "HIGH",
      affected: fields.affected,
      fallbackFixed: fields.fixedVersion,
      ecosystem: "GitHub Actions",
      repos: [{ name: "acme/web", installedVersion: "v45.0.7", direct: true }],
    })
  ).toBe("read the advisory");
});

it("preserves unprefixed tags and never invents a ref when tags are unavailable", () => {
  const sha = "b".repeat(40);
  const tags = actionTags([{ name: "4.2.1", commit: { sha } }]);
  expect(tags).toEqual({ "4.2.1": sha });
  const repo = {
    repo: "acme/web",
    installed: "4.1.0",
    fix: "4.2.1",
    ecosystem: "GitHub Actions" as const,
  };
  expect(fixCommand("acme/action", null, [{ ...repo, actionTags: tags }])).toBe(
    `pin acme/action to 4.2.1 (sha ${sha})`
  );
  expect(fixCommand("acme/action", null, [repo])).toBe(
    "read the advisory for the acme/action 4.2.1 release tag"
  );
});

it("isolates a failed floating-ref advisory fetch from other advisories and ecosystems", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      if (String(input).endsWith("querybatch"))
        return Response.json({
          results: [
            { vulns: [{ id: "missing" }, { id: advisory.id }] },
            { vulns: [{ id: "npm-advisory" }] },
          ],
        });
      if (String(input).endsWith(`/vulns/${advisory.id}`)) return Response.json(advisory);
      return new Response("not found", { status: 404 });
    })
  );
  try {
    const queries = [
      {
        ecosystem: "GitHub Actions" as const,
        name: "tj-actions/changed-files",
        version: "v45",
        constraint: true,
      },
      { ecosystem: "npm" as const, name: "acme-package", version: "1.0.0" },
    ];
    for (let attempt = 0; attempt < 2; attempt++) {
      const hits = await queryOsvBatchHits(queries);
      expect(hits.map((list) => list.map((hit) => hit.id))).toEqual([
        [advisory.id],
        ["npm-advisory"],
      ]);
    }
    expect(
      vi.mocked(fetch).mock.calls.filter(([input]) => String(input).endsWith("/vulns/missing"))
    ).toHaveLength(2);
  } finally {
    vi.unstubAllGlobals();
  }
});
