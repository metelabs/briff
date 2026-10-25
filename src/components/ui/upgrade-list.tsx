import { cn } from "@/lib/utils";
import { installedText, type RepoUpgrade } from "@/pipeline/upgrades";

/**
 * Installed -> recommended version, one line per repo (`bakery.example: next 15.2.3 → 16.3.8`).
 * `showRepo={false}` inside a card that already names the repo.
 */
export function UpgradeList({
  upgrades,
  showRepo = true,
  className,
}: {
  upgrades: readonly RepoUpgrade[];
  showRepo?: boolean;
  className?: string;
}) {
  if (upgrades.length === 0) return null;
  return (
    <ul className={cn("grid gap-0.5 font-mono text-[12.5px] leading-[1.45]", className)}>
      {upgrades.map((u, i) => (
        <li key={i} className="min-w-0 break-words">
          {showRepo && (
            <>
              <span className="font-medium">{u.repo}</span>
              <span className="text-fg-muted">{u.source ? " runs " : ": "}</span>
            </>
          )}
          <span className="text-fg-muted">{installedText(u)}</span>
          {u.target && (
            <>
              <span aria-hidden className="text-fg-muted">
                {" → "}
              </span>
              <span className="sr-only"> to </span>
              <span className="font-medium">{u.target}</span>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
