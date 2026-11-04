"use client";

import type { Paddle } from "@paddle/paddle-js";
import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type CSSProperties, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ConfirmDialog, FormDialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import type { BillingInterval, PaddleEnv, PaidPlanId } from "@/lib/billing/catalog";
import type { PlanChangePreview } from "@/lib/billing/manage";
import { chargeSentence } from "@/lib/billing/payment-method";
import { limitLabel, monthsFree, PLANS, usd } from "@/lib/plans";
import { cn } from "@/lib/utils";

import {
  cancelSubscriptionAction,
  changePlanAction,
  invoiceUrlAction,
  paymentMethodUrlAction,
  portalUrlAction,
  previewPlanChangeAction,
  resumeSubscriptionAction,
  startCheckoutAction,
} from "./actions";
import { CheckoutWait } from "./checkout/_wait";
import { chargedAmount } from "./checkout/flow";
import { checkoutHref, loadPaddle, paddleTheme } from "./paddle";

const PAID: readonly PaidPlanId[] = ["pro", "team"];
const INTERVALS = [
  { value: "month", label: "Monthly" },
  { value: "year", label: "Yearly" },
] as const;

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function Panel({ index, children }: { index: number; children: ReactNode }) {
  return (
    <section
      style={{ "--i": index } as CSSProperties}
      className="rise bg-surface border-line rounded-card border p-5 max-[560px]:p-[15px]"
    >
      {children}
    </section>
  );
}

function price(plan: PaidPlanId, interval: BillingInterval): string {
  const p = PLANS[plan];
  const amount = (interval === "month" ? p.monthlyUsd : p.yearlyUsd) ?? 0;
  return `${usd(amount)} per ${interval}`;
}

