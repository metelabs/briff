"use client";

import { Check, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { CommandBox, CopyButton } from "@/components/ui/command-box";
import { DialogClose, FormDialog } from "@/components/ui/dialog";
import { EcosystemTag } from "@/components/ui/ecosystem-tag";
import { FilterChips } from "@/components/ui/filter-chips";
import { SearchField } from "@/components/ui/search-field";
import { severityKind, Tag } from "@/components/ui/tag";
import { useToast } from "@/components/ui/toast";
import { Tooltip, TruncatedText } from "@/components/ui/tooltip";
import { UpgradeList } from "@/components/ui/upgrade-list";
import { plural } from "@/lib/format";
import { SCROLL_GAP, scrollToElement, stickyOffset } from "@/lib/scroll";
import { cn } from "@/lib/utils";
import type { AlertPackageGroup } from "@/pipeline/alert-groups";
import type { AlertSection, FixedPackage } from "@/pipeline/alert-sections";
import { ecosystemLabel } from "@scan/ecosystems";

import {
  markBacklogReviewedAction,
  markPackageReviewedAction,
  recheckAction,
  recheckStatusAction,
  type ReviewState,
} from "./actions";

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
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        <Check className="size-3.5" strokeWidth={2} aria-hidden />
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

/**
 * Sticky section bar under the page header: section names with their package counts, a
 * click scrolls to the section (deep links like #earlier work without it), and the
 * section crossing the line below the sticky bars is marked current.
 */
export function AlertSectionNav({
  sections,
}: {
  sections: { id: AlertSection; label: string; count: number }[];
}) {
  const [current, setCurrent] = useState<string>(sections[0]?.id ?? "");
  const navRef = useRef<HTMLElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  // While a click's smooth scroll runs, the clicked section stays current.
  const scrolling = useRef(false);
  const [viewport, setViewport] = useState(0);

  // Exposes the bar's height for the sections' scroll-margin (see SECTION_ANCHOR).
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() => {
      root.style.setProperty(
        "--section-nav-h",
        `${Math.round(nav.getBoundingClientRect().height)}px`
      );
      setViewport(window.innerHeight);
    });
    observer.observe(nav);
    const onResize = () => setViewport(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onResize);
      root.style.removeProperty("--section-nav-h");
    };
  }, []);

  useEffect(() => {
    if (viewport === 0) return;
    const elements = sections.flatMap((s) => {
      const el = document.getElementById(s.id);
      return el ? [el] : [];
    });
    if (elements.length === 0) return;
    const line = stickyOffset() + SCROLL_GAP + 24;
    // A one-pixel band at `line`: the section crossing it is the one being read.
    const crossing = new IntersectionObserver(
      (entries) => {
        if (scrolling.current) return;
        const hit = entries.find((e) => e.isIntersecting);
        if (hit) setCurrent(hit.target.id);
      },
      { rootMargin: `-${line}px 0px -${Math.max(0, viewport - line - 1)}px 0px` }
    );
    for (const el of elements) crossing.observe(el);
    // The last section of a page that cannot scroll further never reaches the line.
    const end = document.createElement("div");
    end.setAttribute("aria-hidden", "true");
    elements[elements.length - 1].after(end);
    const bottom = new IntersectionObserver((entries) => {
      if (scrolling.current || !entries[0]?.isIntersecting) return;
      if (window.scrollY > 0) setCurrent(elements[elements.length - 1].id);
    });
    bottom.observe(end);
    return () => {
      crossing.disconnect();
      bottom.disconnect();
      end.remove();
    };
  }, [sections, viewport]);

  // On mobile the strip scrolls inside itself; keep the current section's pill visible.
  useEffect(() => {
    const strip = stripRef.current;
    const pill = strip?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!strip || !pill || strip.scrollWidth <= strip.clientWidth) return;
    strip.scrollTo({ left: pill.offsetLeft - (strip.clientWidth - pill.offsetWidth) / 2 });
  }, [current]);

  return (
    <nav
      ref={navRef}
      data-sticky-top
      aria-label="Alert sections"
      className="bg-bar border-line sticky top-[var(--bar-h,64px)] z-20 -mx-1 -mb-4 border-b px-1 py-2 backdrop-blur-[12px]"
    >
      <div ref={stripRef} className="no-scrollbar relative flex gap-1 overflow-x-auto">
        {sections.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            aria-current={current === s.id ? "true" : undefined}
            onClick={(e) => {
              const el = document.getElementById(s.id);
              if (!el) return;
              e.preventDefault();
              setCurrent(s.id);
              window.history.replaceState(null, "", `#${s.id}`);
              scrolling.current = true;
              void scrollToElement(el).then(() => {
                scrolling.current = false;
              });
            }}
            className={cn(
              "text-fg-muted hover:bg-surface hover:text-fg flex min-h-9 shrink-0 items-center gap-2 rounded-full px-3.5 text-[13.5px] font-medium whitespace-nowrap transition-colors duration-150",
              "aria-[current=true]:bg-brand-soft aria-[current=true]:text-brand"
            )}
          >
            {s.label}
            <span className="tabular-nums opacity-80">{s.count}</span>
          </a>
        ))}
      </div>
    </nav>
  );
}

