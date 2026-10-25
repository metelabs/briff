import { cn } from "@/lib/utils";

/**
 * Small neutral tag naming a package's ecosystem (`npm`, `Composer`), shown only where two
 * ecosystems sit side by side. Case as written: ecosystem names are proper names, not labels.
 */
export function EcosystemTag({ children, className }: { children: string; className?: string }) {
  return (
    <span
      className={cn(
        "rounded-label border-line text-fg-muted inline-flex items-center border px-1.5 py-px font-sans text-[10.5px] leading-[1.3] font-medium whitespace-nowrap normal-case",
        className
      )}
    >
      {children}
    </span>
  );
}
