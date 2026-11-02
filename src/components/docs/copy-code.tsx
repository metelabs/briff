"use client";

import { useEffect, useRef, useState } from "react";

import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/** Copy for a docs code block: "Copied" for 1.4s and a toast (DESIGN.md §8 Fix box). */
export function CopyCode({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const toast = useToast();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : "Copy code"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          toast("Copy failed; select the text instead.", "info");
          return;
        }
        setCopied(true);
        toast("Copied to clipboard");
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1400);
      }}
      className={cn(
        "relative shrink-0 rounded-[7px] px-[11px] py-[5px] text-[12.5px] font-semibold whitespace-nowrap transition-[filter,transform] duration-150 before:absolute before:-inset-1.5 before:content-[''] active:scale-[.96]",
        copied ? "bg-fg text-surface" : "bg-brand text-on-brand hover:brightness-[1.08]"
      )}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
