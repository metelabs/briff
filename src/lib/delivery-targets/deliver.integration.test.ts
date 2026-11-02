import http from "node:http";
import type { AddressInfo } from "node:net";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { resetEnvCache } from "@/lib/env";
import { log } from "@/lib/log";
import { createOrgForUser } from "@/lib/org";
import type { JobContext } from "@/worker/types";

import {
  alertBatchId,
  enqueueAlertDeliveries,
  enqueueBulletinDeliveries,
  markAlertsDelivered,
  runDeliverTarget,
  sendTestDelivery,
  type PostFn,
} from "./deliver";
import { signBody } from "./format";
import { createDeliveryTarget, DeliveryTargetError, setDeliveryTargetEnabled } from "./store";

const url = process.env.TEST_DATABASE_URL;

interface Received {
  path: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** A local HTTP endpoint standing in for Slack or a customer's webhook. */
function startStub(): Promise<{
  server: http.Server;
  base: string;
  received: Received[];
  respond: { status: number; body: string };
}> {
  const received: Received[] = [];
  const respond = { status: 200, body: "ok" };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      received.push({
        path: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      res.writeHead(respond.status, { "Content-Type": "text/plain" });
      res.end(respond.body);
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, base: `http://127.0.0.1:${port}`, received, respond });
    })
  );
}

/**
 * The stub listens on loopback, which the SSRF guard refuses (tested below with the real
 * post); delivery tests send through plain fetch instead.
 */
const loopbackPost: PostFn = async (target, init) => {
  const res = await fetch(target, {
    method: "POST",
    headers: init.headers,
    body: init.body,
    signal: AbortSignal.timeout(init.timeoutMs),
  });
  return { status: res.status, body: await res.text() };
};