/** "Fixed since your last visit": packages a later scan no longer has at an affected version. */
export function FixedSinceVisit({ packages }: { packages: FixedPackage[] }) {
  if (packages.length === 0) return null;
  return (
    <div className="bg-ok-soft text-ok rounded-inset mb-3.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 px-3.5 py-2.5 text-[13px]">
      <span className="inline-flex items-center gap-1.5 font-semibold">
        <Check className="size-3.5 self-center" strokeWidth={2.2} aria-hidden />
        Fixed since your last visit
      </span>
      {packages.map((p, i) => (
        <span key={p.packageName}>
          <b className="font-mono font-medium">{p.packageName}</b>{" "}
          <span className="font-mono text-[12px]">({p.repos.join(", ")})</span>
          {i < packages.length - 1 && ","}
        </span>
      ))}
    </div>
  );
}

/** Header counter: alerts a scan resolved since Monday. */
export function ResolvedCounter({ count }: { count: number }) {
  return (
    <span
      className={cn(
        "border-line inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium tabular-nums",
        count > 0 ? "bg-ok-soft text-ok border-transparent" : "bg-surface text-fg-muted"
      )}
    >
      <Check className="size-3.5" strokeWidth={2.2} aria-hidden />
      Resolved: {count} this week
    </span>
  );
}

const POLL_MS = 4000;
const POLL_LIMIT_MS = 5 * 60_000;

/**
 * "Re-check now": GitHub App repos are rescanned by the worker (shows "Checking…" until the
 * job is done, then reloads the page); repos uploaded by briff-scan get the command instead.
 */
export function RecheckButton({
  githubRepos,
  scannerRepos,
  initialChecking,
  command,
}: {
  githubRepos: number;
  scannerRepos: number;
  initialChecking: boolean;
  command: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [checking, setChecking] = useState(initialChecking);
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!checking) return;
    const startedAt = Date.now();
    let stopped = false;
    const timer = window.setInterval(async () => {
      if (stopped) return;
      const timedOut = Date.now() - startedAt > POLL_LIMIT_MS;
      let done = false;
      try {
        if (!timedOut) done = !(await recheckStatusAction()).checking;
      } catch {
        // Offline or signed out: the next tick tries again.
      }
      if ((!done && !timedOut) || stopped) return;
      stopped = true;
      window.clearInterval(timer);
      setChecking(false);
      router.refresh();
      if (done) toast("Re-check done.");
      else toast("The re-check is still running. Reload this page in a few minutes.", "info");
    }, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [checking, router, toast]);

  const recheck = () => {
    if (githubRepos === 0) return;
    start(async () => {
      const res = await recheckAction();
      if (res.message) toast(res.message, res.ok ? "ok" : "info");
      setChecking(res.checking);
    });
  };

  const busy = checking || pending;
  const button = (
    <Button variant="secondary" disabled={busy} onClick={recheck}>
      <RefreshCw className="size-4" strokeWidth={1.8} aria-hidden />
      {busy ? "Checking…" : "Re-check now"}
    </Button>
  );
  if (scannerRepos === 0) return button;
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={button}
      title="Re-check your repos"
      description={
        githubRepos > 0
          ? `Briff is re-checking ${plural(githubRepos, "GitHub App repo")}; this page reloads when it is done. The other ${plural(scannerRepos, "repo")} upload their own scans, so Briff cannot re-check them from here.`
          : `${plural(scannerRepos, "repo")} upload their own scans with briff-scan, so Briff cannot re-check them from here.`
      }
    >
      <p className="mb-2 text-[13.5px]">After the fix, run the scanner in the repo:</p>
      <CommandBox command={command} />
      <p className="text-fg-muted mt-2.5 text-[12.5px]">
        Use your scan token from Settings. Repos scanned by the GitHub Action re-check on their next
        push to main. Fixed advisories leave this page with the next upload.
      </p>
      <div className="mt-4 flex justify-end">
        <DialogClose render={<Button variant="secondary">Close</Button>} />
      </div>
    </FormDialog>
  );
}
