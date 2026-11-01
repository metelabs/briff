import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/shell/app-shell";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/section-header";
import { requireOrgContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { loadOrgCapacity } from "@/lib/org-capacity";
import { atLimit, PLANS } from "@/lib/plans";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Billing · Briff" };

/** Placeholder until billing opens: the plan, its limits, and that everything is free for now. */
export default async function BillingPage() {
  const ctx = await requireOrgContext();
  const capacity = await loadOrgCapacity(getDb(), ctx.orgId);
  // Self-hosted instances have no plans: the page does not exist there.
  if (!capacity.cloud) notFound();
  const plan = PLANS[capacity.plan];
  const rows = [
    { label: "Repos", used: capacity.repos, limit: capacity.repoLimit },
    { label: "Streams", used: capacity.streams, limit: capacity.streamLimit },
    { label: "Members", used: capacity.members, limit: capacity.memberLimit },
  ];

  return (
    <AppShell ctx={ctx} active="/settings">
      <PageHeader
        eyebrow={
          <Link href="/settings" className="hover:text-fg underline-offset-4 hover:underline">
            Settings
          </Link>
        }
        title="Billing"
        sub="Your organisation's plan and what it allows."
      />
      <div className="grid max-w-[640px] gap-4">
        <section className="rise bg-surface border-line rounded-card border p-5 [--i:1]">
          <p className="text-fg-muted text-[13px]">Current plan</p>
          <h2 className="type-h3 mt-1">{plan.name}</h2>
          <dl className="mt-4">
            {rows.map((r) => (
              <div
                key={r.label}
                className="border-line flex items-center justify-between gap-3 border-t py-2.5 text-[13.5px]"
              >
                <dt>{r.label}</dt>
                <dd
                  className={cn(
                    "tabular-nums",
                    r.label !== "Members" && atLimit(r.used, r.limit) && "text-upgrade font-medium"
                  )}
                >
                  {r.limit === null ? `${r.used} · unlimited` : `${r.used} / ${r.limit}`}
                </dd>
              </div>
            ))}
          </dl>
        </section>
        <section className="rise bg-surface border-line rounded-card border p-5 [--i:2]">
          <h2 className="type-h2">Billing is coming during the beta</h2>
          <p className="text-fg-muted mt-1.5 text-[13.5px]">
            Everything is free for now.{" "}
            {plan.id === "free"
              ? "Pro and Team start when billing opens; your plan stays Free until you choose to upgrade."
              : `Your ${plan.name} plan costs nothing until billing opens.`}
          </p>
          <Link href="/pricing" className={cn(buttonVariants({ variant: "secondary" }), "mt-4")}>
            Compare plans
          </Link>
        </section>
      </div>
    </AppShell>
  );
}