describe.skipIf(!url)("delivery targets against Postgres and a local endpoint", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const suffix = Date.now().toString(36);
  const owner = `u-dt-owner-${suffix}`;
  const member = `u-dt-member-${suffix}`;
  const otherOwner = `u-dt-other-${suffix}`;
  let orgId = "";
  let otherOrgId = "";
  let streamId = "";
  let secondStreamId = "";
  let repoId = "";
  let bulletinId = "";
  let alertId = "";
  let sourceId = "";
  let packageId = "";
  let stub: Awaited<ReturnType<typeof startStub>>;

  const ctx = (payload: unknown, attempt = 1, maxAttempts = 4): JobContext => ({
    db,
    log,
    jobId: `job-${suffix}-${attempt}`,
    payload: payload as JobContext["payload"],
    heartbeat: async () => {},
    attempt,
    maxAttempts,
  });

  async function setPlan(plan: "free" | "pro" | "team") {
    await db.org.update({ where: { id: orgId }, data: { plan } });
  }

  async function rawTarget(data: {
    kind: "slack" | "webhook";
    url: string;
    secret?: string;
    streamId?: string | null;
    bulletin?: boolean;
    alert?: boolean;
  }): Promise<string> {
    const row = await withOrg(db, orgId).deliveryTarget.create({
      data: { orgId, ...data },
      select: { id: true },
    });
    return row.id;
  }

  beforeAll(async () => {
    stub = await startStub();
    for (const id of [owner, member, otherOwner]) {
      await db.user.create({ data: { id, name: id, email: `${id}@example.com` } });
    }
    orgId = await createOrgForUser(db, { name: `dt-org-${suffix}`, userId: owner });
    otherOrgId = await createOrgForUser(db, { name: `dt-other-${suffix}`, userId: otherOwner });
    const scoped = withOrg(db, orgId);
    await scoped.orgMember.create({ data: { orgId, userId: member, role: "member" } });
    streamId = (await scoped.bulletinStream.findFirstOrThrow({ select: { id: true } })).id;
    secondStreamId = (
      await scoped.bulletinStream.create({
        data: { orgId, name: "Clients", slug: `clients-${suffix}` },
        select: { id: true },
      })
    ).id;
    repoId = (
      await scoped.repo.create({
        data: { orgId, name: "acme/api", source: "github", included: true },
        select: { id: true },
      })
    ).id;
    await scoped.streamRepo.create({ data: { orgId, streamId, repoId } });

    sourceId = (
      await db.source.create({
        data: { kind: "rss", url: `https://example.com/${suffix}.xml`, name: "Feed" },
      })
    ).id;
    const itemId = (
      await db.item.create({
        data: {
          sourceId,
          title: "undici 7.16.1",
          url: "https://example.com/undici-7.16.1",
          contentHash: `dt-${suffix}`,
        },
      })
    ).id;
    bulletinId = (
      await scoped.bulletin.create({
        data: {
          orgId,
          streamId,
          weekStart: new Date("2026-11-02"),
          periodStart: new Date("2026-10-26"),
          periodEnd: new Date("2026-11-02"),
          model: "m",
          promptVersion: "p",
          subject: "Briff · Weekly · W45: undici",
          summary: "One security fix this week.\n\nMore below.",
          inputHash: "h",
        },
        select: { id: true },
      })
    ).id;
    await scoped.bulletinItem.create({
      data: {
        orgId,
        bulletinId,
        itemId,
        bucket: "security",
        section: "act",
        order: 0,
        headline: "undici 7.16.1 fixes a request smuggling bug",
        line: "line",
        action: "npm i undici@7.16.1",
        affectedRepos: ["acme/api"],
      },
    });
    packageId = (await db.package.create({ data: { ecosystem: "npm", name: `dt-pkg-${suffix}` } }))
      .id;
    const advisoryId = (
      await db.advisory.create({
        data: {
          osvId: `GHSA-dt-${suffix}`,
          packageId,
          affected: [],
          severity: "CRITICAL",
          summary: "Prototype pollution",
        },
      })
    ).id;
    alertId = (
      await scoped.alert.create({ data: { orgId, advisoryId, repoId }, select: { id: true } })
    ).id;
  });

  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", url ?? "");
    vi.stubEnv("BETTER_AUTH_SECRET", "synthetic-test-secret-of-at-least-32-characters");
    vi.stubEnv("BETTER_AUTH_URL", "https://briff.example.com");
    vi.stubEnv("BRIFF_CLOUD", "true");
    resetEnvCache();
    stub.received.length = 0;
    stub.respond.status = 200;
    stub.respond.body = "ok";
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    resetEnvCache();
    await withOrg(db, orgId).deliveryTarget.deleteMany({});
    await db.job.deleteMany({ where: { payload: { path: ["orgId"], equals: orgId } } });
  });

  afterAll(async () => {
    stub.server.close();
    await db.org.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } });
    await db.user.deleteMany({ where: { id: { in: [owner, member, otherOwner] } } });
    await db.source.deleteMany({ where: { id: sourceId } });
    await db.package.deleteMany({ where: { id: packageId } });
    await db.$disconnect();
  });

  it("posts the bulletin to Slack as Block Kit and records the delivery", async () => {
    await setPlan("team");
    const targetId = await rawTarget({ kind: "slack", url: `${stub.base}/services/T/B/x` });
    const res = await runDeliverTarget(ctx({ orgId, targetId, event: "bulletin", bulletinId }), {
      post: loopbackPost,
    });
    expect(res.counts).toEqual({ delivered: 1 });
    expect(stub.received).toHaveLength(1);
    const body = JSON.parse(stub.received[0].body) as {
      text: string;
      blocks: { type: string; text?: { text: string }; elements?: { url: string }[] }[];
    };
    expect(body.text).toBe("Briff · Weekly · W45: undici");
    expect(body.blocks.map((b) => b.type)).toEqual(["header", "section", "section", "actions"]);
    expect(body.blocks[1].text?.text).toBe("One security fix this week.");
    expect(body.blocks[2].text?.text).toContain("undici 7.16.1 fixes a request smuggling bug");
    expect(body.blocks[2].text?.text).toContain("(acme/api)");
    expect(body.blocks[3].elements?.[0].url).toBe(`https://briff.example.com/b/${bulletinId}`);
    expect(stub.received[0].headers["x-briff-signature"]).toBeUndefined();
    const row = await withOrg(db, orgId).deliveryTarget.findFirstOrThrow({
      where: { id: targetId },
    });
    expect(row.lastDeliveredAt).not.toBeNull();
    expect(row.lastError).toBeNull();
  });

  it("posts alerts to a webhook as signed JSON the receiver can verify", async () => {
    await setPlan("team");
    const secret = "whsec_test_signing_key";
    const targetId = await rawTarget({ kind: "webhook", url: `${stub.base}/hook`, secret });
    const job = ctx({
      orgId,
      targetId,
      event: "alerts",
      batchId: alertBatchId([alertId]),
      alertIds: [alertId],
      occurredAt: "2026-11-03T04:05:00.000Z",
    });
    expect((await runDeliverTarget(job, { post: loopbackPost })).counts).toEqual({ delivered: 1 });
    const got = stub.received[0];
    expect(got.headers["x-briff-event"]).toBe("alerts");
    expect(got.headers["x-briff-delivery"]).toBe(job.jobId);
    expect(got.headers["x-briff-signature"]).toBe(signBody(got.body, secret));
    const payload = JSON.parse(got.body) as Record<string, unknown> & {
      items: { title: string; severity: string; repos: string[] }[];
    };
    expect(payload).toMatchObject({
      type: "alerts",
      org: { id: orgId, name: `dt-org-${suffix}` },
      stream: null,
      occurredAt: "2026-11-03T04:05:00.000Z",
      url: "https://briff.example.com/alerts",
    });
    expect(payload.items).toEqual([
      expect.objectContaining({
        title: `dt-pkg-${suffix}: GHSA-dt-${suffix}`,
        severity: "CRITICAL",
        repos: ["acme/api"],
      }),
    ]);
  });

  it("retries a 5xx until the last attempt, which records the error and ends quietly", async () => {
    await setPlan("team");
    stub.respond.status = 503;
    stub.respond.body = "maintenance";
    const targetId = await rawTarget({ kind: "webhook", url: `${stub.base}/hook`, secret: "s" });
    const payload = { orgId, targetId, event: "bulletin", bulletinId };
    await expect(runDeliverTarget(ctx(payload, 1), { post: loopbackPost })).rejects.toThrow(
      /HTTP 503/
    );
    const res = await runDeliverTarget(ctx(payload, 4), { post: loopbackPost });
    expect(res.counts).toEqual({ failed: 1 });
    const row = await withOrg(db, orgId).deliveryTarget.findFirstOrThrow({
      where: { id: targetId },
    });
    expect(row.lastError).toBe("HTTP 503: maintenance");
    expect(row.lastDeliveredAt).toBeNull();

    stub.respond.status = 404;
    stub.respond.body = "no_service";
    // A 4xx is final on the first attempt.
    expect((await runDeliverTarget(ctx(payload, 1), { post: loopbackPost })).counts).toEqual({
      failed: 1,
    });
  });

  it("refuses private and loopback hosts through the SSRF guard, without retrying", async () => {
    await setPlan("team");
    const targetId = await rawTarget({ kind: "webhook", url: `${stub.base}/hook`, secret: "s" });
    const res = await runDeliverTarget(ctx({ orgId, targetId, event: "bulletin", bulletinId }));
    expect(res.counts).toEqual({ failed: 1 });
    expect(stub.received).toHaveLength(0);
    const row = await withOrg(db, orgId).deliveryTarget.findFirstOrThrow({
      where: { id: targetId },
    });
    expect(row.lastError).toMatch(/private or internal address/);
  });

  it("retries a host name that does not resolve instead of treating it as refused", async () => {
    await setPlan("team");
    const targetId = await rawTarget({
      kind: "webhook",
      url: "https://briff-delivery-test.invalid/hook",
      secret: "s",
    });
    const payload = { orgId, targetId, event: "bulletin", bulletinId };
    await expect(runDeliverTarget(ctx(payload, 1))).rejects.toThrow(/resolve/);
    const row = await withOrg(db, orgId).deliveryTarget.findFirstOrThrow({
      where: { id: targetId },
    });
    expect(row.lastError).toBe("Could not resolve the host name.");
  });

  it("enqueues each bulletin and alert batch once per matching target", async () => {
    await setPlan("team");
    const all = await rawTarget({ kind: "slack", url: "https://hooks.slack.com/services/a" });
    const thisStream = await rawTarget({
      kind: "webhook",
      url: "https://hooks.example.com/a",
      streamId,
    });
    await rawTarget({
      kind: "webhook",
      url: "https://hooks.example.com/b",
      streamId: secondStreamId,
    });
    await rawTarget({ kind: "webhook", url: "https://hooks.example.com/c", bulletin: false });
    await rawTarget({ kind: "webhook", url: "https://hooks.example.com/d", alert: false });
    const off = await rawTarget({ kind: "webhook", url: "https://hooks.example.com/e" });
    await withOrg(db, orgId).deliveryTarget.updateMany({
      where: { id: off },
      data: { enabled: false },
    });

    const bulletin = { id: bulletinId, streamId };
    expect(await enqueueBulletinDeliveries(db, orgId, bulletin)).toBe(3);
    expect(await enqueueBulletinDeliveries(db, orgId, bulletin)).toBe(0);
    // Not even after the first jobs finished.
    await db.job.updateMany({
      where: { payload: { path: ["orgId"], equals: orgId } },
      data: { status: "succeeded" },
    });
    expect(await enqueueBulletinDeliveries(db, orgId, bulletin)).toBe(0);
    const keys = (
      await db.job.findMany({
        where: { type: "deliver-target", payload: { path: ["orgId"], equals: orgId } },
        select: { dedupeKey: true },
      })
    ).map((j) => j.dedupeKey);
    expect(keys).toContain(`deliver:${all}:${bulletinId}`);
    expect(keys).toContain(`deliver:${thisStream}:${bulletinId}`);

    // The alert's repo is only in the first stream: the second stream's target gets nothing.
    expect(await enqueueAlertDeliveries(db, orgId, [alertId])).toBe(3);
    expect(await enqueueAlertDeliveries(db, orgId, [alertId])).toBe(0);
    expect(keys.every((k) => !k.includes("alerts-"))).toBe(true);
    expect(
      await db.job.count({
        where: { dedupeKey: `deliver:${all}:${alertBatchId([alertId])}` },
      })
    ).toBe(1);
  });

  it("retires emailed alerts and queues their posts in one step", async () => {
    await setPlan("team");
    const targetId = await rawTarget({ kind: "slack", url: "https://hooks.slack.com/services/m" });
    await withOrg(db, orgId).alert.updateMany({
      where: { id: alertId },
      data: { deliveredAt: null },
    });
    const res = await markAlertsDelivered(
      db,
      orgId,
      { deliveredIds: [alertId], urgentIds: [alertId] },
      log
    );
    expect(res).toEqual({ delivered: 1, queued: 1 });
    const alert = await withOrg(db, orgId).alert.findFirstOrThrow({ where: { id: alertId } });
    expect(alert.deliveredAt).not.toBeNull();
    expect(
      await db.job.count({ where: { dedupeKey: `deliver:${targetId}:${alertBatchId([alertId])}` } })
    ).toBe(1);
  });

  it("keeps targets on a plan without integrations but neither queues nor posts", async () => {
    await setPlan("pro");
    const targetId = await rawTarget({ kind: "slack", url: `${stub.base}/services/T/B/x` });
    expect(await enqueueBulletinDeliveries(db, orgId, { id: bulletinId, streamId })).toBe(0);
    const res = await runDeliverTarget(ctx({ orgId, targetId, event: "bulletin", bulletinId }), {
      post: loopbackPost,
    });
    expect(res.counts).toEqual({ skippedPlan: 1 });
    expect(stub.received).toHaveLength(0);
    expect(await withOrg(db, orgId).deliveryTarget.count({ where: { id: targetId } })).toBe(1);
    // Self-hosted: every org has integrations.
    vi.stubEnv("BRIFF_CLOUD", "false");
    resetEnvCache();
    expect(await enqueueBulletinDeliveries(db, orgId, { id: bulletinId, streamId })).toBe(1);
  });

  it("lets only owners on a plan with integrations add, test and turn them on", async () => {
    const input = {
      orgId,
      kind: "webhook" as const,
      url: "https://hooks.example.com/briff",
      streamId: null,
      bulletin: true,
      alert: true,
    };
    await setPlan("pro");
    await expect(createDeliveryTarget(db, { ...input, userId: owner })).rejects.toThrow(
      /included in Team/
    );
    await setPlan("team");
    await expect(createDeliveryTarget(db, { ...input, userId: member })).rejects.toThrow(
      DeliveryTargetError
    );
    await expect(
      createDeliveryTarget(db, { ...input, userId: owner, url: "http://hooks.example.com/x" })
    ).rejects.toThrow(/https/);
    await expect(
      createDeliveryTarget(db, {
        ...input,
        userId: owner,
        kind: "slack",
        url: "https://example.com/services/x",
      })
    ).rejects.toThrow(/hooks\.slack\.com/);
    await expect(
      createDeliveryTarget(db, { ...input, userId: owner, streamId: "not-a-stream" })
    ).rejects.toThrow(/stream/);

    const created = await createDeliveryTarget(db, { ...input, userId: owner });
    expect(created.secret).toMatch(/^whsec_/);
    expect(created.urlLabel).toBe("hooks.example.com …riff");
    const events = await withOrg(db, orgId).orgEvent.findMany({
      where: { type: "delivery_target_created" },
      select: { actorUserId: true, detail: true },
    });
    expect(events).toEqual([{ actorUserId: owner, detail: "webhook:hooks.example.com …riff" }]);

    await expect(
      sendTestDelivery(db, { orgId, userId: member, id: created.id }, loopbackPost)
    ).rejects.toThrow(/owner/);
    // Another org's owner cannot reach the target.
    await db.org.update({ where: { id: otherOrgId }, data: { plan: "team" } });
    await expect(
      sendTestDelivery(db, { orgId: otherOrgId, userId: otherOwner, id: created.id }, loopbackPost)
    ).rejects.toThrow(/does not exist/);
    const sent: string[] = [];
    const capture: PostFn = async (target, init) => {
      sent.push(target);
      expect(JSON.parse(init.body)).toMatchObject({ type: "test" });
      return { status: 204, body: "" };
    };
    expect(await sendTestDelivery(db, { orgId, userId: owner, id: created.id }, capture)).toEqual({
      ok: true,
      status: 204,
    });
    expect(sent).toEqual(["https://hooks.example.com/briff"]);

    await setDeliveryTargetEnabled(db, { orgId, userId: owner, id: created.id, enabled: false });
    await setPlan("free");
    await expect(
      setDeliveryTargetEnabled(db, { orgId, userId: owner, id: created.id, enabled: true })
    ).rejects.toThrow(/included in Team/);
    await expect(
      sendTestDelivery(db, { orgId, userId: owner, id: created.id }, capture)
    ).rejects.toThrow(/included in Team/);
  });
});
