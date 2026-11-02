import { Check, LockKeyhole } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";

import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/section-header";
import { getOrgContext } from "@/lib/auth/session";
import { billingConfig } from "@/lib/billing/config";
import { checkoutTerms, liveSubscription } from "@/lib/billing/manage";
import { billingOffer, planSourceOf } from "@/lib/billing/offer";
import { getDb } from "@/lib/db/client";
import { loadOrgCapacity } from "@/lib/org-capacity";
import { INCLUDED_FEATURES, limitLabel, monthsFree, PLANS, usd } from "@/lib/plans";
import { cn } from "@/lib/utils";

import { checkoutHref } from "../paddle";
import { InlineCheckout } from "./_client";

export const metadata: Metadata = { title: "Checkout · Briff" };

function Panel({
  index,
  children,
  className,
}: {
  index: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      style={{ "--i": index } as CSSProperties}
      className={cn(
        "rise bg-surface border-line rounded-card border p-5 max-[560px]:p-[15px]",
        className
      )}
    >
      {children}
    </section>
  );
}

function Usage({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  return (
    <div className="border-line flex items-center justify-between gap-3 border-t py-2 text-[13.5px]">
      <span>{label}</span>
      <span className="tabular-nums">
        {used} <span className="text-fg-muted">→ {limit === null ? "unlimited" : limit}</span>
      </span>
    </div>
  );
}

/**
 * Settings -> Billing -> Checkout (BRIFF_CHECKOUT=inline, docs/BILLING.md): Briff's summary of
 * the plan on the left, Paddle's inline checkout frame on the right. Only owners, and only for
 * a plan the org may buy; everything else goes back to the billing page, which says why.
 */
export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login?mode=sign-up");
  const db = getDb();
  const capacity = await loadOrgCapacity(db, ctx.orgId);
  if (!capacity.cloud) notFound();
  const config = billingConfig();
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  if (!config || ctx.role !== "owner") redirect("/settings/billing");
  if (config.checkout === "overlay") {
    redirect(
      `/settings/billing?${new URLSearchParams({ plan: one(params.plan) ?? "", interval: one(params.interval) ?? "" })}`
    );
  }
  const [org, live] = await Promise.all([
    db.org.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { planSource: true } }),
    liveSubscription(db, ctx.orgId),
  ]);
  const offer = billingOffer({
    plan: capacity.plan,
    planSource: planSourceOf(org.planSource),
    subscribed: live !== null,
  });
  if (offer.kind !== "checkout") redirect("/settings/billing");
  const terms = checkoutTerms(one(params.plan), one(params.interval), offer.plans);
  if (!terms) redirect("/settings/billing");

  const plan = PLANS[terms.plan];
  const yearly = terms.interval === "year";
  const amount = (yearly ? plan.yearlyUsd : plan.monthlyUsd) ?? 0;
  const free = monthsFree(plan);
  const other = yearly ? "month" : "year";

  return (
    <AppShell ctx={ctx} active="/settings">
      <PageHeader
        eyebrow={
          <Link
            href="/settings/billing"
            className="hover:text-fg underline-offset-4 hover:underline"
          >
            Billing
          </Link>
        }
        title={`Upgrade to ${plan.name}`}
        sub="Check the plan and what it includes, then pay securely with Paddle."
      />
      <div className="grid items-start gap-4 min-[980px]:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] min-[980px]:gap-[18px]">
        <div className="grid gap-3">
          <Panel index={1}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="type-h3">{plan.name}</h2>
              <Link
                href={`/settings/billing?plan=${terms.plan}&interval=${terms.interval}`}
                className="text-brand text-[13px] underline-offset-4 hover:underline"
              >
                Change plan
              </Link>
            </div>
            <p className="text-fg-muted mt-1 text-[13.5px]">{plan.pitch}</p>
            <p className="mt-4 flex flex-wrap items-baseline gap-x-2">
              <span className="font-display text-[34px] leading-none font-semibold tracking-[-0.03em] tabular-nums">
                {usd(amount)}
              </span>
              <span className="text-fg-muted text-[13.5px]">
                per {terms.interval}
                {yearly && free > 0 && ` · ${free} months free`}
              </span>
            </p>
            <p className="text-fg-muted mt-1.5 text-[12.5px]">
              Paddle adds VAT or sales tax where it applies and may show your local currency.{" "}
              <Link
                href={checkoutHref(terms.plan, other)}
                className="text-brand underline-offset-4 hover:underline"
              >
                {yearly ? "Pay monthly instead" : "Pay yearly instead"}
              </Link>
            </p>
          </Panel>

          <Panel index={2}>
            <h2 className="type-h2">What is included</h2>
            <ul className="mt-3 grid gap-1.5 text-[13.5px]">
              {[
                limitLabel(plan.repos, "repo"),
                limitLabel(plan.streams, "stream"),
                limitLabel(plan.members, "member"),
                ...INCLUDED_FEATURES,
              ].map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <Check aria-hidden className="text-brand size-4 shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
            <h3 className="text-fg-muted mt-5 mb-1 text-[12.5px] font-medium">
              Your organisation now → with {plan.name}
            </h3>
            <Usage label="Repos" used={capacity.repos} limit={plan.repos} />
            <Usage label="Streams" used={capacity.streams} limit={plan.streams} />
            <Usage label="Members" used={capacity.members} limit={plan.members} />
          </Panel>

          <Panel index={3} className="flex items-start gap-3">
            <LockKeyhole aria-hidden className="text-brand mt-0.5 size-[18px] shrink-0" />
            <div className="text-[13.5px]">
              <p className="font-medium">Secure payment by Paddle</p>
              <p className="text-fg-muted mt-0.5">
                Paddle is our merchant of record: it takes the payment, sends the receipt and
                invoice, and handles VAT and refunds. Card details go to Paddle; Briff never sees
                them. Cancel anytime from Billing.{" "}
                <Link href="/pricing#faq" className="text-brand underline-offset-4 hover:underline">
                  Billing questions
                </Link>
              </p>
            </div>
          </Panel>
        </div>

        <Panel index={2} className="min-h-[480px]">
          <InlineCheckout
            config={{ env: config.env, clientToken: config.clientToken, fake: config.fake }}
            terms={terms}
          />
        </Panel>
      </div>
    </AppShell>
  );
}
