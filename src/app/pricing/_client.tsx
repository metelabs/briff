"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useState, type CSSProperties } from "react";

import { buttonVariants } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { limitLabel, monthsFree, PRICED_PLANS, usd, type Plan } from "@/lib/plans";
import { cn } from "@/lib/utils";

type Period = "monthly" | "yearly";

function Price({ plan, period }: { plan: Plan; period: Period }) {
  const amount = (period === "monthly" ? plan.monthlyUsd : plan.yearlyUsd) ?? 0;
  const saved = monthsFree(plan);
  return (
    <div className="mt-4">
      <p className="flex items-baseline gap-1.5">
        <b className="type-stat text-fg text-[40px] tabular-nums">{usd(amount)}</b>
        <span className="text-fg-muted text-[13.5px]">
          {amount === 0 ? "forever" : period === "monthly" ? "per month" : "per year"}
        </span>
      </p>
      <p className="text-fg-muted mt-1 min-h-[18px] text-[12.5px]">
        {amount > 0 && period === "yearly" && saved > 0 && `${saved} months free`}
        {amount > 0 &&
          period === "monthly" &&
          plan.yearlyUsd !== null &&
          `or ${usd(plan.yearlyUsd)} per year`}
      </p>
    </div>
  );
}

/**
 * Paid plans link to Settings -> Billing with the plan picked: an owner lands on the checkout,
 * a member on "ask an owner", a visitor without a session on sign-up (the page redirects).
 */
function ctaFor(plan: Plan, period: Period, billing: boolean): { href: string; label: string } {
  if (plan.id === "free") return { href: "/login?mode=sign-up", label: "Create an account" };
  if (!billing) return { href: "/login?mode=sign-up", label: "Start free, upgrade later" };
  const interval = period === "monthly" ? "month" : "year";
  return {
    href: `/settings/billing?plan=${plan.id}&interval=${interval}`,
    label: `Get ${plan.name}`,
  };
}

/** The three sold plans with a monthly/yearly switch; every number comes from PLANS. */
export function PricingCards({ billing = false }: { billing?: boolean }) {
  const [period, setPeriod] = useState<Period>("monthly");
  return (
    <>
      <div className="rise mb-5 flex justify-center [--i:2]">
        <Segmented
          label="Billing period"
          value={period}
          onChange={setPeriod}
          options={[
            { value: "monthly", label: "Monthly" },
            { value: "yearly", label: "Yearly" },
          ]}
        />
      </div>
      <ul className="grid gap-3 min-[980px]:grid-cols-3">
        {PRICED_PLANS.map((plan, i) => (
          <li
            key={plan.id}
            style={{ "--i": i + 3 } as CSSProperties}
            className="rise bg-surface border-line rounded-card flex flex-col border p-[18px] max-[560px]:p-[15px]"
          >
            <h2 className="type-h3">{plan.name}</h2>
            <p className="text-fg-muted mt-1 text-[13.5px] min-[980px]:min-h-[40px]">
              {plan.pitch}
            </p>
            <Price plan={plan} period={period} />
            <ul className="border-line mt-4 grid gap-2 border-t pt-4 text-[14px]">
              {[
                limitLabel(plan.repos, "repo"),
                limitLabel(plan.streams, "stream"),
                limitLabel(plan.members, "member"),
              ].map((line) => (
                <li key={line} className="flex items-center gap-2">
                  <Check aria-hidden className="text-ok size-4 shrink-0" />
                  {line}
                </li>
              ))}
            </ul>
            {plan.planned.length > 0 && (
              <p className="text-fg-muted mt-3 text-[12.5px]">
                Planned for {plan.name}: {plan.planned.join(" · ")}
              </p>
            )}
            <div className="mt-auto pt-5">
              <Link
                href={ctaFor(plan, period, billing).href}
                className={cn(
                  buttonVariants({ variant: plan.id === "free" ? "primary" : "secondary" }),
                  "w-full"
                )}
              >
                {ctaFor(plan, period, billing).label}
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
