import { PrismaPg } from "@prisma/adapter-pg";
import { ApiError, Subscription as PaddleSubscription } from "@paddle/paddle-node-sdk";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { resetEnvCache } from "@/lib/env";
import { log } from "@/lib/log";
import { createOrgForUser } from "@/lib/org";

import type { BillingApi } from "./api";
import { setBillingApiForTests } from "./api";
import { subscriptionData, TEAM_MONTHLY } from "./__fixtures__/events";
import { billingCheck, billingNotify } from "./jobs";
import {
  billingHistory,
  cancelSubscription,
  changePlan,
  checkoutSession,
  endSubscriptions,
  invoiceUrl,
  paymentMethodState,
  paymentMethodUrl,
  portalUrl,
  previewPlanChange,
} from "./manage";
import { ADMIN_PLAN_NOTICE } from "./offer";
import { snapshotOf, type PaddleSubscriptionLike } from "./state";
import { applySubscription } from "./sync";

const mail = vi.hoisted(() => ({ sent: [] as { to: string; subject: string }[], fail: false }));
vi.mock("@/lib/email/mailer", () => ({
  sendMail: async (m: { to: string; subject: string }) => {
    if (mail.fail) return { status: "failed", error: "smtp down" };
    mail.sent.push({ to: m.to, subject: m.subject });
    return { status: "sent" };
  },
}));

const url = process.env.TEST_DATABASE_URL;
const DAY = 86_400_000;

/** A recording fake of the Paddle API; every write returns the given subscription state. */
function fakeApi(remote: (id: string) => PaddleSubscriptionLike) {
  const calls: string[] = [];
  const api: BillingApi = {
    getSubscription: async (id) => (calls.push(`get ${id}`), remote(id)),
    previewPriceChange: async (id, priceId, mode) => (
      calls.push(`preview ${id} ${priceId} ${mode}`),
      {
        dueNow: "$8.00",
        credit: null,
        recurring: "$12.00",
        nextBilledAt: new Date("2026-12-02T10:00:00Z"),
      }
    ),
    changePrice: async (id, priceId, mode) => (
      calls.push(`change ${id} ${priceId} ${mode}`),
      remote(id)
    ),
    cancelAtPeriodEnd: async (id) => (calls.push(`cancel ${id}`), remote(id)),
    cancelNow: async (id) => (calls.push(`cancelNow ${id}`), remote(id)),
    removeScheduledChange: async (id) => (calls.push(`resume ${id}`), remote(id)),
    customerEmail: async (id) => (calls.push(`customer ${id}`), "payer@example.com"),
    portalUrl: async (id, subs) => (
      calls.push(`portal ${id} ${subs.join(",")}`),
      "https://portal.example/session"
    ),
    listTransactions: async (customer, subs) => (
      calls.push(`list ${customer} ${subs.join(",")}`),
      [{ id: "txn_1", date: new Date(), status: "completed", total: "$4.00", invoiceNumber: "1" }]
    ),
    transactionOwner: async (id) => (
      calls.push(`owner ${id}`),
      { customerId: "ctm_a", subscriptionId: "sub_a_live" }
    ),
    invoiceUrl: async (id) => (calls.push(`invoice ${id}`), "https://invoice.example/pdf"),
    paymentMethod: async (customer, subs) => (
      calls.push(`method ${customer} ${subs.join(",")}`),
      {
        brand: "visa",
        type: "card",
        network: "visa",
        last4: "4242",
        expiryMonth: 1,
        expiryYear: 2030,
        email: null,
      }
    ),
    paymentMethodUpdateUrl: async (id) => (
      calls.push(`pmurl ${id}`),
      "https://portal.example/update-payment-method"
    ),
  };
  return { api, calls };
}

/** The SDK's API entity for a wire payload (same shape the real API answer is parsed into). */
function entity(data: ReturnType<typeof subscriptionData>): PaddleSubscriptionLike {
  // Paddle's answer to a write or a read now: changed just now unless the fixture says otherwise.
  if (data.updated_at === "2026-11-02T10:00:00.000Z") data.updated_at = new Date().toISOString();
  return new PaddleSubscription(data as never);
}

