import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** H2 + count badge + optional right-aligned action (DESIGN.md §8). */
export function SectionHeader({
  title,
  count,
  action,
  id,
  className,
}: {
  title: string;
  count?: ReactNode;
  action?: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <div className={cn("mb-2.5 flex items-center gap-2", className)}>
      <h2 id={id} className="type-h2 scroll-mt-[calc(var(--bar-h,64px)+12px)]">
        {title}
      </h2>
      {count !== undefined && <CountBadge>{count}</CountBadge>}
      {action && <div className="ml-auto text-[13px] font-medium">{action}</div>}
    </div>
  );
}

export function CountBadge({ children }: { children: ReactNode }) {
  return (
    <span className="bg-surface border-line text-fg-muted rounded-full border px-2 py-px font-sans text-[12px] font-medium tabular-nums">
      {children}
    </span>
  );
}

/** Page header: eyebrow, H1, one-line sub, actions on the right (DESIGN.md §2). */
export function PageHeader({
  eyebrow,
  title,
  sub,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="rise flex flex-wrap items-end justify-between gap-4 pt-7 pb-[22px]">
      <div className="min-w-0">
        {eyebrow && (
          <div className="text-fg-muted flex flex-wrap items-center gap-2 text-[13px]">
            {eyebrow}
          </div>
        )}
        <h1 className="type-page mt-2 mb-1.5">{title}</h1>
        {sub && <p className="text-fg-muted max-w-[60ch]">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

/** Centred empty state: line icon, title, one sentence, one action (DESIGN.md §8). */
export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="px-5 py-12 text-center">
      <div className="text-fg-subtle flex justify-center [&_svg]:size-10">{icon}</div>
      <h3 className="type-h2 mt-3 mb-1.5">{title}</h3>
      <p className="text-fg-muted mx-auto mb-[18px] max-w-[44ch]">{children}</p>
      {action}
    </div>
  );
}

export function WeekPill({ children }: { children: ReactNode }) {
  return (
    <span className="bg-brand-soft text-brand rounded-full px-2.5 py-[3px] font-mono text-[12px] font-semibold">
      {children}
    </span>
  );
}
