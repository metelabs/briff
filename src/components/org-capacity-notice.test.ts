import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

import type { OrgCapacity } from "@/lib/org-capacity";

import { OrgCapacityNotice } from "./org-capacity-notice";

const FREE: OrgCapacity = {
  cloud: true,
  plan: "free",
  repos: 8,
  repoLimit: 10,
  streams: 1,
  streamLimit: 2,
  members: 1,
  memberLimit: 1,
  deliveryTargets: 0,
  auditExport: false,
};

const html = (capacity: OrgCapacity) =>
  renderToStaticMarkup(createElement(OrgCapacityNotice, { capacity }));

describe("plan and limits line", () => {
  it("shows usage against the plan with links to the plans and billing", () => {
    const out = html(FREE);
    expect(out).toContain('aria-label="Plan and limits"');
    expect(out.replace(/<[^>]+>/g, "")).toContain(
      "8 / 10 repos · 1 / 2 streams · 1 / 1 member · Free plan"
    );
    expect(out).toContain('href="/pricing"');
    expect(out).toContain('href="/settings/billing"');
    expect(out).not.toContain("deleted");
    const full = html({ ...FREE, repos: 10 }).replace(/<[^>]+>/g, "");
    expect(full).toContain("10 / 10 repos");
    expect(full).toContain("nothing you have is deleted");
  });

  it("shows counts without a limit on an unlimited plan and offers no upgrade", () => {
    const out = html({
      ...FREE,
      plan: "unlimited",
      repoLimit: null,
      streamLimit: null,
      memberLimit: null,
      members: 2,
    });
    expect(out.replace(/<[^>]+>/g, "")).toContain(
      "8 repos · 1 stream · 2 members · Unlimited plan"
    );
    expect(out).not.toContain("/settings/billing");
    expect(out).not.toContain("deleted");
  });

  it("renders nothing on a self-hosted instance", () => {
    expect(html({ ...FREE, cloud: false })).toBe("");
  });
});
