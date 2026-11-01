import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { OrgCapacity } from "@/lib/org-capacity";

const state = vi.hoisted(() => ({ capacity: null as OrgCapacity | null }));
vi.mock("@/lib/auth/session", () => ({ requireOrgContext: async () => ({ orgId: "org-1" }) }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/org-capacity", () => ({
  loadOrgCapacity: async (_db: unknown, orgId: string) => {
    expect(orgId).toBe("org-1");
    return state.capacity;
  },
}));
vi.mock("@/components/shell/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => createElement("main", null, children),
}));

const { default: BillingPage } = await import("./page");

const PRO: OrgCapacity = {
  cloud: true,
  plan: "pro",
  repos: 12,
  repoLimit: 70,
  streams: 10,
  streamLimit: 10,
  members: 2,
  memberLimit: 3,
};

describe("/settings/billing", () => {
  it("shows the org's plan and the limits in force on the hosted service", async () => {
    state.capacity = PRO;
    const text = renderToStaticMarkup(await BillingPage()).replace(/<[^>]+>/g, " ");
    expect(text).toContain("Pro");
    expect(text).toContain("12 / 70");
    expect(text).toContain("10 / 10");
    expect(text).toContain("2 / 3");
    expect(text).toContain("Billing is coming during the beta");
    expect(text).toContain("Your Pro plan costs nothing until billing opens.");
  });

  it("tells a Free org its plan stays Free, and shows unlimited limits as such", async () => {
    state.capacity = { ...PRO, plan: "team", repoLimit: null, streamLimit: null };
    expect(renderToStaticMarkup(await BillingPage())).toContain("12 · unlimited");
    state.capacity = { ...PRO, plan: "free", repoLimit: 10, streamLimit: 2, memberLimit: 1 };
    expect(renderToStaticMarkup(await BillingPage())).toContain("your plan stays Free");
  });

  it("is a 404 on a self-hosted instance", async () => {
    state.capacity = { ...PRO, cloud: false };
    await expect(BillingPage()).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
  });
});
