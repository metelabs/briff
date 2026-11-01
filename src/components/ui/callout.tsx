import { CircleAlert, CircleCheck } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { splitFirstSentence } from "./callout-text";

export type CalloutTone = "ok" | "warn";

const TONES: Record<CalloutTone, { box: string; icon: string }> = {
  ok: { box: "bg-ok-soft border-ok/30", icon: "text-ok" },
  // Failures use the upgrade colour, never coral (DESIGN.md §3: coral means security).
  warn: { box: "bg-upgrade-soft border-upgrade/30", icon: "text-upgrade" },
};

/**
 * A status message the user must not miss (DESIGN.md §8 Callout): tinted box, icon, the first
 * sentence bold. `children` adds a line under the message.
 */
export function Callout({
  tone,
  message,
  children,
  className,
}: {
  tone: CalloutTone;
  message: string;
  children?: ReactNode;
  className?: string;
}) {
  const { lead, rest } = splitFirstSentence(message);
  const Icon = tone === "ok" ? CircleCheck : CircleAlert;
  return (
    <div
      role={tone === "ok" ? "status" : "alert"}
      className={cn(
        "text-fg rounded-inset flex items-start gap-2.5 border px-3.5 py-3 text-[13.5px] leading-[1.45]",
        TONES[tone].box,
        className
      )}
    >
      <Icon aria-hidden className={cn("mt-px size-[18px] shrink-0", TONES[tone].icon)} />
      <div className="min-w-0 [overflow-wrap:anywhere]">
        <p>
          <strong className="font-semibold">{lead}</strong>
          {rest && ` ${rest}`}
        </p>
        {children && <div className="text-fg-muted mt-1">{children}</div>}
      </div>
    </div>
  );
}
