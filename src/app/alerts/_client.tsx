"use client";

import { useActionState, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/command-box";
import { EcosystemTag } from "@/components/ui/ecosystem-tag";
import { FilterChips } from "@/components/ui/filter-chips";
import { SearchField } from "@/components/ui/search-field";
import { severityKind, Tag } from "@/components/ui/tag";
import { useToast } from "@/components/ui/toast";
import { Tooltip, TruncatedText } from "@/components/ui/tooltip";
import { UpgradeList } from "@/components/ui/upgrade-list";
import { plural } from "@/lib/format";
import type { AlertPackageGroup } from "@/pipeline/alert-groups";
import { ecosystemLabel } from "@scan/ecosystems";

import { markBacklogReviewedAction, markPackageReviewedAction, type ReviewState } from "./actions";

const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MODERATE", "LOW", "UNKNOWN"];
const SEVERITY_NAME: Record<string, string> = {
  CRITICAL: "Critical",
  HIGH: "High",
  MODERATE: "Moderate",
  LOW: "Low",
  UNKNOWN: "Unknown",
};
const OSV = "https://osv.dev/vulnerability/";

function matches(group: AlertPackageGroup, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    group.packageName.toLowerCase().includes(q) ||
    group.repos.some((r) => r.toLowerCase().includes(q))
  );
}

const INITIAL: ReviewState = { ok: true, message: null };

/** A review action's form state; the result is shown as a toast. */
function useReviewAction(
  action: (prev: ReviewState, form: FormData) => Promise<ReviewState>
): [ReviewState, (form: FormData) => void, boolean] {
  const toast = useToast();
  return useActionState(async (prev: ReviewState, form: FormData) => {
    const res = await action(prev, form);
    if (res.message) toast(res.message, res.ok ? "ok" : "info");
    return res;
  }, INITIAL);
}

/** "Mark backlog as reviewed": every unreviewed first-scan backlog alert of the org. */
export function MarkBacklogReviewed() {
  const [, action, pending] = useReviewAction(markBacklogReviewedAction);
  return (
    <form action={action}>
      <Button
        type="submit"
        size="sm"
        disabled={pending}
        title="Hides the first-scan backlog of every stream from this page and the home counts"
      >
        {pending ? "Marking…" : "Mark backlog as reviewed"}
      </Button>
    </form>
  );
}

function MarkPackageReviewed({ packageName }: { packageName: string }) {
  const [, action, pending] = useReviewAction(markPackageReviewedAction);
  return (
    <form action={action}>
      <input type="hidden" name="packageName" value={packageName} />
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        {pending ? "Marking…" : "Mark reviewed"}
      </Button>
    </form>
  );
}

/**
 * Package rows; with `filters`, severity chips and a search over packages and repos; with
 * `review`, a "Mark reviewed" button per package (first-scan backlog only).
 */
export function AlertList({
  groups,
  filters = false,
  initialLimit,
  review = false,
}: {
  groups: AlertPackageGroup[];
  filters?: boolean;
  initialLimit?: number;
  review?: boolean;
}) {
  const [severity, setSeverity] = useState("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);

  const options = useMemo(() => {
    const totals = new Map<string, number>();
    for (const g of groups)
      for (const [label, n] of g.severities) totals.set(label, (totals.get(label) ?? 0) + n);
    const all = [...totals.values()].reduce((a, b) => a + b, 0);
    return [
      { value: "all", label: "All", count: all },
      ...SEVERITY_ORDER.filter((s) => totals.has(s)).map((s) => ({
        value: s,
        label: SEVERITY_NAME[s],
        count: totals.get(s) ?? 0,
      })),
    ];
  }, [groups]);

  const visible = groups.filter(
    (g) => (severity === "all" || g.severities.some(([s]) => s === severity)) && matches(g, query)
  );
  const limit = expanded || !initialLimit || query ? visible.length : initialLimit;
  const shown = visible.slice(0, limit);

  return (
    <>
      {filters && (
        <div className="mb-3.5 flex flex-wrap items-center gap-2">
          <FilterChips label="Severity" options={options} value={severity} onChange={setSeverity} />
          <SearchField
            className="ml-auto"
            value={query}
            onChange={setQuery}
            placeholder="Filter packages or repos"
            label="Filter packages or repos"
          />
        </div>
      )}
      <div className="bg-surface border-line rounded-card overflow-hidden border">
        {shown.length === 0 && <p className="text-fg-muted px-[18px] py-5">No package matches.</p>}
        {shown.map((g) => (
          <AlertRow key={`${g.ecosystem ?? "npm"}:${g.packageName}`} group={g} review={review} />
        ))}
        {visible.length > shown.length && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="border-line text-brand hover:bg-surface-2 block w-full border-t p-[13px] font-medium transition-colors"
          >
            Show {plural(visible.length - shown.length, "more package", "more packages")}
          </button>
        )}
      </div>
    </>
  );
}

