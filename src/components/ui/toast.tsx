"use client";

import { Toast } from "@base-ui/react/toast";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { useCallback, useEffect, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import type { ToastKind } from "./toast-kind";
import { type ActionResult, resultToast } from "./toast-result";

export type { ToastKind };

export const TOAST_TIMEOUT = 5000;

const KINDS: Record<ToastKind, { box: string; icon: string }> = {
  ok: { box: "bg-ok-soft border-ok/30", icon: "text-ok" },
  info: { box: "bg-surface border-line", icon: "text-brand" },
  // Errors use the upgrade colour, never coral (DESIGN.md §3: coral means security).
  error: { box: "bg-upgrade-soft border-upgrade/30", icon: "text-upgrade" },
};

function kindOf(type: string | undefined): ToastKind {
  return type === "info" || type === "error" ? type : "ok";
}

// DESIGN.md §8 Toast: one at a time, top-centre on phones, bottom-right from 768px, 5s.
export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <Toast.Provider limit={1} timeout={TOAST_TIMEOUT}>
      {children}
      <Toast.Portal>
        <Toast.Viewport className="fixed top-[max(12px,env(safe-area-inset-top))] left-1/2 z-60 w-[min(380px,calc(100vw-32px))] -translate-x-1/2 md:top-auto md:right-6 md:bottom-6 md:left-auto md:translate-x-0">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}

function ToastList() {
  const { toasts } = Toast.useToastManager();
  return toasts.map((toast) => {
    const kind = kindOf(toast.type);
    const Icon = kind === "error" ? CircleAlert : kind === "info" ? Info : CircleCheck;
    return (
      <Toast.Root
        key={toast.id}
        toast={toast}
        className={cn(
          "text-fg shadow-raised absolute top-0 right-0 left-0 rounded-[12px] border transition-[opacity,transform] duration-200 ease-out data-ending-style:opacity-0 data-limited:opacity-0 data-starting-style:opacity-0 max-md:data-ending-style:-translate-y-2 max-md:data-starting-style:-translate-y-2 md:top-auto md:bottom-0 md:data-ending-style:translate-y-2 md:data-starting-style:translate-y-2",
          KINDS[kind].box
        )}
      >
        <Toast.Content className="flex items-start gap-2.5 py-3 pr-2.5 pl-3.5 text-[13.5px] leading-[1.45]">
          <Icon className={cn("mt-px size-[18px] shrink-0", KINDS[kind].icon)} aria-hidden />
          <Toast.Description className="min-w-0 flex-1 [overflow-wrap:anywhere]" />
          <Toast.Close
            aria-label="Dismiss"
            className="text-fg-muted hover:text-fg -my-1 grid size-7 shrink-0 place-items-center rounded-[8px] transition-colors duration-150"
          >
            <X className="size-4" aria-hidden />
          </Toast.Close>
        </Toast.Content>
      </Toast.Root>
    );
  });
}

/** `toast("Copied to clipboard")`; errors are announced assertively, the rest politely. */
export function useToast(): (message: string, kind?: ToastKind) => void {
  const manager = Toast.useToastManager();
  return useCallback(
    (message: string, kind: ToastKind = "ok") => {
      manager.add({
        description: message,
        type: kind,
        priority: kind === "error" ? "high" : "low",
      });
    },
    [manager]
  );
}

/** Toasts a Server Action's result once per returned state (`resultToast`). */
export function useResultToast(state: object, result: ActionResult | null): void {
  const toast = useToast();
  const shown = useRef<object | null>(null);
  useEffect(() => {
    const next = resultToast(state, shown.current, result);
    if (!next) return;
    shown.current = state;
    toast(next.message, next.kind);
  }, [state, result, toast]);
}