/** Radio cards for Pro and Team; `disabled` marks the current terms. */
function PlanChoice({
  value,
  onChange,
  interval,
  current,
  plans = PAID,
  disabled = false,
}: {
  value: PaidPlanId;
  onChange: (plan: PaidPlanId) => void;
  interval: BillingInterval;
  current?: { plan: PaidPlanId; interval: BillingInterval; archivedPrice?: boolean };
  plans?: readonly PaidPlanId[];
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="Plan" className="mt-4 grid gap-2 min-[560px]:grid-cols-2">
      {plans.map((id) => {
        const p = PLANS[id];
        const selected = value === id;
        const isCurrent = current?.plan === id && current.interval === interval;
        const saved = interval === "year" ? monthsFree(p) : 0;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(id)}
            className={cn(
              "rounded-inset flex flex-col items-stretch justify-start border p-3.5 text-left transition-colors duration-150",
              selected ? "border-brand bg-brand-soft" : "border-line hover:border-line-strong"
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <b className="text-[15px] font-medium">{p.name}</b>
              {isCurrent ? (
                <span className="text-fg-muted text-[12px]">
                  {current.archivedPrice ? "Current, at an older price" : "Current"}
                </span>
              ) : (
                selected && <Check aria-hidden className="text-brand size-4" />
              )}
            </span>
            <span className="mt-1 block text-[13.5px] tabular-nums">
              {price(id, interval)}
              {saved > 0 && <span className="text-fg-muted"> · {saved} months free</span>}
            </span>
            <span className="text-fg-muted mt-1 block text-[12.5px]">
              {limitLabel(p.repos, "repo")} · {limitLabel(p.streams, "stream")} ·{" "}
              {limitLabel(p.members, "member")}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export interface CheckoutConfig {
  env: PaddleEnv;
  clientToken: string;
  fake: boolean;
  checkout: "inline" | "overlay";
}

/**
 * Owners without a subscription: pick a plan the org may buy (`billingOffer`), then pay on
 * Briff's checkout page (inline frame) or in Paddle's overlay (BRIFF_CHECKOUT=overlay). The
 * checkout's price, customer and signed org id come from `startCheckoutAction`, which refuses
 * a plan the org already has.
 */
export function CheckoutPanel({
  config,
  plans,
  preselect,
}: {
  config: CheckoutConfig;
  plans: readonly PaidPlanId[];
  preselect: { plan: PaidPlanId; interval: BillingInterval };
}) {
  const toast = useToast();
  const router = useRouter();
  const [interval, setBillingInterval] = useState<BillingInterval>(preselect.interval);
  const [plan, setPlan] = useState<PaidPlanId>(
    plans.includes(preselect.plan) ? preselect.plan : (plans[0] ?? "pro")
  );
  const [pending, start] = useTransition();
  const paddle = useRef<Promise<Paddle | undefined> | null>(null);
  // The terms of the overlay opened last: Paddle.js keeps the first listener for the page.
  const opened = useRef<{ plan: PaidPlanId; interval: BillingInterval } | null>(null);
  // The terms and amount Paddle completed; the panel then waits for the webhook.
  const [completed, setCompleted] = useState<{
    plan: PaidPlanId;
    interval: BillingInterval;
    amount: string;
  } | null>(null);

  function open() {
    if (config.checkout === "inline") {
      router.push(checkoutHref(plan, interval));
      return;
    }
    start(async () => {
      const res = await startCheckoutAction({ plan, interval });
      if (!res.ok) return toast(res.message, "error");
      const terms = { plan, interval };
      if (config.fake) {
        // No Paddle.js without a client token: go straight to what checkout.completed does.
        setCompleted({ ...terms, amount: chargedAmount(undefined, terms) });
        return;
      }
      opened.current = terms;
      paddle.current ??= loadPaddle(config, (event) => {
        const done = opened.current;
        if (event.name !== "checkout.completed" || !done) return;
        setCompleted((prev) => prev ?? { ...done, amount: chargedAmount(event.data, done) });
        void paddle.current?.then((p) => p?.Checkout.close());
      });
      const instance = await paddle.current.catch(() => {
        paddle.current = null;
        return undefined;
      });
      if (!instance)
        return toast("Paddle checkout did not load. Reload the page and try again.", "error");
      instance.Checkout.open({
        items: [{ priceId: res.session.priceId, quantity: 1 }],
        customer: res.session.customer,
        customData: { ...res.session.customData },
        settings: {
          displayMode: "overlay",
          variant: "one-page",
          theme: paddleTheme(),
          allowLogout: false,
        },
      });
    });
  }

  const upgradeLabel = `Upgrade to ${PLANS[plan].name}`;
  if (completed) {
    return (
      <Panel index={2}>
        <CheckoutWait {...completed} />
      </Panel>
    );
  }
  return (
    <Panel index={2}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="type-h2">Choose a plan</h2>
          <p className="text-fg-muted mt-1 text-[13.5px]">
            Paddle takes the payment and adds VAT or sales tax where it applies. Cancel anytime.
          </p>
        </div>
        <Segmented
          label="Billing period"
          value={interval}
          onChange={setBillingInterval}
          options={INTERVALS}
        />
      </div>
      <PlanChoice value={plan} onChange={setPlan} interval={interval} plans={plans} />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={open} disabled={pending}>
          {upgradeLabel}
        </Button>
        <span className="text-fg-muted text-[12.5px]">
          {price(plan, interval)}, billed by Paddle
        </span>
      </div>
    </Panel>
  );
}

export interface ManageView {
  plan: PaidPlanId;
  interval: BillingInterval;
  /** On an archived price of this plan: the current list price is offered as a change. */
  archivedPrice: boolean;
  /** A scheduled cancel's date; null when the subscription renews. */
  cancelAt: string | null;
  /** Paused in Paddle: resumed from the portal; no plan change. */
  paused: boolean;
  periodEnd: string | null;
}

function PreviewLines({ preview }: { preview: PlanChangePreview }) {
  const to = PLANS[preview.to.plan].name;
  const per = preview.to.interval === "year" ? "year" : "month";
  return (
    <dl className="text-[13.5px]">
      <div className="border-line flex justify-between gap-3 border-t py-2.5">
        <dt>New plan</dt>
        <dd className="font-medium">
          {to}, {preview.to.interval === "year" ? "yearly" : "monthly"}
        </dd>
      </div>
      <div className="border-line flex justify-between gap-3 border-t py-2.5">
        <dt>Due now</dt>
        <dd className="font-medium tabular-nums">
          {preview.billing === "now" && preview.dueNow
            ? preview.dueNow
            : preview.credit
              ? `Nothing (${preview.credit} credit)`
              : "Nothing"}
        </dd>
      </div>
      <div className="border-line flex justify-between gap-3 border-t border-b py-2.5">
        <dt>Then</dt>
        <dd className="tabular-nums">
          {preview.recurring ? `${preview.recurring} per ${per}` : "—"}
          {preview.nextBilledAt && (
            <span className="text-fg-muted block text-right text-[12.5px]">
              next bill {longDate(preview.nextBilledAt)}
            </span>
          )}
        </dd>
      </div>
    </dl>
  );
}

/** Owners with a subscription: change plan (preview, then confirm), cancel or resume, portal. */
export function ManagePanel({ view }: { view: ManageView }) {
  const toast = useToast();
  const router = useRouter();
  const [interval, setBillingInterval] = useState<BillingInterval>(view.interval);
  const [plan, setPlan] = useState<PaidPlanId>(view.plan);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<PlanChangePreview | null>(null);
  const [pending, start] = useTransition();
  // Only the newest preview may open the dialog: an older answer arriving late must not show
  // (and then confirm) terms the owner has already moved away from.
  const previewSeq = useRef(0);
  const unchanged = plan === view.plan && interval === view.interval && !view.archivedPrice;

  function review() {
    const seq = ++previewSeq.current;
    const terms = { plan, interval };
    start(async () => {
      const res = await previewPlanChangeAction(terms);
      if (seq !== previewSeq.current) return;
      if (!res.ok) return toast(res.message, "error");
      setPreview(res.preview);
      setOpen(true);
    });
  }

  function choose(next: { plan?: PaidPlanId; interval?: BillingInterval }) {
    previewSeq.current++;
    if (next.plan) setPlan(next.plan);
    if (next.interval) setBillingInterval(next.interval);
  }

  function confirm() {
    if (!preview) return;
    // Exactly the terms the owner saw in the preview, not whatever the cards say now.
    const terms = preview.to;
    start(async () => {
      const res = await changePlanAction(terms);
      if (!res.ok) return toast(res.message, "error");
      setOpen(false);
      toast(`Plan changed to ${PLANS[terms.plan].name}. Paddle sends the receipt.`);
      router.refresh();
    });
  }

  function cancel() {
    start(async () => {
      const res = await cancelSubscriptionAction();
      if (!res.ok) return toast(res.message, "error");
      toast(
        !view.paused && view.periodEnd
          ? `Canceled. ${PLANS[view.plan].name} stays until ${longDate(view.periodEnd)}.`
          : "Canceled."
      );
      router.refresh();
    });
  }

  function resume() {
    start(async () => {
      const res = await resumeSubscriptionAction();
      if (!res.ok) return toast(res.message, "error");
      toast("Resumed. Your subscription renews as before.");
      router.refresh();
    });
  }

  function portal() {
    start(async () => {
      const res = await portalUrlAction();
      if (!res.ok) return toast(res.message, "error");
      window.location.assign(res.url);
    });
  }

  return (
    <>
      <Panel index={2}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="type-h2">Change plan</h2>
            <p className="text-fg-muted mt-1 text-[13.5px]">
              A bigger plan or another billing period is prorated now (yearly to monthly credits the
              unused time); a smaller plan on the same period settles on your next bill.
            </p>
          </div>
          <Segmented
            label="Billing period"
            value={interval}
            onChange={(next) => choose({ interval: next })}
            options={INTERVALS}
          />
        </div>
        {view.paused && (
          <Callout
            tone="warn"
            className="mt-4"
            message="This subscription is paused in Paddle. Resume it from the payment portal below, or cancel it."
          />
        )}
        {view.cancelAt && (
          <Callout
            tone="warn"
            className="mt-4"
            message={`Your subscription ends on ${longDate(view.cancelAt)}. Resume it to change the plan.`}
          />
        )}
        <PlanChoice
          value={plan}
          onChange={(next) => choose({ plan: next })}
          interval={interval}
          current={{
            plan: view.plan,
            interval: view.interval,
            archivedPrice: view.archivedPrice,
          }}
        />
        <div className="mt-4">
          <Button
            variant="primary"
            onClick={review}
            disabled={pending || unchanged || !!view.cancelAt || view.paused}
          >
            Review change
          </Button>
        </div>
      </Panel>

      <Panel index={3}>
        <h2 className="type-h2">Subscription</h2>
        <p className="text-fg-muted mt-1 text-[13.5px]">
          {view.cancelAt
            ? `Canceled: it ends on ${longDate(view.cancelAt)}. Resume to keep ${PLANS[view.plan].name}.`
            : "Payment method, invoices and billing address live in Paddle's customer portal."}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={portal} disabled={pending}>
            Manage payment method and invoices
          </Button>
          {view.cancelAt ? (
            <Button variant="secondary" onClick={resume} disabled={pending}>
              Resume subscription
            </Button>
          ) : (
            <ConfirmDialog
              trigger={
                <Button variant="secondary" disabled={pending}>
                  Cancel subscription
                </Button>
              }
              title="Cancel the subscription?"
              description={
                view.paused
                  ? "The paused subscription ends now and the organisation stays on Free; nothing is deleted."
                  : view.periodEnd
                    ? `${PLANS[view.plan].name} stays until ${longDate(view.periodEnd)}, the end of the period you paid for. Then the organisation moves to Free; nothing is deleted.`
                    : "The plan stays until the end of the period you paid for. Then the organisation moves to Free; nothing is deleted."
              }
              confirmLabel={view.paused ? "Cancel now" : "Cancel at period end"}
              onConfirm={cancel}
              pending={pending}
            />
          )}
        </div>
      </Panel>

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={
          preview
            ? `Switch to ${PLANS[preview.to.plan].name} ${preview.to.interval === "year" ? "yearly" : "monthly"}?`
            : "Switch plan?"
        }
        description={
          preview
            ? `The new plan starts now. ${chargeSentence({ ...preview, interval: preview.to.interval }, preview.method)}`
            : ""
        }
      >
        {preview && <PreviewLines preview={preview} />}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Keep current plan
          </Button>
          <Button variant="primary" onClick={confirm} disabled={pending}>
            Confirm change
          </Button>
        </div>
      </FormDialog>
    </>
  );
}

export function InvoiceButton({ transactionId }: { transactionId: string }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await invoiceUrlAction(transactionId);
          if (!res.ok) return toast(res.message, "error");
          window.location.assign(res.url);
        })
      }
    >
      Invoice
    </Button>
  );
}

/** "Update" on the payment method card: Paddle's update-payment-method page, else the portal. */
export function UpdatePaymentMethodButton({ label = "Update" }: { label?: string }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await paymentMethodUrlAction();
          if (!res.ok) return toast(res.message, "error");
          window.location.assign(res.url);
        })
      }
    >
      {label}
    </Button>
  );
}
