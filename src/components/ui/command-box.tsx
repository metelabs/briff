"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { useToast } from "./toast";

/** Copies text; the button says "Copied" for 1.4s and a toast confirms (DESIGN.md §8 Fix box). */
export function CopyButton({
  text,
  className,
  label = "Copy",
}: {
  text: string;
  className?: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const toast = useToast();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : `${label}: ${text}`}
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
        copied ? "bg-fg text-surface" : "bg-brand text-on-brand hover:brightness-[1.08]",
        className
      )}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

/** One command on one line (scrolls inside its box) with a Copy button. */
export function CommandBox({ command, className }: { command: string; className?: string }) {
  return (
    <div
      className={cn(
        "bg-code border-line flex min-w-0 items-center gap-2 rounded-[9px] border py-1.5 pr-1.5 pl-3",
        className
      )}
    >
      <code className="no-scrollbar min-w-0 flex-1 overflow-x-auto font-mono text-[13px] whitespace-nowrap">
        {command}
      </code>
      <CopyButton text={command} />
    </div>
  );
}

/** A multi-line file (a workflow) with its path and a Copy button for the whole text. */
export function CodeBlock({
  code,
  label,
  className,
}: {
  code: string;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("bg-code border-line min-w-0 rounded-[9px] border", className)}>
      <div className="border-line flex items-center justify-between gap-2 border-b py-1.5 pr-1.5 pl-3">
        <span className="text-fg-muted min-w-0 truncate font-mono text-[12px]">{label}</span>
        <CopyButton text={code} />
      </div>
      <pre className="no-scrollbar overflow-x-auto px-3 py-2.5 font-mono text-[12.5px] leading-[1.55]">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/**
 * A short per-repo step with a small Copy button (Alerts page style): a command in mono,
 * a sentence (`move Dockerfile to node:22.23.4-alpine`) in the body face.
 */
export function InlineCopy({
  text,
  command,
  className,
}: {
  text: string;
  command: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "bg-surface-2 border-line inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-[6px] border py-0.5 pr-0.5 pl-[7px]",
        className
      )}
    >
      {command ? (
        <code className="no-scrollbar min-w-0 overflow-x-auto font-mono text-[12px] whitespace-nowrap">
          {text}
        </code>
      ) : (
        <span className="min-w-0 text-[12.5px] leading-[1.4]">{text}</span>
      )}
      <CopyButton text={text} className="self-start px-2 py-0.5 text-[11.5px]" />
    </span>
  );
}
