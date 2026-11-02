"use client";

import { Dialog } from "@base-ui/react/dialog";
import type MiniSearch from "minisearch";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, use, useEffect, useMemo, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { groupResults, snippet, type SearchDoc } from "./search-results";

// Docs search: `/` or Ctrl/Cmd+K opens a dialog; the index (/docs/search.json, built from the
// markdown) and MiniSearch load on first open, so pages without a search pay nothing.

export const SEARCH_INDEX_URL = "/docs/search.json";

type Index = MiniSearch<SearchDoc & { id: number }>;

let indexPromise: Promise<Index> | null = null;

function loadIndex(): Promise<Index> {
  indexPromise ??= Promise.all([
    import("minisearch"),
    fetch(SEARCH_INDEX_URL).then((r) => {
      if (!r.ok) throw new Error(`search index: HTTP ${r.status}`);
      return r.json() as Promise<SearchDoc[]>;
    }),
  ]).then(([{ default: MiniSearchClass }, docs]) => {
    const index: Index = new MiniSearchClass({
      fields: ["heading", "text", "page"],
      storeFields: ["href", "page", "section", "heading", "text"],
      searchOptions: {
        prefix: true,
        fuzzy: 0.2,
        boost: { heading: 3, page: 2 },
        combineWith: "AND",
      },
    });
    index.addAll(docs.map((d, id) => ({ ...d, id })));
    return index;
  });
  indexPromise.catch(() => {
    indexPromise = null;
  });
  return indexPromise;
}

const OpenSearch = createContext<() => void>(() => {});

export function DocsSearchProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const shortcut = e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey);
      if (!shortcut && (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey)) return;
      const active = document.activeElement;
      if (
        !shortcut &&
        active instanceof HTMLElement &&
        active.closest("input, textarea, select, [contenteditable]")
      )
        return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <OpenSearch value={() => setOpen(true)}>
      {children}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="bg-scrim fixed inset-0 z-70 transition-opacity duration-[180ms] ease-out data-ending-style:opacity-0 data-starting-style:opacity-0" />
          <Dialog.Popup className="bg-surface border-line shadow-raised rounded-card fixed top-[max(16px,10vh)] left-1/2 z-70 flex max-h-[min(640px,80vh)] w-[min(640px,calc(100vw-24px))] -translate-x-1/2 flex-col border transition-[opacity,scale] duration-[180ms] ease-out outline-none data-ending-style:scale-[.98] data-ending-style:opacity-0 data-starting-style:scale-[.98] data-starting-style:opacity-0">
            <Dialog.Title className="sr-only">Search the docs</Dialog.Title>
            <SearchPanel onDone={() => setOpen(false)} />
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </OpenSearch>
  );
}

/** The button that opens search; `/` is the hint, Ctrl/Cmd+K works too. */
export function SearchButton({ className }: { className?: string }) {
  const open = use(OpenSearch);
  return (
    <button
      type="button"
      onClick={open}
      className={cn(
        "bg-surface border-line hover:border-line-strong rounded-control text-fg-muted flex h-9 min-w-0 items-center gap-2 border px-2.5 text-[13.5px] transition-colors duration-150",
        className
      )}
    >
      <Search aria-hidden className="size-[15px] shrink-0" />
      <span className="min-w-0 flex-1 truncate text-left">Search docs</span>
      <kbd className="border-line rounded-[4px] border px-[5px] font-mono text-[11px]">/</kbd>
    </button>
  );
}

type State = { kind: "loading" } | { kind: "ready"; index: Index } | { kind: "failed" };

function SearchPanel({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  useEffect(() => {
    let live = true;
    loadIndex().then(
      (index) => live && setState({ kind: "ready", index }),
      () => live && setState({ kind: "failed" })
    );
    return () => {
      live = false;
    };
  }, []);

  const groups = useMemo(() => {
    if (state.kind !== "ready" || query.trim() === "") return [];
    const hits = state.index.search(query.trim()).slice(0, 40) as unknown as SearchDoc[];
    return groupResults(hits);
  }, [state, query]);
  const flat = groups.flatMap((g) => g.hits);
  const current = Math.min(active, Math.max(flat.length - 1, 0));

  // Focus stays in the input, so the browser does not follow the active option by itself.
  useEffect(() => {
    document.getElementById(`docs-hit-${current}`)?.scrollIntoView({ block: "nearest" });
  }, [current, groups]);

  const go = (href: string) => {
    onDone();
    router.push(href);
  };

  return (
    <>
      <div className="border-line flex items-center gap-2.5 border-b px-4">
        <Search aria-hidden className="text-fg-muted size-4 shrink-0" />
        <input
          autoFocus
          type="search"
          role="combobox"
          aria-label="Search the docs"
          aria-expanded={flat.length > 0}
          aria-controls="docs-search-results"
          aria-activedescendant={flat.length > 0 ? `docs-hit-${current}` : undefined}
          aria-autocomplete="list"
          value={query}
          placeholder="Search the docs"
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, flat.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && flat[current]) {
              e.preventDefault();
              go(flat[current].href);
            }
          }}
          className="placeholder:text-fg-subtle h-14 min-w-0 flex-1 bg-transparent text-[15px] outline-none focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        <kbd className="text-fg-muted border-line rounded-[4px] border px-[5px] font-mono text-[11px]">
          Esc
        </kbd>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {state.kind === "failed" ? (
          <p className="text-upgrade px-3 py-6 text-center text-[13.5px]" role="status">
            Could not load the search index. Close this and try again.
          </p>
        ) : query.trim() === "" ? (
          <p className="text-fg-muted px-3 py-6 text-center text-[13.5px]">
            Type to search every page: headings and text.
          </p>
        ) : state.kind === "loading" ? (
          <p className="text-fg-muted px-3 py-6 text-center text-[13.5px]" role="status">
            Loading the index…
          </p>
        ) : flat.length === 0 ? (
          <p className="text-fg-muted px-3 py-6 text-center text-[13.5px]" role="status">
            No results for “{query.trim()}”.
          </p>
        ) : (
          <div id="docs-search-results" role="listbox" aria-label="Results">
            {groups.map((group) => (
              <div
                key={group.page}
                role="group"
                aria-labelledby={`docs-group-${group.key}`}
                className="mb-2"
              >
                <p
                  id={`docs-group-${group.key}`}
                  className="text-fg-muted px-3 pt-2 pb-1 text-[12.5px] font-medium"
                >
                  {group.section} · {group.page}
                </p>
                {group.hits.map((hit) => {
                  const i = flat.indexOf(hit);
                  return (
                    <div
                      key={hit.href}
                      id={`docs-hit-${i}`}
                      role="option"
                      aria-selected={i === current}
                      onMouseMove={() => setActive(i)}
                      onClick={() => go(hit.href)}
                      className={cn(
                        "cursor-pointer rounded-[10px] px-3 py-2",
                        i === current && "bg-brand-soft"
                      )}
                    >
                      <p
                        className={cn(
                          "text-[14px] leading-[1.35] font-medium",
                          i === current && "text-brand"
                        )}
                      >
                        {hit.heading}
                      </p>
                      {hit.text && (
                        <p className="text-fg-muted mt-0.5 line-clamp-2 text-[12.5px] leading-[1.45]">
                          {snippet(hit.text, query)}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
