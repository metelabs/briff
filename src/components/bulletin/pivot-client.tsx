"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from "react";

import { ChipButton } from "@/components/ui/chip";
import { Segmented } from "@/components/ui/segmented";
import { Tooltip, useIsTruncated } from "@/components/ui/tooltip";
import { prefersReducedMotion, scrollToElement } from "@/lib/scroll";
import { cn } from "@/lib/utils";
import { repoAnchor } from "@/pipeline/bulletin-by-repo";

import { FOLDED_ID, INITIAL_PIVOT, pivotReducer, type View } from "./pivot";

interface PivotApi {
  view: View;
  setView: (view: View) => void;
  /** Switch to "By repo" and bring that repo's card into view. */
  showRepo: (repo: string) => void;
  jumpTo: (id: string, view?: View) => void;
  foldedOpen: boolean;
  toggleFolded: () => void;
}

const PivotContext = createContext<PivotApi | null>(null);

function usePivot(): PivotApi {
  const api = useContext(PivotContext);
  if (!api) throw new Error("usePivot outside BulletinPivot");
  return api;
}

/** Holds the By item / By repo state (pivot.ts); both views are rendered on the server. */
export function BulletinPivot({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(pivotReducer, INITIAL_PIVOT);

  // Scroll once the target's view has rendered (it may have just mounted).
  useEffect(() => {
    const target = state.target;
    if (!target) return;
    const el = document.getElementById(target.id);
    if (el) {
      // Highlight once the smooth scroll has ended, so the reader sees it happen.
      void scrollToElement(el).then(() => {
        if (!target.flash) return;
        el.classList.remove("flash");
        void el.offsetWidth; // restart the animation
        el.classList.add("flash");
      });
    }
    dispatch({ type: "scrolled" });
  }, [state.target]);

  const api = useMemo<PivotApi>(
    () => ({
      view: state.view,
      foldedOpen: state.foldedOpen,
      setView: (view) => dispatch({ type: "view", view }),
      jumpTo: (id, view = "item") => dispatch({ type: "jump", id, view }),
      showRepo: (repo) => dispatch({ type: "repo", anchor: repoAnchor(repo) }),
      toggleFolded: () => dispatch({ type: "toggleFolded" }),
    }),
    [state.view, state.foldedOpen]
  );

  return <PivotContext.Provider value={api}>{children}</PivotContext.Provider>;
}

export function PivotTabs() {
  const { view, setView } = usePivot();
  return (
    <Segmented
      label="Group by"
      value={view}
      onChange={setView}
      options={[
        { value: "item", label: "By item" },
        { value: "repo", label: "By repo" },
      ]}
    />
  );
}

/** Renders `children` only while `when` is the current view. */
export function PivotPane({ when, children }: { when: View; children: ReactNode }) {
  const { view } = usePivot();
  if (view !== when) return null;
  return <>{children}</>;
}

export function RepoChip({ repo }: { repo: string }) {
  const { showRepo } = usePivot();
  const { ref, cut } = useIsTruncated<HTMLSpanElement>(repo);
  return (
    <Tooltip content={repo} disabled={!cut} describe={false} toggleOnTap={false}>
      <ChipButton onClick={() => showRepo(repo)} aria-label={`Show everything for ${repo}`}>
        <span ref={ref} className="min-w-0 truncate">
          {repo}
        </span>
      </ChipButton>
    </Tooltip>
  );
}

const COUNTED_KEY = "briff-counted";

/**
 * Count tile (DESIGN.md §8). Counts up on the first view of a bulletin in a session
 * (500ms under 20, 900ms otherwise); revisits and reduced motion show the number.
 */
export function CountTile({
  bulletinId,
  value,
  caption,
  alarm,
  target,
  view = "item",
}: {
  bulletinId: string;
  value: number;
  caption: string;
  alarm: boolean;
  target: string;
  view?: View;
}) {
  const { jumpTo } = usePivot();
  const [shown, setShown] = useState(value);

  useEffect(() => {
    if (value === 0 || prefersReducedMotion()) return;
    let seen: string[] = [];
    try {
      seen = JSON.parse(window.sessionStorage.getItem(COUNTED_KEY) ?? "[]") as string[];
    } catch {
      return;
    }
    const key = `${bulletinId}:${caption}`;
    if (seen.includes(key)) return;
    try {
      window.sessionStorage.setItem(COUNTED_KEY, JSON.stringify([...seen, key].slice(-200)));
    } catch {
      // Storage full or blocked: count up anyway, once per mount.
    }
    const duration = value >= 20 ? 900 : 500;
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const q = Math.min(1, (now - start) / duration);
      setShown(Math.round(value * (1 - Math.pow(1 - q, 3))));
      if (q < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [bulletinId, caption, value]);

  return (
    <button
      type="button"
      onClick={() => jumpTo(target, view)}
      className="bg-surface border-line hover:border-line-strong hover:shadow-lift ease-entrance rounded-tile border px-3.5 pt-3.5 pb-3 text-left transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5"
    >
      <b className={cn("type-stat block", alarm ? "text-sec" : "text-fg")} aria-hidden>
        {shown}
      </b>
      <span className="sr-only">{value}</span>
      <span className="text-fg-muted mt-2 block text-[12px] leading-[1.3]">{caption}</span>
    </button>
  );
}

/** The folded-away bar: opens the list of updates that did not make the two sections. */
export function FoldedBar({ count, children }: { count: number; children: ReactNode }) {
  const { foldedOpen: open, toggleFolded } = usePivot();
  return (
    <div id={FOLDED_ID} className="scroll-mt-24">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="folded-list"
        onClick={toggleFolded}
        className="border-line-strong text-fg-muted hover:border-brand hover:text-fg rounded-card flex w-full items-center gap-3 border border-dashed px-4 py-3.5 text-left transition-colors duration-200"
      >
        <b className="font-display text-fg text-[22px] font-semibold tabular-nums">{count}</b>
        <span>{count === 1 ? "update folded away" : "updates folded away"}</span>
        <span className="text-brand ml-auto font-medium">{open ? "Hide" : "Show"}</span>
      </button>
      <div id="folded-list" className="expand" data-open={open}>
        <div className="min-h-0 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
