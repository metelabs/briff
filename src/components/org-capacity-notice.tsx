import Link from "next/link";

import type { OrgCapacity } from "@/lib/org-capacity";
import { atLimit, nextPlan, PLANS } from "@/lib/plans";
import { cn } from "@/lib/utils";

function Usage({
  used,
  limit,
  noun,
  flag = true,
}: {
  used: number;
  limit: number | null;
  noun: string;
  /** Mark a reached limit; off for seats, which a one-person Free org always fills. */
  flag?: boolean;
}) {
  const full = flag && atLimit(used, limit);
  const label = `${noun}${(limit ?? used) === 1 ? "" : "s"}`;
  return (
    <span className={cn("tabular-nums", full && "text-upgrade font-medium")}>
      {limit === null ? `${used} ${label}` : `${used} / ${limit} ${label}`}
    </span>
  );
}

/** Settings and onboarding: "8 / 10 repos · 1 / 2 streams · 1 / 1 member · Free plan". */
export function OrgCapacityNotice({ capacity }: { capacity: OrgCapacity }) {
  if (!capacity.cloud) return null;
  const upgrade = nextPlan(capacity.plan);
  const full =
    atLimit(capacity.repos, capacity.repoLimit) || atLimit(capacity.streams, capacity.streamLimit);
  return (
    <aside
      aria-label="Plan and limits"
      className="bg-surface border-line rounded-card mb-5 border px-4 py-3 text-[13.5px]"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <p>
          <Usage used={capacity.repos} limit={capacity.repoLimit} noun="repo" />
          {" · "}
          <Usage used={capacity.streams} limit={capacity.streamLimit} noun="stream" />
          {" · "}
          <Usage used={capacity.members} limit={capacity.memberLimit} noun="member" flag={false} />
          {" · "}
          <span className="font-medium">{PLANS[capacity.plan].name} plan</span>
        </p>
        <p className="flex items-center gap-4">
          <Link href="/pricing" className="text-brand underline-offset-4 hover:underline">
            Compare plans
          </Link>
          {upgrade && (
            <Link
              href="/settings/billing"
              className="text-brand font-medium underline-offset-4 hover:underline"
            >
              Upgrade
            </Link>
          )}
        </p>
      </div>
      {full && (
        <p className="text-fg-muted mt-1.5 text-[12.5px]">
          At the limit, new repos and streams are refused; nothing you have is deleted.
        </p>
      )}
    </aside>
  );
}
