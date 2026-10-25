"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { ReactElement, ReactNode } from "react";

import { cn } from "@/lib/utils";

import { Button } from "./button";

// DESIGN.md §8 Dialog: surface, radius 16, max 440px, scrim; 180ms in, 120ms out.
const backdropClass =
  "bg-scrim fixed inset-0 z-70 transition-opacity duration-[180ms] ease-out data-ending-style:opacity-0 data-ending-style:duration-[120ms] data-starting-style:opacity-0";
const popupClass =
  "bg-surface border-line shadow-raised fixed top-1/2 left-1/2 z-70 w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-card border p-5 transition-[opacity,scale] duration-[180ms] ease-out data-ending-style:scale-[.98] data-ending-style:opacity-0 data-ending-style:duration-[120ms] data-starting-style:scale-[.98] data-starting-style:opacity-0";

/** Confirm before a destructive step; the confirm button is the only filled coral one. */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  onConfirm,
  pending = false,
}: {
  trigger: ReactElement;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  pending?: boolean;
}) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger render={trigger} />
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={backdropClass} />
        <AlertDialog.Popup className={popupClass}>
          <AlertDialog.Title className="type-h2 mb-1.5">{title}</AlertDialog.Title>
          <AlertDialog.Description className="text-fg-muted mb-4">
            {description}
          </AlertDialog.Description>
          <div className="flex flex-wrap justify-end gap-2">
            <AlertDialog.Close render={<Button variant="secondary">Cancel</Button>} />
            <AlertDialog.Close
              render={
                <Button variant="danger-solid" disabled={pending} onClick={onConfirm}>
                  {confirmLabel}
                </Button>
              }
            />
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

/** A form dialog (New stream). Controlled, so the caller can close it after its action. */
export function FormDialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactElement;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Trigger render={trigger} />
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className={backdropClass} />
        <DialogPrimitive.Popup className={cn(popupClass, className)}>
          <DialogPrimitive.Title className="type-h2 mb-1.5">{title}</DialogPrimitive.Title>
          {description && (
            <DialogPrimitive.Description className="text-fg-muted mb-4">
              {description}
            </DialogPrimitive.Description>
          )}
          {children}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export const DialogClose = DialogPrimitive.Close;
