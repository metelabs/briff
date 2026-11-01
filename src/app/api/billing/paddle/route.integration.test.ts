import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  event,
  paddleSignature,
  subscriptionData,
  transactionData,
  type SubscriptionFixture,
} from "@/lib/billing/__fixtures__/events";
import { checkoutCustomData } from "@/lib/billing/org-link";
import { getDb } from "@/lib/db/client";
import { withOrg } from "@/lib/db/with-org";
import { createOrgForUser } from "@/lib/org";
import { resetEnvCache } from "@/lib/env";

const hooks = vi.hoisted(() => ({
  after: [] as (() => Promise<void>)[],
  alerts: [] as { jobType: string; headline?: string }[],
}));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (fn: () => Promise<void>) => hooks.after.push(fn),
}));
vi.mock("@/lib/ops/alerts", () => ({
  sendOpsAlert: async (_db: unknown, alert: { jobType: string; headline?: string }) => {
    hooks.alerts.push(alert);
    return "sent";
  },
}));

const { POST } = await import("./route");

const url = process.env.TEST_DATABASE_URL;
const SECRET = "pdl_ntfset_test_secret";
const AUTH_SECRET = "a".repeat(32);

describe.skipIf(!url)("POST /api/billing/paddle", () => {
  const saved = { ...process.env };
  const suffix = Date.now().toString(36);
  const orgs: string[] = [];
  const users: string[] = [];
  let seq = 0;

  const deliver = (body: unknown, signature?: string) => {
    const raw = typeof body === "string" ? body : JSON.stringify(body);
    return POST(
      new Request("http://127.0.0.1:3000/api/billing/paddle", {
        method: "POST",
        headers: {
          "paddle-signature": signature ?? paddleSignature(SECRET, raw),
          "content-type": "application/json",
        },
        body: raw,
      })
    );
  };
  const subEvent = (
    type: string,
    f: SubscriptionFixture,
    occurredAt: string,
    id = `evt_${suffix}_${++seq}`
  ) => event(type, subscriptionData(f), { id, occurredAt });
  const result = async (res: Response) => ((await res.json()) as { result?: string }).result;

  async function org(
    name: string,
    data: {
      plan?: "free" | "pro" | "team" | "unlimited";
      planSource?: "default" | "admin" | "paddle";
    } = {}
  ) {
    // With an owner: billing emails are queued per owner.
    const userId = `u-${name}-${suffix}`;
    await getDb().user.create({
      data: { id: userId, name, email: `${name}-${suffix}@example.com` },
    });
    users.push(userId);
    const id = await createOrgForUser(getDb(), { name: `${name}-${suffix}`, userId });
    await getDb().org.update({ where: { id }, data });
    orgs.push(id);
    return id;
  }
  const notices = (orgId: string) =>
    getDb().job.findMany({
      where: { type: "billing-notify", payload: { path: ["orgId"], equals: orgId } },
      orderBy: { createdAt: "asc" },
    });

  beforeAll(() => {
    Object.assign(process.env, {
      DATABASE_URL: url,
      BETTER_AUTH_SECRET: AUTH_SECRET,
      BETTER_AUTH_URL: "http://127.0.0.1:3000",
      BRIFF_CLOUD: "true",
      PADDLE_ENV: "sandbox",
      PADDLE_WEBHOOK_SECRET: SECRET,
    });
    resetEnvCache();
  });
  beforeEach(() => {
    hooks.after.length = 0;
    hooks.alerts.length = 0;
  });
  afterAll(async () => {
    const db = getDb();
    await db.job.deleteMany({ where: { dedupeKey: { contains: suffix } } });
    await db.billingEvent.deleteMany({ where: { id: { contains: suffix } } });
    await db.org.deleteMany({ where: { id: { in: orgs } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    process.env = saved;
    resetEnvCache();
  });

  it("follows a subscription through checkout, cancel, past_due and the end, once per event", async () => {
    const orgId = await org("acme");
    const sub = {
      id: `sub_${suffix}_a`,
      customerId: `ctm_${suffix}_a`,
      customData: checkoutCustomData(AUTH_SECRET, orgId),
    };
    const created = subEvent(
      "subscription.created",
      { ...sub, status: "active" },
      "2026-11-02T10:00:00Z"
    );

    const first = await deliver(created);
    expect(first.status).toBe(200);
    expect(await result(first)).toBe("applied (plan-changed)");
    const db = getDb();
    expect(
      await db.org.findUniqueOrThrow({
        where: { id: orgId },
        select: { plan: true, planSource: true, paddleCustomerId: true },
      })
    ).toEqual({
      plan: "pro",
      planSource: "paddle",
      paddleCustomerId: sub.customerId,
    });
    const events = await withOrg(db, orgId).orgEvent.findMany({ where: { type: "plan_changed" } });
    expect(events.map((e) => e.detail)).toEqual(["paddle:free:pro"]);

    // A retry of the same event is a no-op.
    expect(await result(await deliver(created))).toBe("duplicate");
    expect((await notices(orgId)).map((j) => (j.payload as { kind: string }).kind)).toEqual([
      "plan-changed",
    ]);

    // The user cancels: still Pro, until the end of the period.
    const cancel = {
      action: "cancel" as const,
      effective_at: "2026-12-02T10:00:00Z",
      resume_at: null,
    };
    expect(
      await result(
        await deliver(
          subEvent(
            "subscription.updated",
            { ...sub, status: "active", scheduledChange: cancel },
            "2026-11-05T10:00:00Z"
          )
        )
      )
    ).toBe("applied (canceled)");
    // An older update arriving late changes nothing.
    expect(
      await result(
        await deliver(
          subEvent("subscription.updated", { ...sub, status: "paused" }, "2026-11-03T10:00:00Z")
        )
      )
    ).toBe("stale");
    const row = await withOrg(db, orgId).subscription.findFirstOrThrow({});
    expect(row.status).toBe("active");
    expect(row.scheduledChange).toMatchObject({ action: "cancel" });

    // Renewal fails: past_due keeps Pro during the grace period.
    expect(
      await result(
        await deliver(
          subEvent("subscription.past_due", { ...sub, status: "past_due" }, "2026-11-06T10:00:00Z")
        )
      )
    ).toBe("applied (payment-failed)");
    expect((await db.org.findUniqueOrThrow({ where: { id: orgId } })).plan).toBe("pro");
    expect(
      (await withOrg(db, orgId).subscription.findFirstOrThrow({})).pastDueSince?.toISOString()
    ).toBe("2026-11-06T10:00:00.000Z");

    // Paddle ends it: Free, with an audit event and an email.
    expect(
      await result(
        await deliver(
          subEvent(
            "subscription.canceled",
            { ...sub, status: "canceled", canceledAt: "2026-11-07T10:00:00Z" },
            "2026-11-07T10:00:00Z"
          )
        )
      )
    ).toBe("applied (plan-changed)");
    expect((await db.org.findUniqueOrThrow({ where: { id: orgId } })).plan).toBe("free");
    expect((await notices(orgId)).map((j) => j.payload)).toEqual([
      expect.objectContaining({ kind: "plan-changed", from: "free", to: "pro" }),
      expect.objectContaining({ kind: "canceled", plan: "pro", endsAt: "2026-12-02T10:00:00Z" }),
      expect.objectContaining({ kind: "payment-failed", plan: "pro" }),
      expect.objectContaining({ kind: "plan-changed", from: "pro", to: "free" }),
    ]);
    expect(hooks.alerts).toEqual([]);
  });

  it("handles an update that arrives before its create", async () => {
    const orgId = await org("early");
    const sub = {
      id: `sub_${suffix}_b`,
      customerId: `ctm_${suffix}_b`,
      customData: checkoutCustomData(AUTH_SECRET, orgId),
      priceId: "pri_01m6c6ehqacmse2ybry03yxe3h",
    };
    expect(
      await result(
        await deliver(
          subEvent("subscription.updated", { ...sub, status: "active" }, "2026-11-02T10:00:02Z")
        )
      )
    ).toBe("applied (plan-changed)");
    expect(
      await result(
        await deliver(
          subEvent("subscription.created", { ...sub, status: "trialing" }, "2026-11-02T10:00:00Z")
        )
      )
    ).toBe("stale");
    expect((await getDb().org.findUniqueOrThrow({ where: { id: orgId } })).plan).toBe("team");
  });

  it("never lowers an admin plan or touches unlimited", async () => {
    const unlimited = await org("friends", { plan: "unlimited", planSource: "admin" });
    const sub = {
      id: `sub_${suffix}_c`,
      customerId: `ctm_${suffix}_c`,
      customData: checkoutCustomData(AUTH_SECRET, unlimited),
    };
    await deliver(
      subEvent("subscription.created", { ...sub, status: "active" }, "2026-11-02T10:00:00Z")
    );
    await deliver(
      subEvent("subscription.canceled", { ...sub, status: "canceled" }, "2026-11-03T10:00:00Z")
    );
    expect((await getDb().org.findUniqueOrThrow({ where: { id: unlimited } })).plan).toBe(
      "unlimited"
    );

    const team = await org("gifted", { plan: "team", planSource: "admin" });
    const sub2 = {
      id: `sub_${suffix}_d`,
      customerId: `ctm_${suffix}_d`,
      customData: checkoutCustomData(AUTH_SECRET, team),
    };
    await deliver(
      subEvent("subscription.created", { ...sub2, status: "active" }, "2026-11-02T10:00:00Z")
    );
    await deliver(
      subEvent("subscription.canceled", { ...sub2, status: "canceled" }, "2026-11-03T10:00:00Z")
    );
    expect(
      await getDb().org.findUniqueOrThrow({
        where: { id: team },
        select: { plan: true, planSource: true },
      })
    ).toEqual({ plan: "team", planSource: "admin" });
  });

  it("maps by Paddle customer when custom_data is missing, and refuses a forged org id", async () => {
    const orgId = await org("linked");
    const customerId = `ctm_${suffix}_e`;
    // A completed checkout links the customer first.
    const txn = event(
      "transaction.completed",
      transactionData({
        id: `txn_${suffix}`,
        customerId,
        subscriptionId: null,
        customData: checkoutCustomData(AUTH_SECRET, orgId),
      }),
      { id: `evt_${suffix}_txn`, occurredAt: "2026-11-02T10:00:00Z" }
    );
    expect(await result(await deliver(txn))).toBe("customer linked");
    expect(
      await result(
        await deliver(
          subEvent(
            "subscription.activated",
            { id: `sub_${suffix}_e`, customerId, status: "active" },
            "2026-11-02T10:00:01Z"
          )
        )
      )
    ).toBe("applied (plan-changed)");

    const victim = await org("victim");
    const forged = subEvent(
      "subscription.created",
      {
        id: `sub_${suffix}_f`,
        customerId: `ctm_${suffix}_f`,
        status: "active",
        customData: { orgId: victim, orgSig: "forged" },
      },
      "2026-11-02T10:00:00Z"
    );
    const res = await deliver(forged);
    expect(res.status).toBe(500);
    expect((await getDb().org.findUniqueOrThrow({ where: { id: victim } })).plan).toBe("free");
    const stored = await getDb().billingEvent.findUniqueOrThrow({ where: { id: forged.event_id } });
    expect(stored.processedAt).toBeNull();
    expect(stored.error).toMatch(/no org/);
    await Promise.all(hooks.after.map((fn) => fn()));
    expect(hooks.alerts.map((a) => a.jobType)).toEqual(["paddle-webhook:processing"]);
  });

  it("stores and ignores unknown and informational events", async () => {
    const unknown = event(
      "briff.unknown",
      { id: "x" },
      { id: `evt_${suffix}_u`, occurredAt: "2026-11-02T10:00:00Z" }
    );
    expect(await result(await deliver(unknown))).toBe("ignored");
    const failed = event(
      "transaction.payment_failed",
      transactionData({
        id: `txn_${suffix}_pf`,
        customerId: "ctm_x",
        subscriptionId: null,
        status: "past_due",
      }),
      { id: `evt_${suffix}_pf`, occurredAt: "2026-11-02T10:00:00Z" }
    );
    expect(await result(await deliver(failed))).toBe("recorded");
    const row = await getDb().billingEvent.findUniqueOrThrow({ where: { id: unknown.event_id } });
    expect(row.type).toBe("briff.unknown");
    expect(row.processedAt).not.toBeNull();
  });

  it("rejects bad signatures, stale signatures, oversized bodies and a missing secret", async () => {
    const body = subEvent(
      "subscription.created",
      { id: "sub_x", customerId: "ctm_x", status: "active" },
      "2026-11-02T10:00:00Z"
    );
    const raw = JSON.stringify(body);
    expect((await deliver(raw, paddleSignature("wrong", raw))).status).toBe(401);
    expect(
      (await deliver(raw, paddleSignature(SECRET, raw, Math.floor(Date.now() / 1000) - 60))).status
    ).toBe(401);
    expect((await deliver(raw, "")).status).toBe(400);
    await Promise.all(hooks.after.map((fn) => fn()));
    expect(hooks.alerts.map((a) => a.jobType)).toEqual([
      "paddle-webhook:signature",
      "paddle-webhook:signature",
    ]);
    expect(await getDb().billingEvent.count({ where: { id: body.event_id } })).toBe(0);

    expect((await deliver("x".repeat(5 * 1024 * 1024 + 1))).status).toBe(413);
    delete process.env.PADDLE_WEBHOOK_SECRET;
    resetEnvCache();
    expect((await deliver(raw)).status).toBe(503);
    process.env.PADDLE_WEBHOOK_SECRET = SECRET;
    resetEnvCache();
  });
});