describe.skipIf(!url)("billing management, tenant checks and billing-check", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const suffix = Date.now().toString(36);
  const users: string[] = [];
  const orgs: string[] = [];
  let orgA = "";
  let orgB = "";
  const owner = { userId: "", email: "" };
  const member = { userId: "", email: "" };
  const ownerB = { userId: "", email: "" };

  async function user(tag: string) {
    const id = `u-${tag}-${suffix}`;
    const email = `${tag}-${suffix}@example.com`;
    await db.user.create({ data: { id, name: tag, email } });
    users.push(id);
    return { userId: id, email };
  }

  async function seed(
    orgId: string,
    id: string,
    customerId: string,
    status: "active" | "past_due" | "paused",
    stateAt: Date
  ) {
    const snap = snapshotOf(
      entity(subscriptionData({ id, customerId, status, updatedAt: stateAt.toISOString() })),
      "sandbox"
    );
    await withOrg(db, orgId).$transaction((tx) =>
      applySubscription(tx, orgId, snap, stateAt, new Date())
    );
  }

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: url,
      BETTER_AUTH_SECRET: "a".repeat(32),
      BETTER_AUTH_URL: "http://127.0.0.1:3000",
      BRIFF_CLOUD: "true",
      PADDLE_ENV: "sandbox",
    });
    resetEnvCache();
    Object.assign(owner, await user("owner"));
    Object.assign(member, await user("member"));
    Object.assign(ownerB, await user("ownerb"));
    orgA = await createOrgForUser(db, { name: `A-${suffix}`, userId: owner.userId });
    orgB = await createOrgForUser(db, { name: `B-${suffix}`, userId: ownerB.userId });
    orgs.push(orgA, orgB);
    await withOrg(db, orgA).orgMember.create({
      data: { orgId: orgA, userId: member.userId, role: "member" },
    });
    await seed(orgA, "sub_a_live", "ctm_a", "active", new Date());
    await seed(orgB, "sub_b_live", "ctm_b", "active", new Date());
  });

  beforeEach(() => {
    mail.sent.length = 0;
    setBillingApiForTests(undefined);
  });

  afterAll(async () => {
    setBillingApiForTests(undefined);
    await db.job.deleteMany({
      where: {
        type: "billing-notify",
        OR: orgs.map((o) => ({ payload: { path: ["orgId"], equals: o } })),
      },
    });
    await db.org.deleteMany({ where: { id: { in: orgs } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  });

  it("acts only on the actor's own org subscription, and only for owners", async () => {
    const { api, calls } = fakeApi((id) =>
      entity(
        subscriptionData({
          id,
          customerId: id.startsWith("sub_b") ? "ctm_b" : "ctm_a",
          status: "active",
          priceId: TEAM_MONTHLY,
        })
      )
    );
    const actor = { orgId: orgA, ...owner };

    expect(
      await previewPlanChange(db, api, "sandbox", actor, { plan: "team", interval: "month" })
    ).toMatchObject({
      ok: true,
      preview: { billing: "now", dueNow: "$8.00" },
    });
    expect(
      await changePlan(db, api, "sandbox", actor, { plan: "team", interval: "month" })
    ).toEqual({ ok: true });
    // Paddle's answer is mirrored at once: Team, with an email queued.
    expect((await db.org.findUniqueOrThrow({ where: { id: orgA } })).plan).toBe("team");

    // B's owner never reaches A's subscription; a member of A gets nothing either.
    expect(await cancelSubscription(db, api, "sandbox", { orgId: orgB, ...ownerB })).toEqual({
      ok: true,
    });
    expect(await cancelSubscription(db, api, "sandbox", { orgId: orgA, ...member })).toEqual({
      ok: false,
      message: "Only an owner can manage billing.",
    });
    expect(await portalUrl(db, api, { orgId: orgA, ...member })).toMatchObject({ ok: false });
    expect(calls).toEqual([
      "preview sub_a_live pri_01m6f8ct27w63hejyzxa69cdg9 prorated_immediately",
      "method ctm_a sub_a_live",
      "change sub_a_live pri_01m6f8ct27w63hejyzxa69cdg9 prorated_immediately",
      "cancel sub_b_live",
    ]);
  });

  it("opens the portal only for the payer and invoices only of the org's own subscriptions", async () => {
    const { api, calls } = fakeApi((id) =>
      entity(subscriptionData({ id, customerId: "ctm_a", status: "active" }))
    );
    expect(await portalUrl(db, api, { orgId: orgA, ...owner })).toMatchObject({
      ok: false,
      message: expect.stringContaining("payer@example.com"),
    });
    expect(
      await portalUrl(db, api, { orgId: orgA, userId: owner.userId, email: "PAYER@example.com" })
    ).toEqual({
      ok: true,
      url: "https://portal.example/session",
    });
    expect(calls).toContain("portal ctm_a sub_a_live");

    // The fake says the transaction belongs to sub_a_live: A may download it, B may not.
    expect(await invoiceUrl(db, api, { orgId: orgA, ...owner }, "txn_1")).toEqual({
      ok: true,
      url: "https://invoice.example/pdf",
    });
    expect(await invoiceUrl(db, api, { orgId: orgB, ...ownerB }, "txn_1")).toMatchObject({
      ok: false,
    });

    await billingHistory(db, api, orgB);
    expect(calls).toContain("list ctm_b sub_b_live");
  });

  it("cancels live subscriptions at once before an org is deleted", async () => {
    const { api, calls } = fakeApi((id) =>
      entity(subscriptionData({ id, customerId: "ctm_b", status: "canceled" }))
    );
    setBillingApiForTests(api);
    // A paused subscription can resume on its own: deleting the org cancels it too.
    await seed(orgB, `sub_b_paused_${suffix}`, "ctm_b", "paused", new Date());
    calls.length = 0;
    expect(await endSubscriptions(db, orgB)).toBeNull();
    expect(calls.sort()).toEqual(
      [`cancelNow sub_b_live`, `cancelNow sub_b_paused_${suffix}`].sort()
    );
    setBillingApiForTests(null);
    const live = await db.org.create({ data: { name: `C-${suffix}` } });
    orgs.push(live.id);
    await seed(live.id, `sub_c_${suffix}`, "ctm_c", "active", new Date());
    expect(await endSubscriptions(db, live.id)).toMatch(/billing is not configured/);
  });

  it("cancels a paused subscription at once and refuses plan changes on it", async () => {
    const orgId = await createOrgForUser(db, { name: `E-${suffix}`, userId: owner.userId });
    orgs.push(orgId);
    await seed(orgId, `sub_e_${suffix}`, "ctm_e", "paused", new Date());
    const { api, calls } = fakeApi((id) =>
      entity(subscriptionData({ id, customerId: "ctm_e", status: "canceled" }))
    );
    const actor = { orgId, ...owner };
    expect(
      await changePlan(db, api, "sandbox", actor, { plan: "team", interval: "month" })
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("paused"),
    });
    expect(await cancelSubscription(db, api, "sandbox", actor)).toEqual({ ok: true });
    expect(calls).toEqual([`cancelNow sub_e_${suffix}`]);
  });

  it("billing-check reconciles stale subscriptions, ends expired grace, and emails owners", async () => {
    const orgId = await createOrgForUser(db, { name: `D-${suffix}`, userId: owner.userId });
    orgs.push(orgId);
    // past_due for 20 days and no event for 2: the grace is over.
    const long = new Date(Date.now() - 20 * DAY);
    await seed(orgId, `sub_d_${suffix}`, "ctm_d", "past_due", new Date(Date.now() - 2 * DAY));
    expect((await db.org.findUniqueOrThrow({ where: { id: orgId } })).plan).toBe("pro");
    await withOrg(db, orgId).subscription.updateMany({ data: { pastDueSince: long } });

    const { api, calls } = fakeApi((id) =>
      entity(subscriptionData({ id, customerId: "ctm_d", status: "past_due" }))
    );
    setBillingApiForTests(api);
    const ctx = { db, log, jobId: "j", payload: {}, heartbeat: async () => {} };
    const res = await billingCheck(ctx);
    expect(calls).toContain(`get sub_d_${suffix}`);
    expect(res.counts).toMatchObject({ failed: 0 });
    expect((await db.org.findUniqueOrThrow({ where: { id: orgId } })).plan).toBe("free");
    const sub = await withOrg(db, orgId).subscription.findFirstOrThrow({});
    // Ordered by Paddle's updated_at, not by when billing-check read it.
    expect(sub.stateAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(sub.pastDueSince?.getTime()).toBe(long.getTime());

    const jobs = await db.job.findMany({
      where: { type: "billing-notify", payload: { path: ["orgId"], equals: orgId } },
    });
    const kinds = jobs.map((j) => (j.payload as { kind: string }).kind).sort();
    // The seed queued nothing; the grace expiry is the one change.
    expect(kinds).toEqual(["plan-changed"]);
    // One job per owner: a failed send throws so the runner retries that email alone.
    mail.fail = true;
    await expect(billingNotify({ ...ctx, payload: jobs[0].payload })).rejects.toThrow(/smtp down/);
    mail.fail = false;
    for (const job of jobs) await billingNotify({ ...ctx, payload: job.payload });
    expect(mail.sent.every((m) => m.to === owner.email)).toBe(true);
    expect(mail.sent.map((m) => m.subject)).toContain(`D-${suffix} is on the Free plan now`);
  });
  it("refuses a checkout for the plan the org has, next to a subscription, or over an admin plan", async () => {
    const orgId = await createOrgForUser(db, { name: `F-${suffix}`, userId: owner.userId });
    orgs.push(orgId);
    const actor = { orgId, ...owner };
    const secret = "a".repeat(32);
    const pro = { plan: "pro", interval: "month" } as const;
    const team = { plan: "team", interval: "year" } as const;

    // Free: both plans, with the org's signed id in custom_data.
    expect(await checkoutSession(db, "sandbox", actor, pro, secret)).toMatchObject({
      ok: true,
      session: {
        priceId: "pri_01m6f8cst11wvmmvpcw6k6q9xa",
        customer: { email: owner.email },
        customData: { orgId },
      },
    });
    expect(await checkoutSession(db, "sandbox", { orgId: orgA, ...member }, pro, secret)).toEqual({
      ok: false,
      message: "Only an owner can manage billing.",
    });

    // Pro set by the instance admin, no subscription: nothing to buy (the bug: it offered Pro).
    await db.org.update({ where: { id: orgId }, data: { plan: "pro", planSource: "admin" } });
    expect(await checkoutSession(db, "sandbox", actor, pro, secret)).toEqual({
      ok: false,
      message: ADMIN_PLAN_NOTICE,
    });
    expect(await checkoutSession(db, "sandbox", actor, team, secret)).toMatchObject({ ok: false });
    await db.org.update({ where: { id: orgId }, data: { plan: "unlimited" } });
    expect(await checkoutSession(db, "sandbox", actor, team, secret)).toEqual({
      ok: false,
      message: ADMIN_PLAN_NOTICE,
    });

    // An admin-set Free (overrides only) may buy Pro; the paid plan then belongs to billing.
    await db.org.update({ where: { id: orgId }, data: { plan: "free", planSource: "admin" } });
    expect(await checkoutSession(db, "sandbox", actor, pro, secret)).toMatchObject({ ok: true });
    await seed(orgId, `sub_f_${suffix}`, "ctm_f", "active", new Date());
    const org = await db.org.findUniqueOrThrow({ where: { id: orgId } });
    expect({ plan: org.plan, planSource: org.planSource }).toEqual({
      plan: "pro",
      planSource: "paddle",
    });

    // A live subscription changes plan under Billing, never through a second checkout.
    expect(await checkoutSession(db, "sandbox", actor, team, secret)).toMatchObject({
      ok: false,
      message: expect.stringContaining("already has a subscription"),
    });

    // Canceled but still in its paid period: Pro is the current plan, Team can be bought.
    await withOrg(db, orgId).subscription.updateMany({ data: { status: "canceled" } });
    expect(await checkoutSession(db, "sandbox", actor, pro, secret)).toEqual({
      ok: false,
      message: "This organisation already has that plan.",
    });
    expect(await checkoutSession(db, "sandbox", actor, team, secret)).toMatchObject({
      ok: true,
      session: { customer: { id: "ctm_f" } },
    });
  });

  it("prorates a change of billing period now and words Paddle's refusal", async () => {
    const orgId = await createOrgForUser(db, { name: `G-${suffix}`, userId: owner.userId });
    orgs.push(orgId);
    await seed(orgId, `sub_g_${suffix}`, "ctm_g", "active", new Date());
    const actor = { orgId, ...owner };
    const { api, calls } = fakeApi((id) =>
      entity(subscriptionData({ id, customerId: "ctm_g", status: "active", priceId: TEAM_MONTHLY }))
    );
    // Pro monthly -> Pro yearly and -> Team yearly: Paddle allows only immediate modes.
    await previewPlanChange(db, api, "sandbox", actor, { plan: "pro", interval: "year" });
    await previewPlanChange(db, api, "sandbox", actor, { plan: "team", interval: "year" });
    expect(calls.filter((c) => c.startsWith("preview"))).toEqual([
      `preview sub_g_${suffix} pri_01m6f8csyaetjaydk2fxa3m9wf prorated_immediately`,
      `preview sub_g_${suffix} pri_01m6f8ct6a0dme5cygpx6yrajv prorated_immediately`,
    ]);
    const preview = await previewPlanChange(db, api, "sandbox", actor, {
      plan: "team",
      interval: "month",
    });
    expect(preview).toMatchObject({ ok: true, preview: { method: "Visa\u00a0••••\u00a04242" } });

    const rejecting: typeof api = {
      ...api,
      previewPriceChange: async () => {
        throw new ApiError(
          {
            type: "request_error",
            code: "subscription_new_items_not_valid",
            detail: "the new items are not valid for updating this subscription",
            documentation_url: "",
          },
          null
        );
      },
    };
    expect(
      await previewPlanChange(db, rejecting, "sandbox", actor, { plan: "team", interval: "year" })
    ).toEqual({
      ok: false,
      message:
        "Paddle cannot switch your subscription to that plan this way. Nothing changed and nothing was charged.",
    });
  });

  it("shows the org's payment method, or the portal note without payment_method.read", async () => {
    const orgId = await createOrgForUser(db, { name: `H-${suffix}`, userId: owner.userId });
    orgs.push(orgId);
    expect(
      await paymentMethodState(
        db,
        fakeApi(() => entity(subscriptionData({ id: "x", customerId: "y", status: "active" }))).api,
        orgId
      )
    ).toEqual({ kind: "none" });
    await seed(orgId, `sub_h_${suffix}`, "ctm_h", "active", new Date());
    const { api, calls } = fakeApi((id) =>
      entity(subscriptionData({ id, customerId: "ctm_h", status: "active" }))
    );
    expect(await paymentMethodState(db, api, orgId)).toMatchObject({
      kind: "known",
      method: { last4: "4242" },
    });
    const forbidden: typeof api = {
      ...api,
      paymentMethod: async () => {
        throw new ApiError(
          {
            type: "request_error",
            code: "forbidden",
            detail: "not authorized to read customer-payment-method",
            documentation_url: "",
          },
          null
        );
      },
    };
    expect(await paymentMethodState(db, forbidden, orgId)).toEqual({ kind: "unavailable" });

    // Update opens the subscription's own payment method link, for the payer only.
    expect(await paymentMethodUrl(db, api, { orgId, ...owner })).toMatchObject({ ok: false });
    const payer: typeof api = { ...api, customerEmail: async () => owner.email };
    expect(await paymentMethodUrl(db, payer, { orgId, ...owner })).toEqual({
      ok: true,
      url: "https://portal.example/update-payment-method",
    });
    expect(calls).toContain(`pmurl sub_h_${suffix}`);
  });
});
