"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// The docs sidebar (from 980px) and the same list in a "Docs menu" sheet below that.

export interface DocsNavGroup {
  /** Already upper-cased with caps() on the server. */
  label: string;
  links: { href: string; title: string }[];
}

export function DocsSidebar({ groups, className }: { groups: DocsNavGroup[]; className?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Docs" className={cn("grid gap-6", className)}>
      {groups.map((group) => (
        <div key={group.label}>
          <p className="type-label text-fg-muted mb-2 px-2.5">{group.label}</p>
          <ul className="grid gap-0.5">
            {group.links.map((link) => {
              const current = pathname === link.href;
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "block rounded-[8px] px-2.5 py-[7px] text-[14px] leading-[1.35] transition-colors duration-150",
                      current
                        ? "bg-brand-soft text-brand font-medium"
                        : "text-fg-muted hover:bg-surface hover:text-fg"
                    )}
                  >
                    {link.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

const backdropClass =
  "bg-scrim fixed inset-0 z-70 transition-opacity duration-[180ms] ease-out data-ending-style:opacity-0 data-ending-style:duration-[120ms] data-starting-style:opacity-0";
const sheetClass =
  "bg-bg border-line shadow-raised fixed inset-y-0 left-0 z-70 flex w-[min(320px,calc(100vw-48px))] flex-col rounded-r-[16px] border-r outline-none transition-[opacity,translate] duration-[220ms] ease-out data-ending-style:-translate-x-6 data-ending-style:opacity-0 data-ending-style:duration-[140ms] data-starting-style:-translate-x-6 data-starting-style:opacity-0";

export function DocsMenu({ groups }: { groups: DocsNavGroup[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [seen, setSeen] = useState(pathname);
  if (seen !== pathname) {
    setSeen(pathname);
    setOpen(false);
  }
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 980px)");
    const close = () => wide.matches && setOpen(false);
    wide.addEventListener("change", close);
    return () => wide.removeEventListener("change", close);
  }, []);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        render={
          <Button variant="secondary" size="md">
            <Menu aria-hidden className="size-4" />
            Docs menu
          </Button>
        }
      />
      <Dialog.Portal>
        <Dialog.Backdrop className={backdropClass} />
        <Dialog.Popup className={sheetClass}>
          <div className="border-line flex items-center justify-between border-b px-4 py-3">
            <Dialog.Title className="type-h2">Docs</Dialog.Title>
            <Dialog.Close
              render={
                <Button variant="ghost" size="icon" aria-label="Close">
                  <X aria-hidden className="size-4" />
                </Button>
              }
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-4 pb-8">
            <DocsSidebar groups={groups} />
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
