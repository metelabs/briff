import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { planWebhook, PUSH_COMMIT_LIMIT, type PushEvent } from "./webhook";

const push = JSON.parse(
  readFileSync(path.join(__dirname, "__fixtures__", "events", "push.json"), "utf8")
) as PushEvent;

const withCommits = (files: string[], over: Partial<PushEvent> = {}) => ({
  ...push,
  ...over,
  commits: [{ added: [], removed: [], modified: files }],
});

describe("planWebhook: push", () => {
  it("scans when a scanned file on the default branch changed", () => {
    expect(planWebhook("push", push)).toEqual([
      {
        kind: "scan",
        installationId: "2311213",
        repos: ["acme/site"],
        reason: "scanned files changed",
      },
    ]);
    expect(planWebhook("push", withCommits(["apps/api/Dockerfile"]))[0].kind).toBe("scan");
    expect(planWebhook("push", withCommits([".nvmrc"]))[0].kind).toBe("scan");
  });

  it("skips pushes that change nothing the scanner reads", () => {
    expect(planWebhook("push", withCommits(["src/index.ts", "README.md"]))).toEqual([
      { kind: "ignore", reason: "no scanned file changed" },
    ]);
    expect(planWebhook("push", withCommits(["node_modules/x/package.json"]))[0].kind).toBe(
      "ignore"
    );
    expect(planWebhook("push", withCommits([".github/workflows/Dockerfile"]))[0].kind).toBe(
      "ignore"
    );
  });

  it("skips other branches and deletions, scans force pushes and partial commit lists", () => {
    expect(planWebhook("push", { ...push, ref: "refs/heads/feature" })).toEqual([
      { kind: "ignore", reason: "not the default branch" },
    ]);
    expect(planWebhook("push", { ...push, ref: "refs/tags/v1.0.0" })[0].kind).toBe("ignore");
    expect(planWebhook("push", { ...push, deleted: true })[0].kind).toBe("ignore");
    expect(planWebhook("push", withCommits(["README.md"], { forced: true }))[0]).toMatchObject({
      kind: "scan",
      reason: "force push",
    });
    const many = Array.from({ length: PUSH_COMMIT_LIMIT }, () => ({
      added: [],
      removed: [],
      modified: ["README.md"],
    }));
    expect(planWebhook("push", { ...push, commits: many })[0]).toMatchObject({
      kind: "scan",
      reason: "commit list partial",
    });
  });
});

describe("planWebhook: installation events", () => {
  const installation = { id: 2311213 };

  it("maps installation lifecycle actions", () => {
    expect(planWebhook("installation", { action: "deleted", installation })).toEqual([
      { kind: "installation-deleted", installationId: "2311213" },
    ]);
    expect(planWebhook("installation", { action: "suspend", installation })).toEqual([
      { kind: "installation-suspended", installationId: "2311213", suspended: true },
    ]);
    expect(planWebhook("installation", { action: "unsuspend", installation })[0]).toMatchObject({
      suspended: false,
    });
    // Linking happens only through the setup flow.
    expect(planWebhook("installation", { action: "created", installation })[0].kind).toBe("ignore");
  });

  it("scans added repositories and removes removed ones", () => {
    expect(
      planWebhook("installation_repositories", {
        action: "added",
        installation,
        repositories_added: [{ full_name: "acme/a" }, { full_name: "acme/b" }],
        repositories_removed: [],
      })
    ).toEqual([
      {
        kind: "scan",
        installationId: "2311213",
        repos: ["acme/a", "acme/b"],
        reason: "repositories added",
      },
    ]);
    expect(
      planWebhook("installation_repositories", {
        action: "removed",
        installation,
        repositories_added: [],
        repositories_removed: [{ full_name: "acme/a" }],
      })
    ).toEqual([{ kind: "remove", installationId: "2311213", repos: ["acme/a"] }]);
  });

  it("scans exactly the repos a recorded installation_repositories delivery adds", () => {
    const added = JSON.parse(
      readFileSync(
        path.join(__dirname, "__fixtures__", "events", "installation_repositories.json"),
        "utf8"
      )
    ) as unknown;
    expect(planWebhook("installation_repositories", added)).toEqual([
      {
        kind: "scan",
        installationId: "2311213",
        repos: ["acme/shop", "acme/docs"],
        reason: "repositories added",
      },
    ]);
  });

  it("ignores other events and throws on payloads it cannot read", () => {
    expect(planWebhook("ping", {})[0].kind).toBe("ignore");
    expect(planWebhook("issues", {})[0].kind).toBe("ignore");
    expect(() => planWebhook("push", { ref: 1 })).toThrow();
  });
});
