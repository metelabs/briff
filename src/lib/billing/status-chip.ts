// The status chip on the billing page and Settings -> Billing. Pure, unit-tested.

import type { TagKind } from "@/components/ui/tag";

/** A cancel that ends within this many days reads "Ends soon"; a later one just "Canceled". */
export const ENDS_SOON_DAYS = 30;
const DAY_MS = 86_400_000;

export interface ChipInput {
  status: string;
  /** When the plan ends: a scheduled cancel's effective date, or a canceled row's period end. */
  endsAt: Date | null;
  /** past_due: when the grace period ends (`graceEndsAt`). */
  graceEndsAt: Date | null;
}

export interface StatusChip {
  kind: TagKind;
  label: string;
}

/** Whole days from `now` to `at`, rounded up: 1.2 days left is "2 days left". */
export function daysUntil(at: Date, now: Date): number {
  return Math.ceil((at.getTime() - now.getTime()) / DAY_MS);
}

function daysLeft(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"} left`;
}

/**
 * Canceled (muted) while the end is more than 30 days away, Ends soon (warning) within 30 days,
 * Ended after it; past_due counts down its grace period.
 */
export function statusChip(input: ChipInput, now: Date): StatusChip | null {
  if (input.endsAt || input.status === "canceled") {
    if (!input.endsAt || input.endsAt.getTime() <= now.getTime()) {
      return { kind: "wait", label: "Ended" };
    }
    return daysUntil(input.endsAt, now) <= ENDS_SOON_DAYS
      ? { kind: "upgrade", label: "Ends soon" }
      : { kind: "wait", label: "Canceled" };
  }
  switch (input.status) {
    case "active":
      return { kind: "ok", label: "Active" };
    case "trialing":
      return { kind: "ok", label: "Trial" };
    case "paused":
      return { kind: "wait", label: "Paused" };
    case "past_due": {
      if (!input.graceEndsAt) return { kind: "upgrade", label: "Payment failed" };
      const days = daysUntil(input.graceEndsAt, now);
      return days > 0
        ? { kind: "upgrade", label: `Payment failed · ${daysLeft(days)}` }
        : { kind: "upgrade", label: "Payment failed · plan ended" };
    }
    default:
      return null;
  }
}
