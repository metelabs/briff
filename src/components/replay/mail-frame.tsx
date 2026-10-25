"use client";

import { useCallback, useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

/**
 * An email as the recipient sees it: its own HTML in a sandboxed frame (no scripts), under a
 * From / Subject head. The frame takes the height of its content, so it never scrolls.
 */
export function MailFrame({
  subject,
  html,
  className,
}: {
  subject: string;
  html: string;
  className?: string;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const fit = useCallback(() => {
    const frame = ref.current;
    const doc = frame?.contentDocument;
    if (!frame || !doc?.body) return;
    // The body's own box, not the document's scroll height: the document is never shorter
    // than its frame, so that could only ever grow (a wide layout, then a narrow one).
    const height = Math.ceil(doc.body.getBoundingClientRect().height);
    frame.style.height = `${height + 2}px`;
  }, []);

  // The frame can finish loading before hydration (onLoad is then missed), and its images
  // load later: listen for load ourselves and refit whenever the email's body changes size.
  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let observer: ResizeObserver | null = null;
    const watch = () => {
      fit();
      const body = frame.contentDocument?.body;
      if (!body) return;
      observer?.disconnect();
      observer = new ResizeObserver(fit);
      observer.observe(body);
    };
    if (frame.contentDocument?.readyState === "complete") watch();
    frame.addEventListener("load", watch);
    window.addEventListener("resize", fit);
    return () => {
      frame.removeEventListener("load", watch);
      window.removeEventListener("resize", fit);
      observer?.disconnect();
    };
  }, [fit]);

  return (
    <div className={cn("border-line overflow-hidden rounded-[12px] border", className)}>
      <div className="bg-surface-2 border-line grid gap-0.5 border-b px-3.5 py-2.5 text-[13px] [overflow-wrap:anywhere]">
        <div>
          <span className="text-fg-muted inline-block w-16">From</span>Briff
        </div>
        <div>
          <span className="text-fg-muted inline-block w-16">Subject</span>
          <strong className="font-semibold">{subject}</strong>
        </div>
      </div>
      <iframe
        ref={ref}
        title={subject}
        srcDoc={html}
        sandbox="allow-same-origin allow-popups"
        loading="lazy"
        className="block h-[560px] w-full border-0"
      />
    </div>
  );
}
