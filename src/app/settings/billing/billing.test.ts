import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OrgCapacity } from "@/lib/org-capacity";

interface SubRow {
  plan: string;
  interval: string;
  status: string;
  paddlePriceId: string;
  scheduledChange: unknown;
  nextBilledAt: Date | null;
  currentPeriodEnd: Date | null;
  pastDueSince: Date | null;
  stateAt: Date;
}

const state = vi.hoisted(() => ({
  capacity: null as OrgCapacity | null,
  role: "owner" as "owner" | "member",
  configured: true,
  sub: null as SubRow | null,
  planSource: "default",
}));
vi.mock("@/lib/auth/session", () => ({
  getOrgContext: async () => ({
    orgId: "org-1",
    userId: "u1",
    email: "o@example.com",
    role: state.role,
  }),
}));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ BETTER_AUTH_SECRET: "s".repeat(32) }) }));
vi.mock("@/lib/billing/config", () => ({
  billingConfig: () =>
    state.configured ? { env: "sandbox", clientToken: "test_x", fake: false } : null,
}));
vi.mock("@/lib/billing/api", () => ({ getBillingApi: () => null }));
vi.mock("@/lib/billing/manage", () => ({
  liveSubscription: async () => (state.sub && state.sub.status !== "canceled" ? state.sub : null),
  billingHistory: async () => [],
}));
vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    org: {
      findUniqueOrThrow: async () => ({ planSource: state.planSource, paddleCustomerId: null }),
    },
  }),
}));
vi.mock("@/lib/db/with-org", () => ({
  withOrg: () => ({
    subscription: { findFirst: async () => state.sub },
    orgMember: { findMany: async () => [{ user: { email: "boss@example.com" } }] },
  }),
}));
vi.mock("@/lib/org-capacity", () => ({ loadOrgCapacity: async () => state.capacity }));
vi.mock("@/components/shell/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => createElement("main", null, children),
}));
vi.mock("./_payment-method", () => ({ PaymentMethodRow: () => null }));
vi.mock("./load", () => ({ loadHistory: async () => [], loadPaymentMethod: async () => null }));
vi.mock("./_client", () => ({
  CheckoutPanel: ({ plans }: { plans: string[] }) =>
    createElement("div", null, `CHECKOUT ${plans.join(",")}`),
  ManagePanel: ({ view }: { view: { cancelAt: string | null } }) =>
    createElement("div", null, `MANAGE ${view.cancelAt ?? "renews"}`),
  InvoiceButton: () => null,
}));

const { default: BillingPage } = await import("./page");

const FREE: OrgCapacity = {
  cloud: true,
  plan: "free",
  repos: 3,
  repoLimit: 10,
  streams: 1,
  streamLimit: 2,
  members: 1,
  memberLimit: 1,
};

const PRO_SUB: SubRow = {
  plan: "pro",
  interval: "month",
  status: "active",
  paddlePriceId: "pri_01m6f8cst11wvmmvpcw6k6q9xa",
  scheduledChange: null,
  nextBilledAt: new Date("2026-12-02T00:00:00Z"),
  currentPeriodEnd: new Date("2026-12-02T00:00:00Z"),
  pastDueSince: null,
  stateAt: new Date(),
};

async function render(params: Record<string, string> = {}): Promise<string> {
  const page = await BillingPage({ searchParams: Promise.resolve(params) });
  return renderToStaticMarkup(page).replace(/<[^>]+>/g, " ");
}

describe("/settings/billing", () => {
  beforeEach(() => {
    state.capacity = FREE;
    state.role = "owner";
    state.configured = true;
    state.sub = null;
    state.planSource = "default";
  });

  it("offers checkout to a Free owner", async () => {
    const text = await render();
    expect(text).toContain("Free: no subscription");
    expect(text).toContain("3 / 10");
    expect(text).toContain("CHECKOUT pro,team");
  });

  it("shows the admin notice instead of a checkout for an admin-set plan", async () => {
    state.capacity = { ...FREE, plan: "pro" };
    state.planSource = "admin";
    const text = await render();
    expect(text).toContain("Your plan is set by the instance admin");
    expect(text).not.toContain("CHECKOUT");
    expect(text).toContain("Compare plans");

    state.capacity = { ...FREE, plan: "unlimited" };
    expect(await render()).toContain("Your plan is set by the instance admin");
  });

  it("still offers a plan to an org whose admin-set plan is Free", async () => {
    state.planSource = "admin";
    expect(await render()).toContain("CHECKOUT pro,team");
  });

  it("reads Canceled for a far end date and Ends soon for a near one", async () => {
    state.capacity = { ...FREE, plan: "team" };
    const far = new Date(Date.now() + 365 * 86_400_000).toISOString();
    state.sub = {
      ...PRO_SUB,
      plan: "team",
      scheduledChange: { action: "cancel", effectiveAt: far, resumeAt: null },
    };
    let text = await render();
    expect(text).toContain("CANCELED");
    expect(text).not.toContain("ENDS SOON");
    const near = new Date(Date.now() + 5 * 86_400_000).toISOString();
    state.sub = {
      ...PRO_SUB,
      plan: "team",
      scheduledChange: { action: "cancel", effectiveAt: near, resumeAt: null },
    };
    text = await render();
    expect(text).toContain("ENDS SOON");
  });

  it("shows the renewal and the manage panel for a Pro subscription", async () => {
    state.capacity = { ...FREE, plan: "pro", repoLimit: 50, streamLimit: 10, memberLimit: 3 };
    state.sub = PRO_SUB;
    const text = await render();
    expect(text).toContain("Renews on 2 December 2026");
    expect(text).toContain("MANAGE renews");
    expect(text).toContain("Billing history");
  });

  it("shows the end date of a scheduled cancel", async () => {
    state.capacity = { ...FREE, plan: "pro" };
    state.sub = {
      ...PRO_SUB,
      scheduledChange: { action: "cancel", effectiveAt: "2026-12-02T00:00:00Z", resumeAt: null },
    };
    const text = await render();
    expect(text).toContain("Pro ends on 2 December 2026");
    expect(text).toContain("MANAGE 2026-12-02");
  });

  it("manages a paused subscription instead of offering a second checkout", async () => {
    state.sub = { ...PRO_SUB, status: "paused" };
    const text = await render();
    expect(text).toContain("Paused in Paddle");
    expect(text).toContain("MANAGE renews");
    expect(text).not.toContain("CHECKOUT");
  });

  it("tells a member to ask an owner and shows no controls", async () => {
    state.role = "member";
    const text = await render();
    expect(text).toContain("ask an owner");
    expect(text).toContain("boss@example.com");
    expect(text).not.toContain("CHECKOUT");
  });

  it("says billing is not configured without the Paddle keys", async () => {
    state.configured = false;
    const text = await render();
    expect(text).toContain("Billing is not configured on this instance");
    expect(text).not.toContain("CHECKOUT");
  });

  it("is a 404 on a self-hosted instance", async () => {
    state.capacity = { ...FREE, cloud: false };
    await expect(render()).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
  });
});
