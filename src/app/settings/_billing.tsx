import Link from "next/link";
import { Suspense } from "react";

import { buttonVariants } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { UsageBar } from "@/components/ui/usage-bar";
import type { OrgContext } from "@/lib/auth/session";
import { billingConfig } from "@/lib/billing/config";
import { scheduledOf } from "@/lib/billing/labels";
import { liveSubscription } from "@/lib/billing/manage";
import { ADMIN_PLAN_NOTICE, billingOffer, planSourceOf } from "@/lib/billing/offer";
import { graceEndsAt } from "@/lib/billing/state";
import { statusChip } from "@/lib/billing/status-chip";
import { getDb } from "@/lib/db/client";
import { withOrg } from "@/lib/db/with-org";
import { longDate } from "@/lib/email/billing-email";
import type { OrgCapacity } from "@/lib/org-capacity";
import { PLANS } from "@/lib/plans";

import { PaymentMethodRow } from "./billing/_payment-method";
import { loadHistory, loadPaymentMethod } from "./billing/load";

async function LastPayment({ orgId }: { orgId: string }) {
  let last;
  try {
    last = (await loadHistory(orgId))[0];
  } catch {
    return <p className="text-fg-muted text-[13.5px]">Paddle did not answer.</p>;
  }
  if (!last) return <p className="text-fg-muted text-[13.5px]">No payments yet.</p>;
  return (
    <p className="text-[13.5px] tabular-nums">
      <span className="font-medium">{last.total}</span>{" "}
      <span className="text-fg-muted">on {longDate(last.date)}</span>
    </p>
  );
}

async function Method({ orgId }: { orgId: string }) {
  return (
    <PaymentMethodRow state={await loadPaymentMethod(orgId)} now={new Date()} canUpdate={false} />
  );
}

/**
 * Settings -> Billing (hosted service only): plan and status, renewal or end date, usage, and
 * for owners the last payment and the payment method; the details live on /settings/billing.
 */
export async function BillingSummary({
  ctx,
  capacity,
}: {
  ctx: OrgContext;
  capacity: OrgCapacity;
}) {
  const db = getDb();
  const owner = ctx.role === "owner";
  const [org, live, latest] = await Promise.all([
    db.org.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { planSource: true } }),
    liveSubscription(db, ctx.orgId),
    withOrg(db, ctx.orgId).subscription.findFirst({ orderBy: { stateAt: "desc" } }),
  ]);
  const now = new Date();
  const scheduled = live ? scheduledOf(live.scheduledChange) : null;
  const cancelAt = scheduled?.action === "cancel" ? new Date(scheduled.effectiveAt) : null;
  const grace = live?.status === "past_due" ? graceEndsAt(live) : null;
  const ended = !live && latest?.status === "canceled" ? latest : null;
  const chip = live
    ? statusChip({ status: live.status, endsAt: cancelAt, graceEndsAt: grace }, now)
    : ended
      ? statusChip({ status: "canceled", endsAt: ended.currentPeriodEnd, graceEndsAt: null }, now)
      : null;
  const offer = billingOffer({
    plan: capacity.plan,
    planSource: planSourceOf(org.planSource),
    subscribed: live !== null,
  });
  const endsAt =
    cancelAt ??
    (ended?.currentPeriodEnd && ended.currentPeriodEnd > now ? ended.currentPeriodEnd : null);

  let when: string;
  if (offer.kind === "admin") when = ADMIN_PLAN_NOTICE;
  else if (endsAt) when = `Ends on ${longDate(endsAt)}, then Free.`;
  else if (grace) when = `The last payment failed; the plan stays until ${longDate(grace)}.`;
  else if (live?.status === "paused")
    when = "Paused in Paddle: not billed, on Free until it resumes.";
  else if (live?.nextBilledAt)
    when = `Billed ${live.interval === "year" ? "yearly" : "monthly"}, renews on ${longDate(live.nextBilledAt)}.`;
  else when = "No subscription, nothing to pay.";

  const paid = owner && billingConfig() !== null && latest !== null;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="type-h3">{PLANS[capacity.plan].name}</h3>
        {chip && <Tag kind={chip.kind}>{chip.label}</Tag>}
      </div>
      <p className="text-fg-muted mt-1 text-[13.5px]">{when}</p>
      <div className="border-line mt-3 border-t pt-2">
        <UsageBar label="Repos" used={capacity.repos} limit={capacity.repoLimit} />
        <UsageBar label="Streams" used={capacity.streams} limit={capacity.streamLimit} />
        <UsageBar
          label="Members"
          used={capacity.members}
          limit={capacity.memberLimit}
          flag={false}
        />
      </div>
      {paid && (
        <div className="border-line mt-3 grid gap-3 border-t pt-3 min-[560px]:grid-cols-2">
          <div>
            <h4 className="text-fg-muted mb-1 text-[12.5px] font-medium">Last payment</h4>
            <Suspense fallback={<div className="bg-surface-2 rounded-inset h-6" aria-hidden />}>
              <LastPayment orgId={ctx.orgId} />
            </Suspense>
          </div>
          <div>
            <h4 className="text-fg-muted mb-1 text-[12.5px] font-medium">Payment method</h4>
            <Suspense fallback={<div className="bg-surface-2 rounded-inset h-6" aria-hidden />}>
              <Method orgId={ctx.orgId} />
            </Suspense>
          </div>
        </div>
      )}
      <div className="border-line mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <p className="text-fg-muted text-[12.5px]">
          {owner
            ? "Change the plan, the payment method or download invoices under Billing."
            : "Only owners change the plan or the payment method; ask an owner."}
        </p>
        <Link href="/settings/billing" className={buttonVariants({ variant: "secondary" })}>
          Billing details
        </Link>
      </div>
    </>
  );
}
