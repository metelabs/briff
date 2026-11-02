import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense, type CSSProperties, type ReactNode } from "react";

import { AppShell } from "@/components/shell/app-shell";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/section-header";
import { Tag } from "@/components/ui/tag";
import { getOrgContext } from "@/lib/auth/session";
import { isBillingInterval, onArchivedPrice } from "@/lib/billing/catalog";
import { billingConfig } from "@/lib/billing/config";
import { longDate } from "@/lib/email/billing-email";
import { scheduledOf } from "@/lib/billing/labels";
import { liveSubscription } from "@/lib/billing/manage";
import { ADMIN_PLAN_NOTICE, billingOffer, planSourceOf } from "@/lib/billing/offer";
import { graceEndsAt } from "@/lib/billing/state";
import { statusChip } from "@/lib/billing/status-chip";
import { getDb } from "@/lib/db/client";
import { withOrg } from "@/lib/db/with-org";
import { loadOrgCapacity } from "@/lib/org-capacity";
import { atLimit, PLANS } from "@/lib/plans";
import { cn } from "@/lib/utils";

import { CheckoutPanel, InvoiceButton, ManagePanel, type ManageView } from "./_client";
import { PaymentMethodRow } from "./_payment-method";
import { loadHistory, loadPaymentMethod } from "./load";

export const metadata: Metadata = { title: "Billing · Briff" };

