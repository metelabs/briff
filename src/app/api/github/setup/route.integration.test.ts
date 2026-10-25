import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getDb } from "@/lib/db/client";
import { resetEnvCache } from "@/lib/env";
import { linkInstallation } from "@/lib/github/installations";
import { webhookSignature } from "@/lib/github/signature";

const session = vi.hoisted(() => ({ orgId: "" }));
vi.mock("@/lib/auth/session", () => ({
  getOrgContext: async () => ({ userId: "u", email: "u@example.com", name: "u", ...session }),
}));

const { GET } = await import("./route");
const { POST } = await import("../webhook/route");

const url = process.env.TEST_DATABASE_URL;
const SECRET = "webhook-secret-for-tests";
const reposAdded = JSON.parse(
  readFileSync(
    path.join(
      __dirname,
      "../../../../lib/github/__fixtures__/events/installation_repositories.json"
    ),
    "utf8"
  )
) as Record<string, unknown>;

// Adding repos on GitHub sends the browser to the Setup URL and delivers an
// `installation_repositories` webhook a moment later; only the webhook queues a scan.
describe.skipIf(!url)("repo selection change on a linked installation", () => {
  const saved = { ...process.env };
  const suffix = Date.now().toString(36);
  const installationId = `6${Date.now()}`.slice(0, 12);

  const pending = () =>
    getDb().job.findMany({
      where: {
        type: "github-scan",
        dedupeKey: { startsWith: `github-scan:${installationId}:` },
        status: "pending",
      },
      select: { payload: true },
    });

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: url,
      BETTER_AUTH_SECRET: "x".repeat(32),
      BETTER_AUTH_URL: "http://127.0.0.1:3000",
      GITHUB_APP_ID: "1",
      GITHUB_APP_SLUG: "briff-test",
      GITHUB_APP_PRIVATE_KEY: generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export(
        { type: "pkcs8", format: "pem" }
      ) as string,
      GITHUB_APP_WEBHOOK_SECRET: SECRET,
      GITHUB_APP_CLIENT_ID: "client",
      GITHUB_APP_CLIENT_SECRET: "client-secret",
    });
    resetEnvCache();
    session.orgId = (await getDb().org.create({ data: { name: `setup-${suffix}` } })).id;
    await linkInstallation(getDb(), {
      orgId: session.orgId,
      installationId,
      accountLogin: "acme",
      accountType: "Organization",
      suspendedAt: null,
    });
  });

  afterAll(async () => {
    await getDb().job.deleteMany({
      where: { dedupeKey: { startsWith: `github-scan:${installationId}:` } },
    });
    await getDb().org.deleteMany({ where: { id: session.orgId } });
    process.env = saved;
    resetEnvCache();
  });

  it("queues one scan of exactly the added repos", async () => {
    const setup = await GET(
      new Request(
        `http://127.0.0.1:3000/api/github/setup?installation_id=${installationId}&setup_action=update`
      )
    );
    expect(setup.status).toBe(303);
    expect(setup.headers.get("location")).toBe("http://127.0.0.1:3000/repos?github=updated");
    expect(await pending()).toHaveLength(0);

    const raw = JSON.stringify({
      ...reposAdded,
      installation: { ...(reposAdded.installation as object), id: Number(installationId) },
    });
    const res = await POST(
      new Request("http://127.0.0.1:3000/api/github/webhook", {
        method: "POST",
        headers: {
          "x-github-event": "installation_repositories",
          "x-github-delivery": "d-setup",
          "x-hub-signature-256": webhookSignature(SECRET, new TextEncoder().encode(raw)),
          "content-type": "application/json",
        },
        body: raw,
      })
    );
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ results: ["scan queued (repositories added)"] });
    expect((await pending()).map((j) => j.payload)).toEqual([
      { installationId, repos: ["acme/shop", "acme/docs"], force: true },
    ]);
  });
});
