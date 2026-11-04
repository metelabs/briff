import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db/client";
import { withOrg } from "@/lib/db/with-org";
import { resetEnvCache } from "@/lib/env";
import { linkInstallation } from "@/lib/github/installations";
import { webhookSignature } from "@/lib/github/signature";
import { MAX_WEBHOOK_BYTES } from "@/lib/github/webhook";

import { POST } from "./route";
import { testInstallationId } from "@/test/github-ids";

const url = process.env.TEST_DATABASE_URL;
const SECRET = "webhook-secret-for-tests";
const push = JSON.parse(
  readFileSync(path.join(__dirname, "../../../../lib/github/__fixtures__/events/push.json"), "utf8")
) as Record<string, unknown>;

describe.skipIf(!url)("POST /api/github/webhook", () => {
  const saved = { ...process.env };
  const suffix = Date.now().toString(36);
  const installationId = testInstallationId();
  let orgId = "";

  const deliver = (event: string, body: unknown, signature?: string) => {
    const raw = typeof body === "string" ? body : JSON.stringify(body);
    return POST(
      new Request("http://127.0.0.1:3000/api/github/webhook", {
        method: "POST",
        headers: {
          "x-github-event": event,
          "x-github-delivery": "d-1",
          "x-hub-signature-256":
            signature ?? webhookSignature(SECRET, new TextEncoder().encode(raw)),
          "content-type": "application/json",
        },
        body: raw,
      })
    );
  };

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
    orgId = (await getDb().org.create({ data: { name: `wh-${suffix}` } })).id;
    await linkInstallation(getDb(), {
      orgId,
      installationId,
      accountLogin: "acme",
      accountType: "Organization",
      suspendedAt: null,
    });
  });

  afterAll(async () => {
    await getDb().job.deleteMany({
      where: { dedupeKey: { startsWith: `github-scan:${installationId}` } },
    });
    await getDb().org.deleteMany({ where: { id: orgId } });
    process.env = saved;
    resetEnvCache();
  });

  const pushFor = (id: string, files: string[]) => ({
    ...push,
    installation: { id: Number(id) },
    commits: [{ added: [], removed: [], modified: files }],
  });

  it("refuses a bad signature before reading the payload, and oversized bodies", async () => {
    expect(
      (
        await deliver(
          "push",
          pushFor(installationId, ["package-lock.json"]),
          "sha256=" + "0".repeat(64)
        )
      ).status
    ).toBe(401);
    expect((await deliver("push", "not json", "sha256=" + "0".repeat(64))).status).toBe(401);
    expect((await deliver("push", "x".repeat(MAX_WEBHOOK_BYTES + 1))).status).toBe(413);
    expect((await deliver("push", "not json")).status).toBe(400);
  });

  it("queues one scan for a push that touches a lockfile, none for other pushes", async () => {
    const jobs = () =>
      getDb().job.findMany({
        where: {
          type: "github-scan",
          dedupeKey: { startsWith: `github-scan:${installationId}` },
          status: "pending",
        },
        select: { payload: true },
      });
    const quiet = await deliver("push", pushFor(installationId, ["src/app/page.tsx"]));
    expect(quiet.status).toBe(202);
    expect(await jobs()).toHaveLength(0);

    const res = await deliver("push", pushFor(installationId, ["package-lock.json"]));
    expect(res.status).toBe(202);
    await deliver("push", pushFor(installationId, ["Dockerfile"]));
    const queued = await jobs();
    expect(queued).toHaveLength(1);
    expect(queued[0].payload).toEqual({ installationId, repos: ["acme/site"] });

    // An installation no org linked is ignored.
    const other = await deliver("push", pushFor("4242", ["package-lock.json"]));
    expect(await other.json()).toMatchObject({ results: ["unknown installation"] });
  });

  it("suspends, unsuspends and forgets the installation", async () => {
    const inst = { id: Number(installationId) };
    await deliver("installation", { action: "suspend", installation: inst });
    const row = () =>
      withOrg(getDb(), orgId).githubInstallation.findFirst({ select: { suspendedAt: true } });
    expect((await row())?.suspendedAt).not.toBeNull();
    const skipped = await deliver("push", pushFor(installationId, ["package-lock.json"]));
    expect(await skipped.json()).toMatchObject({ results: ["suspended"] });
    await deliver("installation", { action: "unsuspend", installation: inst });
    expect((await row())?.suspendedAt).toBeNull();
    await deliver("installation", { action: "deleted", installation: inst });
    expect(await row()).toBeNull();
  });
});
