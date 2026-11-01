"use client";

import { initializePaddle, type Paddle } from "@paddle/paddle-js";
import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ConfirmDialog, FormDialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import type { BillingInterval, CatalogPrice, PaddleEnv, PaidPlanId } from "@/lib/billing/catalog";
import type { PlanChangePreview } from "@/lib/billing/manage";
import { limitLabel, monthsFree, PLANS, usd, type PlanId } from "@/lib/plans";
import { cn } from "@/lib/utils";

import {
  cancelSubscriptionAction,
  changePlanAction,
  invoiceUrlAction,
  portalUrlAction,
  previewPlanChangeAction,
  resumeSubscriptionAction,
} from "./actions";

const PAID: readonly PaidPlanId[] = ["pro", "team"];
const INTERVALS = [
  { value: "month", label: "Monthly" },
  { value: "year", label: "Yearly" },
] as const;
/** After checkout the webhook flips the plan; the page reloads its data until then. */
const POLL_MS = 3000;
const POLL_FOR_MS = 60_000;

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
}: {
  value: PaidPlanId;
  onChange: (plan: PaidPlanId) => void;
  interval: BillingInterval;
  current?: { plan: PaidPlanId; interval: BillingInterval };
}) {
  return (
    <div role="radiogroup" aria-label="Plan" className="mt-4 grid gap-2 min-[560px]:grid-cols-2">
      {PAID.map((id) => {
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
            onClick={() => onChange(id)}
            className={cn(
              "rounded-inset flex flex-col items-stretch justify-start border p-3.5 text-left transition-colors duration-150",
              selected ? "border-brand bg-brand-soft" : "border-line hover:border-line-strong"
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <b className="text-[15px] font-medium">{p.name}</b>
              {isCurrent ? (
                <span className="text-fg-muted text-[12px]">Current</span>
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

/** Reloads the server data every few seconds while `active`, for at most a minute. */
function usePoll(active: boolean, onTimeout: () => void) {
  const router = useRouter();
  const timeout = useRef(onTimeout);
  useEffect(() => {
    timeout.current = onTimeout;
  });
  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    const id = window.setInterval(() => {
      if (Date.now() - started > POLL_FOR_MS) {
        window.clearInterval(id);
        timeout.current();
        return;
      }
      router.refresh();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [active, router]);
}

function paddleTheme(): "light" | "dark" {
  const set = document.documentElement.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export interface CheckoutConfig {
  env: PaddleEnv;
  clientToken: string;
  fake: boolean;
}

/** Owners without a subscription: pick Pro or Team and pay in Paddle's overlay checkout. */
export function CheckoutPanel({
  config,
  prices,
  currentPlan,
  preselect,
  customer,
  customData,
  awaitingCheckout,
}: {
  config: CheckoutConfig;
  prices: CatalogPrice[];
  currentPlan: PlanId;
  preselect: { plan: PaidPlanId; interval: BillingInterval };
  customer: { id: string } | { email: string };
  customData: { orgId: string; orgSig: string };
  awaitingCheckout: boolean;
}) {
  const toast = useToast();
  const [interval, setBillingInterval] = useState<BillingInterval>(preselect.interval);
  const [plan, setPlan] = useState<PaidPlanId>(preselect.plan);
  // Kept from the first render: FlashToast strips ?checkout=success from the URL.
  const [waiting, setWaiting] = useState(awaitingCheckout);
  const [timedOut, setTimedOut] = useState(false);
  const paddle = useRef<Promise<Paddle | undefined> | null>(null);

  usePoll(waiting, () => {
    setWaiting(false);
    setTimedOut(true);
  });

  async function open() {
    const item = prices.find((p) => p.plan === plan && p.interval === interval);
    if (!item) return toast("This plan is not available on this instance.", "error");
    if (config.fake) {
      return toast("BRIFF_PADDLE_FAKE is on: checkout needs a real Paddle client token.", "error");
    }
    paddle.current ??= initializePaddle({
      token: config.clientToken,
      environment: config.env === "live" ? "production" : "sandbox",
      eventCallback: (event) => {
        if (event.name === "checkout.completed") setWaiting(true);
      },
    });
    const instance = await paddle.current;
    if (!instance)
      return toast("Paddle checkout did not load. Reload the page and try again.", "error");
    instance.Checkout.open({
      items: [{ priceId: item.priceId, quantity: 1 }],
      customer,
      customData: { ...customData },
      settings: {
        displayMode: "overlay",
        variant: "one-page",
        theme: paddleTheme(),
        allowLogout: false,
        successUrl: `${window.location.origin}/settings/billing?checkout=success`,
      },
    });
  }

  const upgradeLabel =
    currentPlan === plan ? `Subscribe to ${PLANS[plan].name}` : `Upgrade to ${PLANS[plan].name}`;
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
      {waiting && (
        <Callout
          tone="ok"
          className="mt-4"
          message="Payment received. Your plan updates in a moment, as soon as Paddle confirms it."
        />
      )}
      {timedOut && (
        <Callout
          tone="warn"
          className="mt-4"
          message="Paddle has not confirmed the payment yet. Reload this page in a minute; your plan changes as soon as it does."
        />
      )}
      <PlanChoice value={plan} onChange={setPlan} interval={interval} />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={open} disabled={waiting}>
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
          {preview.billing === "now" && preview.dueNow ? preview.dueNow : "Nothing"}
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
  const unchanged = plan === view.plan && interval === view.interval;

  function review() {
    start(async () => {
      const res = await previewPlanChangeAction({ plan, interval });
      if (!res.ok) return toast(res.message, "error");
      setPreview(res.preview);
      setOpen(true);
    });
  }

  function confirm() {
    start(async () => {
      const res = await changePlanAction({ plan, interval });
      if (!res.ok) return toast(res.message, "error");
      setOpen(false);
      toast(`Plan changed to ${PLANS[plan].name}. Paddle sends the receipt.`);
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
              A bigger plan or yearly billing charges the prorated difference now; a smaller plan or
              monthly billing settles on your next bill.
            </p>
          </div>
          <Segmented
            label="Billing period"
            value={interval}
            onChange={setBillingInterval}
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
          onChange={setPlan}
          interval={interval}
          current={{ plan: view.plan, interval: view.interval }}
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
        title={`Switch to ${PLANS[plan].name} ${interval === "year" ? "yearly" : "monthly"}?`}
        description={
          preview?.billing === "now"
            ? "The new plan starts now; Paddle charges the prorated difference to your saved payment method."
            : "The new plan starts now; the difference is settled on your next bill, nothing is refunded today."
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