function AlertRow({ group: g, review }: { group: AlertPackageGroup; review: boolean }) {
  const ids = g.advisories.slice(0, 3);
  return (
    <div className="border-line grid items-start gap-x-4 gap-y-2.5 border-t px-[18px] py-3.5 first:border-t-0 md:grid-cols-[190px_minmax(0,1fr)_auto]">
      <div className="flex min-w-0 flex-col items-start gap-1.5">
        <TruncatedText as="b" className="max-w-full font-mono text-[14.5px] font-medium">
          {g.packageName}
        </TruncatedText>
        <div className="flex flex-wrap items-center gap-1.5">
          <Tag kind={g.direct ? "direct" : "transitive"}>{g.direct ? "Direct" : "Transitive"}</Tag>
          {g.ecosystem && <EcosystemTag>{ecosystemLabel(g.ecosystem)}</EcosystemTag>}
        </div>
      </div>
      <div className="grid min-w-0 gap-1.5">
        {g.fixes.length === 0 && (
          <p className="text-fg-muted text-[13px]">
            The installed versions are already past the fix.
          </p>
        )}
        {g.fixes.map((f, i) => (
          <div key={i} className="grid gap-1 text-[13px]">
            {(f.text || f.command) && (
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                {f.text && <span>{f.text}</span>}
                {f.command && (
                  <span className="bg-surface-2 border-line inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-[6px] border py-0.5 pr-0.5 pl-[7px]">
                    <code className="no-scrollbar min-w-0 overflow-x-auto font-mono text-[12px] whitespace-nowrap">
                      {f.command}
                    </code>
                    <CopyButton text={f.command} className="px-2 py-0.5 text-[11.5px]" />
                  </span>
                )}
              </span>
            )}
            <UpgradeList upgrades={f.installs} className="text-[12px]" />
          </div>
        ))}
        <span className="text-fg-muted font-mono text-[11.5px]">
          {ids.map((a, i) => (
            <span key={a.osvId}>
              {i > 0 && ", "}
              <Tooltip content={a.summary} disabled={!a.summary}>
                <a
                  href={OSV + encodeURIComponent(a.osvId)}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-fg underline-offset-2 hover:underline"
                >
                  {a.osvId}
                </a>
              </Tooltip>
              {a.aliases.length > 0 && ` (also ${a.aliases.join(", ")})`}
            </span>
          ))}
          {g.advisories.length > ids.length && ` +${g.advisories.length - ids.length} more`}
        </span>
      </div>
      <div className="flex flex-col items-start gap-2 md:items-end">
        <div className="flex flex-wrap gap-1 md:justify-end">
          {g.severities.map(([label, n]) => (
            <Tag key={label} kind={severityKind(label === "UNKNOWN" ? null : label)}>
              {`${n} ${label.toLowerCase()}`}
            </Tag>
          ))}
        </div>
        {review && <MarkPackageReviewed packageName={g.packageName} />}
      </div>
    </div>
  );
}
