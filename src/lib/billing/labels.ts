// Short status words for a stored subscription (Admin table, billing page). Pure.

import type { ScheduledChange } from "./state";

function scheduledOf(value: unknown): ScheduledChange | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  return typeof v.action === "string" && typeof v.effectiveAt === "string"
    ? (v as unknown as ScheduledChange)
    : null;
}

/** "active", "past due", "cancels 2026-12-01", "canceled". */
export function subscriptionLabel(sub: { status: string; scheduledChange: unknown }): string {
  const change = scheduledOf(sub.scheduledChange);
  if (change && sub.status !== "canceled") {
    const day = change.effectiveAt.slice(0, 10);
    if (change.action === "cancel") return `cancels ${day}`;
    if (change.action === "pause") return `pauses ${day}`;
  }
  return sub.status.replace("_", " ");
}

export { scheduledOf };
