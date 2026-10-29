import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { MinimalHeader } from "@/components/shell/page-container";
import { OrgCapacityNotice } from "@/components/org-capacity-notice";
import { loadOrgCapacity } from "@/lib/org-capacity";
import { requireOrgContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { shouldOnboard } from "@/lib/member-state";

import { finishOnboardingAction } from "./actions";
import { Onboarding, SignOutLink } from "./_client";
import { loadConnectData } from "./loaders";

export const metadata: Metadata = { title: "Connect repos · Briff" };

/**
 * First run only (no repo in a stream yet, not skipped). Afterwards the same steps live in
 * the Connect repos sheet of the top bar, and this page sends you home.
 */
export default async function OnboardingPage() {
  const ctx = await requireOrgContext();
  if (!(await shouldOnboard(getDb(), ctx.orgId, ctx.userId))) redirect("/");
  const [data, capacity] = await Promise.all([
    loadConnectData(ctx.orgId),
    loadOrgCapacity(getDb(), ctx.orgId),
  ]);
  return (
    <div className="min-h-svh">
      <MinimalHeader>
        <SignOutLink />
      </MinimalHeader>
      <main className="gutter mx-auto max-w-[652px] pt-6 pb-20">
        <OrgCapacityNotice capacity={capacity} />
        <Onboarding data={data} finishAction={finishOnboardingAction} />
      </main>
    </div>
  );
}