function Card({
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

async function PaymentMethod({ orgId }: { orgId: string }) {
  const state = await loadPaymentMethod(orgId);
  return <PaymentMethodRow state={state} now={new Date()} canUpdate />;
}

async function History({ orgId }: { orgId: string }) {
  let rows;
  try {
    rows = await loadHistory(orgId);
  } catch {
    return (
      <p className="text-fg-muted text-[13.5px]">
        Paddle did not answer. Reload the page to try again.
      </p>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="text-fg-muted text-[13.5px]">
        No payments yet. Paddle lists each one here with its invoice.
      </p>
    );
  }
  return (
    <ul>
      {rows.map((t) => (
        <li
          key={t.id}
          className="border-line grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 border-t py-2.5 text-[13.5px] first:border-t-0"
        >
          <span className="min-w-0">
            <span className="block tabular-nums">{t.date.toISOString().slice(0, 10)}</span>
            <span className="text-fg-muted block truncate text-[12.5px]">
              <span className="font-mono">{t.invoiceNumber ?? t.id}</span> ·{" "}
              {t.status.replace("_", " ")}
            </span>
          </span>
          <span className="font-medium tabular-nums">{t.total}</span>
          <InvoiceButton transactionId={t.id} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Settings -> Billing (docs/BILLING.md): the plan and its limits for everyone; for owners the
 * Paddle checkout, plan changes, cancel and resume, the payment portal and billing history.
 */
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getOrgContext();
  // /pricing links here: a visitor without an account goes to sign-up.
  if (!ctx) redirect("/signup");
  const db = getDb();
  const capacity = await loadOrgCapacity(db, ctx.orgId);
  // Self-hosted instances have no plans: the page does not exist there.
  if (!capacity.cloud) notFound();
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const config = billingConfig();
  const owner = ctx.role === "owner";
  const [org, live, latest, owners] = await Promise.all([
    db.org.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { planSource: true } }),
    liveSubscription(db, ctx.orgId),
    withOrg(db, ctx.orgId).subscription.findFirst({ orderBy: { stateAt: "desc" } }),
    withOrg(db, ctx.orgId).orgMember.findMany({
      where: { role: "owner" },
      orderBy: { createdAt: "asc" },
      select: { user: { select: { email: true } } },
    }),
  ]);
  const plan = PLANS[capacity.plan];
  const sub = live ?? latest;
  const scheduled = live ? scheduledOf(live.scheduledChange) : null;
  const cancelAt = scheduled?.action === "cancel" ? new Date(scheduled.effectiveAt) : null;
  const grace = live?.status === "past_due" ? graceEndsAt(live) : null;
  const now = new Date();
  // A canceled subscription keeps its plan to the end of the period it paid for.
  const ended = !live && latest?.status === "canceled" ? latest : null;
  const offer = billingOffer({
    plan: capacity.plan,
    planSource: planSourceOf(org.planSource),
    subscribed: live !== null,
  });
  const rows = [
    { label: "Repos", used: capacity.repos, limit: capacity.repoLimit },
    { label: "Streams", used: capacity.streams, limit: capacity.streamLimit },
    { label: "Members", used: capacity.members, limit: capacity.memberLimit },
  ];

  let status: string;
  if (capacity.plan === "unlimited")
    status = "Unlimited is set by the instance admin; there is nothing to pay.";
  else if (live && cancelAt)
    status = `Canceled: ${plan.name} ends on ${longDate(cancelAt)}, then the organisation moves to Free.`;
  else if (live?.status === "paused")
    status = `Paused in Paddle: ${plan.name} is not billed, and the organisation is on Free until it resumes.`;
  else if (live && grace)
    status = `The last payment failed. ${plan.name} stays until ${longDate(grace)} while Paddle retries; update the payment method to keep it.`;
  else if (live?.nextBilledAt)
    status = `${PLANS[live.plan].name}, billed ${live.interval === "year" ? "yearly" : "monthly"}. Renews on ${longDate(live.nextBilledAt)}.`;
  else if (
    ended?.currentPeriodEnd &&
    ended.currentPeriodEnd.getTime() > now.getTime() &&
    capacity.plan === ended.plan
  )
    status = `Canceled: ${plan.name} ends on ${longDate(ended.currentPeriodEnd)}, then the organisation moves to Free.`;
  else if (org.planSource === "admin" && capacity.plan !== "free")
    status = `${plan.name} was set by the instance admin, without a subscription.`;
  else status = "Free: no subscription, nothing to pay.";
  const tag = live
    ? statusChip({ status: live.status, endsAt: cancelAt, graceEndsAt: grace }, now)
    : ended
      ? statusChip({ status: "canceled", endsAt: ended.currentPeriodEnd, graceEndsAt: null }, now)
      : null;
  const offered = offer.kind === "checkout" ? offer.plans : [];

  const preselect = {
    plan: offered.find((p) => p === one(params.plan)) ?? offered[0] ?? "pro",
    interval: isBillingInterval(one(params.interval))
      ? (one(params.interval) as "month" | "year")
      : live?.interval === "year"
        ? "year"
        : "month",
  } as const;

  const liveTerms = live
    ? ({
        plan: live.plan === "team" ? "team" : "pro",
        interval: live.interval === "year" ? "year" : "month",
      } as const)
    : null;
  const manageView: ManageView | null =
    live && liveTerms && config
      ? {
          ...liveTerms,
          archivedPrice: onArchivedPrice(config.env, liveTerms, live.paddlePriceId),
          cancelAt: cancelAt?.toISOString() ?? null,
          paused: live.status === "paused",
          periodEnd: (live.currentPeriodEnd ?? live.nextBilledAt)?.toISOString() ?? null,
        }
      : null;

  return (
    <AppShell ctx={ctx} active="/settings">
      <PageHeader
        eyebrow={
          <Link href="/settings" className="hover:text-fg underline-offset-4 hover:underline">
            Settings
          </Link>
        }
        title="Billing"
        sub="Your organisation's plan, what it allows and how it is paid."
      />
      <div className="grid max-w-[640px] gap-4">
        <Card index={1}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-fg-muted text-[13px]">Current plan</p>
            {tag && <Tag kind={tag.kind}>{tag.label}</Tag>}
          </div>
          <h2 className="type-h3 mt-1">{plan.name}</h2>
          <p className="text-fg-muted mt-1 text-[13.5px]">{status}</p>
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
        </Card>

        {offer.kind === "admin" ? (
          <Card index={2}>
            <h2 className="type-h2">Set by the instance admin</h2>
            <p className="text-fg-muted mt-1.5 text-[13.5px]">{ADMIN_PLAN_NOTICE}</p>
          </Card>
        ) : !config ? (
          <Card index={2}>
            <h2 className="type-h2">Billing is not configured on this instance</h2>
            <p className="text-fg-muted mt-1.5 text-[13.5px]">
              Plans stay as they are. The operator turns billing on with the Paddle keys
              (docs/BILLING.md).
            </p>
          </Card>
        ) : !owner ? (
          <Card index={2}>
            <h2 className="type-h2">Owners manage billing</h2>
            <p className="text-fg-muted mt-1.5 text-[13.5px]">
              To change the plan or the payment method, ask an owner:{" "}
              <span className="text-fg">{owners.map((o) => o.user.email).join(", ")}</span>.
            </p>
          </Card>
        ) : manageView ? (
          <ManagePanel view={manageView} />
        ) : offer.kind === "checkout" ? (
          <CheckoutPanel
            config={{
              env: config.env,
              clientToken: config.clientToken,
              fake: config.fake,
              checkout: config.checkout,
            }}
            plans={offer.plans}
            preselect={preselect}
            awaitingCheckout={one(params.checkout) === "success"}
          />
        ) : null}

        {config && owner && live && (
          <Card index={3}>
            <h2 className="type-h2">Payment method</h2>
            <p className="text-fg-muted mt-1 mb-3 text-[13.5px]">
              Paddle charges renewals and plan changes to this method, without asking again.
            </p>
            <Suspense fallback={<div className="bg-surface-2 rounded-inset h-10" aria-hidden />}>
              <PaymentMethod orgId={ctx.orgId} />
            </Suspense>
          </Card>
        )}

        {config && owner && sub && (
          <Card index={4}>
            <h2 className="type-h2">Billing history</h2>
            <p className="text-fg-muted mt-1 mb-3 text-[13.5px]">
              The last {12} payments, with their invoices from Paddle.
            </p>
            <Suspense fallback={<div className="bg-surface-2 rounded-inset h-24" aria-hidden />}>
              <History orgId={ctx.orgId} />
            </Suspense>
          </Card>
        )}

        <p className="text-fg-muted text-[13px]">
          <Link href="/pricing" className={cn(buttonVariants({ variant: "link" }), "text-[13px]")}>
            Compare plans
          </Link>{" "}
          · Payments, invoices and VAT are handled by Paddle, our merchant of record.
        </p>
      </div>
    </AppShell>
  );
}
