// State of the bulletin page's By item / By repo pivot, pure so the cross-view jumps are
// testable: a tile or chip can target an element that only exists in the other view, so
// the folded list's open state and the scroll target live here, not in the panes.

export type View = "item" | "repo";

export const FOLDED_ID = "folded";

export interface PivotState {
  view: View;
  /** The folded-away list is expanded (survives switching views). */
  foldedOpen: boolean;
  /** Element to scroll to once the view has rendered; consumed by the page. */
  target: { id: string; flash: boolean } | null;
}

export type PivotAction =
  | { type: "view"; view: View }
  | { type: "jump"; id: string; view: View }
  | { type: "repo"; anchor: string }
  | { type: "toggleFolded" }
  | { type: "scrolled" };

export const INITIAL_PIVOT: PivotState = { view: "item", foldedOpen: false, target: null };

export function pivotReducer(state: PivotState, action: PivotAction): PivotState {
  switch (action.type) {
    case "view":
      return { ...state, view: action.view };
    case "jump":
      return {
        view: action.view,
        // The folded tile reveals the items it counts, whichever view it was clicked in.
        foldedOpen: state.foldedOpen || action.id === FOLDED_ID,
        target: { id: action.id, flash: false },
      };
    case "repo":
      return { ...state, view: "repo", target: { id: action.anchor, flash: true } };
    case "toggleFolded":
      return { ...state, foldedOpen: !state.foldedOpen };
    case "scrolled":
      return { ...state, target: null };
  }
}

/** A repo name on an item row; `clickable` when the By repo view has a card for it. */
export interface RepoName {
  repo: string;
  clickable: boolean;
}

/** Marks each repo that has a By repo card (`cards`, the groups' repo names) as clickable. */
export function repoNamesOf(repos: readonly string[], cards: ReadonlySet<string>): RepoName[] {
  return repos.map((repo) => ({ repo, clickable: cards.has(repo) }));
}

/** Whether any item on the page names a repo with a By repo card (the click hint's condition). */
export function hasClickableRepo(
  items: readonly { affectedRepos: readonly string[] }[],
  cards: ReadonlySet<string>
): boolean {
  return items.some((i) => i.affectedRepos.some((r) => cards.has(r)));
}

/**
 * The chips a row shows: every repo up to `limit`, else `limit - 1` and a "+N" chip for the
 * rest until it is expanded.
 */
export function chipLayout<T>(
  repos: readonly T[],
  limit: number,
  expanded: boolean
): { shown: readonly T[]; more: number } {
  if (expanded || repos.length <= limit) return { shown: repos, more: 0 };
  const shown = repos.slice(0, Math.max(1, limit - 1));
  return { shown, more: repos.length - shown.length };
}
