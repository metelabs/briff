// A search field whose query lives in the URL (`?q=`): the field debounces the user's edits
// into URL navigations and follows the URL when history restores another query. Pure, so the
// sync rules are testable without a browser.

export interface SearchSync {
  /** What the field shows. */
  value: string;
  /** The URL's query this state last saw. */
  synced: string;
  /** The query this field navigated to that the URL has not shown yet. */
  pushed: string | null;
}

export type SearchSyncEvent =
  { type: "edit"; value: string } | { type: "navigate"; q: string } | { type: "url"; q: string };

export function initialSearch(q: string): SearchSync {
  return { value: q, synced: q, pushed: null };
}

export function searchSync(state: SearchSync, event: SearchSyncEvent): SearchSync {
  switch (event.type) {
    case "edit":
      return { ...state, value: event.value };
    case "navigate":
      return { ...state, pushed: event.q === state.synced ? null : event.q };
    case "url":
      if (event.q === state.synced) return state;
      // Our own navigation arriving: keep what the user typed since; anything else
      // (Back/Forward, a link) is shown as is.
      if (event.q === state.pushed) return { ...state, synced: event.q, pushed: null };
      return { value: event.q, synced: event.q, pushed: null };
  }
}

/**
 * The current page's query string with `q` set (or removed when blank) and `page` dropped.
 * Built from the location at navigation time, so filters chosen meanwhile are kept.
 */
export function withSearch(pathname: string, search: string, q: string): string {
  const params = new URLSearchParams(search);
  if (q) params.set("q", q);
  else params.delete("q");
  params.delete("page");
  const s = params.toString();
  return s ? `${pathname}?${s}` : pathname;
}
