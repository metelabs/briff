import { caps } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type TagKind =
  | "security"
  | "critical"
  | "high"
  | "moderate"
  | "low"
  | "upgrade"
  | "read"
  | "wait"
  | "ok"
  | "eol"
  | "brand"
  | "direct"
  | "transitive";

const KIND_CLASS: Record<TagKind, string> = {
  security: "bg-sec-soft text-sec",
  critical: "bg-sec-soft text-sec",
  high: "bg-sec-soft text-sec",
  eol: "bg-sec-soft text-sec",
  moderate: "bg-upgrade-soft text-upgrade",
  upgrade: "bg-upgrade-soft text-upgrade",
  read: "bg-read-soft text-read",
  wait: "bg-wait-soft text-wait",
  low: "bg-wait-soft text-wait",
  transitive: "bg-wait-soft text-wait",
  ok: "bg-ok-soft text-ok",
  brand: "bg-brand-soft text-brand",
  direct: "bg-brand-soft text-brand",
};

const NO_DOT: ReadonlySet<TagKind> = new Set(["direct", "transitive"]);

/** Severity text (OSV) to a tag kind; unknown severity reads as high (same-day threshold). */
export function severityKind(severity: string | null): TagKind {
  switch ((severity ?? "").toUpperCase()) {
    case "CRITICAL":
      return "critical";
    case "MODERATE":
    case "MEDIUM":
      return "moderate";
    case "LOW":
      return "low";
    default:
      return "high";
  }
}

/** Label/tag (DESIGN.md §8): caps() text, a dot of currentColor, the soft tint of its kind. */
export function Tag({
  kind,
  children,
  className,
}: {
  kind: TagKind;
  children: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "type-label rounded-label inline-flex items-center gap-1.5 px-2 py-[3px] whitespace-nowrap",
        KIND_CLASS[kind],
        className
      )}
    >
      {!NO_DOT.has(kind) && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {caps(children)}
    </span>
  );
}
