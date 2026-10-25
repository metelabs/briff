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
