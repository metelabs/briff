"use client";

import { Check, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { AlertRow } from "@/components/alerts/alert-row";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CommandBox } from "@/components/ui/command-box";
import { DialogClose, FormDialog } from "@/components/ui/dialog";
import { EcosystemTag } from "@/components/ui/ecosystem-tag";
import { FilterChips } from "@/components/ui/filter-chips";
import { SearchField } from "@/components/ui/search-field";
import { severityKind, Tag } from "@/components/ui/tag";
import { useToast } from "@/components/ui/toast";
import { TruncatedText } from "@/components/ui/tooltip";
import { plural, shortDateTime } from "@/lib/format";
import { SCROLL_GAP, scrollToElement, stickyOffset } from "@/lib/scroll";
import { cn } from "@/lib/utils";
import type { AlertPackageGroup } from "@/pipeline/alert-groups";
import {
  fixHintFor,
  type FixedPackage,
  type RepoConnection,
  type ResolvedPackage,
} from "@/pipeline/alert-sections";
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
  connections,
  scanCommand,
}: {
  groups: AlertPackageGroup[];
  filters?: boolean;
  initialLimit?: number;
  review?: boolean;
  /** Repo name -> how its scans arrive; gives each package its "how this resolves" line. */
  connections?: Record<string, RepoConnection[]>;
  scanCommand?: string;
}) {
  const connectionsOf = useMemo(
    () => new Map(Object.entries(connections ?? {}).map(([name, kinds]) => [name, new Set(kinds)])),
    [connections]
  );
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
          <AlertRow
            key={`${g.ecosystem ?? "npm"}:${g.packageName}`}
            group={g}
            hint={connections ? fixHintFor(g.repos, connectionsOf) : null}
            scanCommand={scanCommand}
            action={review ? <MarkPackageReviewed packageName={g.packageName} /> : null}
          />
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

/**
 * Sticky section bar under the page header: section names with their package counts, a
 * click scrolls to the section (deep links like #earlier work without it), and the
 * section crossing the line below the sticky bars is marked current.
 */
export function AlertSectionNav({
  sections,
}: {
  sections: { id: string; label: string; count: number }[];
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
              // The Resolved section is a collapsed <details>: its pill opens it.
              if (el instanceof HTMLDetailsElement) el.open = true;
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

/** Alerts → Resolved: packages a later scan resolved in the window, with what resolved them. */
export function ResolvedList({ packages }: { packages: ResolvedPackage[] }) {
  if (packages.length === 0) {
    return (
      <Card className="text-fg-muted px-[18px] py-5">Nothing resolved in the last 30 days.</Card>
    );
  }
  return (
    <div className="bg-surface border-line rounded-card overflow-hidden border">
      {packages.map((p) => (
        <div
          key={`${p.ecosystem ?? "npm"}:${p.packageName}`}
          className="border-line grid items-start gap-x-4 gap-y-1.5 border-t px-[18px] py-3 first:border-t-0 md:grid-cols-[190px_minmax(0,1fr)_auto]"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <TruncatedText as="b" className="max-w-full font-mono text-[14px] font-medium">
              {p.packageName}
            </TruncatedText>
            {p.ecosystem && <EcosystemTag>{ecosystemLabel(p.ecosystem)}</EcosystemTag>}
          </div>
          <div className="grid min-w-0 gap-0.5">
            <span className="text-fg-muted font-mono text-[12px] break-all">
              {p.repos.join(", ")}
            </span>
            <span className="text-fg-muted text-[12.5px]">
              {shortDateTime(p.resolvedAt)} · {p.causes.join(", ")}
            </span>
          </div>
          <div className="flex md:justify-end">
            <Tag kind={severityKind(p.severity === "UNKNOWN" ? null : p.severity)}>
              {p.severity.toLowerCase()}
            </Tag>
          </div>
        </div>
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
 * "Re-check now" opens a dialog that says what a re-check does for each kind of repo the
 * org has, then queues it: GitHub App rescans plus a security-scan of the org (OSV asked
 * again about every stored version). "Checking…" lasts until both are done, then the
 * page reloads. briff-scan repos cannot be read from the server; the dialog gives their
 * upload command.
 */
export function RecheckButton({
  githubRepos,
  scannerRepos,
  lastUpload,
  initialChecking,
  command,
  docsUrl,
}: {
  githubRepos: number;
  scannerRepos: number;
  /** "3h ago": the newest briff-scan upload among the scanner repos. */
  lastUpload: string | null;
  initialChecking: boolean;
  command: string;
  docsUrl: string;
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

  const busy = checking || pending;
  const one = (n: number, single: string, many: string) => (n === 1 ? single : many);
  const recheck = () => {
    start(async () => {
      const res = await recheckAction();
      if (res.message) toast(res.message, res.ok ? "ok" : "info");
      setChecking(res.checking);
      if (res.checking) setOpen(false);
    });
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="secondary" disabled={busy}>
          <RefreshCw className="size-4" strokeWidth={1.8} aria-hidden />
          {busy ? "Checking…" : "Re-check now"}
        </Button>
      }
      title="Re-check your repos"
    >
      <div className="grid gap-3 text-[13.5px]">
        {githubRepos > 0 && (
          <p>
            <b className="font-medium">{plural(githubRepos, "repo")} via GitHub App:</b> Briff
            rescans {one(githubRepos, "it", "them")} now and re-queries advisories; results update
            here within a minute.
          </p>
        )}
        {scannerRepos > 0 && (
          <div className="grid gap-2">
            <p>
              <b className="font-medium">{plural(scannerRepos, "repo")} via briff-scan:</b> Briff
              cannot read {one(scannerRepos, "it", "them")} from the server.
              {githubRepos === 0 &&
                ` Re-check now asks the advisory database again about the versions ${one(scannerRepos, "it", "they")} last uploaded, so new advisories show up and fixed ones drop.`}{" "}
              Run this in {one(scannerRepos, "the repo", "each repo")} to upload now:
            </p>
            <CommandBox command={command} />
            <p className="text-fg-muted text-[12.5px]">
              {one(scannerRepos, "It also uploads", "They also upload")} nightly from your scanner
              {lastUpload ? ` (last upload ${lastUpload})` : ""}. Use a scan token from Settings.{" "}
              <a
                href={docsUrl}
                target="_blank"
                rel="noreferrer"
                className="text-brand font-medium underline-offset-4 hover:underline"
              >
                How scanning works
              </a>
            </p>
          </div>
        )}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <DialogClose render={<Button variant="secondary">Close</Button>} />
        <Button variant="primary" disabled={busy} onClick={recheck}>
          <RefreshCw className="size-4" strokeWidth={1.8} aria-hidden />
          {busy ? "Checking…" : "Re-check now"}
        </Button>
      </div>
    </FormDialog>
  );
}
