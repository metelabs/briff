"use client";

import { useState, useTransition } from "react";

import { cn } from "@/lib/utils";

import { giveFeedbackAction } from "./actions";

type Kind = "up" | "down" | "less";

/** Feedback trio: exclusive pill toggles, saved through the session or the email token. */
export function FeedbackButtons({
  bulletinId,
  itemId,
  initial,
  token,
  labels,
  className,
}: {
  bulletinId: string;
  itemId: string;
  initial: Kind | null;
  token: string | null;
  labels: Record<Kind, string>;
  className?: string;
}) {
  const [kind, setKind] = useState<Kind | null>(initial);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <div role="group" aria-label="Feedback" className={cn("flex flex-wrap gap-1", className)}>
      {(["up", "down", "less"] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={kind === value}
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await giveFeedbackAction(bulletinId, itemId, value, token);
              setError(!res.ok);
              if (res.ok) setKind(res.kind);
            })
          }
          className="border-line text-fg-muted hover:border-line-strong hover:text-fg aria-pressed:border-brand aria-pressed:bg-brand-soft aria-pressed:text-brand relative rounded-full border px-2.5 py-1 text-[12px] transition-colors duration-150 before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[''] disabled:opacity-60"
        >
          {labels[value]}
        </button>
      ))}
      {error && (
        <span role="status" className="text-upgrade self-center text-[12px]">
          Could not save.
        </span>
      )}
    </div>
  );
}
