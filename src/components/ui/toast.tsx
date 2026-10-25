"use client";

import { Toast } from "@base-ui/react/toast";
import { CircleCheck, Info } from "lucide-react";
import { useCallback, type ReactNode } from "react";

export type ToastKind = "ok" | "info";

// DESIGN.md §8 Toast: one at a time, bottom-centre (bottom-right from 768px), 2.5s.
export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <Toast.Provider limit={1} timeout={2500}>
      {children}
      <Toast.Portal>
        <Toast.Viewport className="fixed bottom-6 left-1/2 z-60 w-[min(360px,calc(100vw-32px))] -translate-x-1/2 md:right-6 md:left-auto md:translate-x-0">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}

function ToastList() {
  const { toasts } = Toast.useToastManager();
  return toasts.map((toast) => (
    <Toast.Root
      key={toast.id}
      toast={toast}
      className="border-line bg-surface text-fg shadow-raised absolute right-0 bottom-0 left-0 rounded-[12px] border transition-[opacity,transform] duration-200 ease-out data-ending-style:translate-y-2 data-ending-style:opacity-0 data-limited:opacity-0 data-starting-style:translate-y-2 data-starting-style:opacity-0"
    >
      <Toast.Content className="flex items-center gap-2.5 px-3.5 py-2.5 text-[13px]">
        {toast.type === "info" ? (
          <Info className="text-brand size-4 shrink-0" aria-hidden />
        ) : (
          <CircleCheck className="text-ok size-4 shrink-0" aria-hidden />
        )}
        <Toast.Description />
      </Toast.Content>
    </Toast.Root>
  ));
}

/** `toast("Copied to clipboard")`; announced politely by the viewport. */
export function useToast(): (message: string, kind?: ToastKind) => void {
  const manager = Toast.useToastManager();
  return useCallback(
    (message: string, kind: ToastKind = "ok") => {
      manager.add({ description: message, type: kind });
    },
    [manager]
  );
}
