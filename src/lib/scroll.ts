// In-page scrolling for buttons and section links: smooth unless the reader asked for
// reduced motion, and offset so the target lands below the sticky top bar (and any other
// element marked `data-sticky-top`), on mobile too, where the bar has two rows.

/** Space kept between the sticky bars and the scrolled-to element. */
export const SCROLL_GAP = 12;

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Height covered by sticky bars at the top of the viewport. */
export function stickyOffset(): number {
  let bottom = 0;
  for (const el of document.querySelectorAll<HTMLElement>("[data-sticky-top]")) {
    const position = getComputedStyle(el).position;
    if (position !== "sticky" && position !== "fixed") continue;
    bottom = Math.max(bottom, el.getBoundingClientRect().height);
  }
  return bottom;
}

/** Document scroll position that puts `elementTop` (page coordinates) right below the bars. */
export function scrollTargetTop(
  elementTop: number,
  offset: number,
  maxScroll: number,
  gap = SCROLL_GAP
): number {
  return Math.max(0, Math.min(maxScroll, Math.round(elementTop - offset - gap)));
}

/**
 * Scrolls `el` to just below the sticky bars. Resolves once the scroll has ended
 * (`scrollend`, or a timeout where the event is missing), so callers can highlight after it.
 */
export function scrollToElement(el: HTMLElement): Promise<void> {
  const root = document.documentElement;
  const top = scrollTargetTop(
    el.getBoundingClientRect().top + window.scrollY,
    stickyOffset(),
    root.scrollHeight - window.innerHeight
  );
  const instant = prefersReducedMotion();
  if (Math.abs(top - window.scrollY) < 2) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.removeEventListener("scrollend", finish);
      window.clearTimeout(timer);
      resolve();
    };
    window.addEventListener("scrollend", finish);
    const timer = window.setTimeout(finish, instant ? 50 : 1200);
    window.scrollTo({ top, behavior: instant ? "auto" : "smooth" });
  });
}

/**
 * Section index (Settings): the last section whose top has passed `line` (the bottom of the
 * sticky bars plus a little), or the last section once the page cannot scroll further, since
 * the final sections of a short page never reach the line.
 */
export function activeSectionId(
  sections: readonly { id: string; top: number }[],
  line: number,
  atBottom: boolean
): string | null {
  if (sections.length === 0) return null;
  if (atBottom) return sections[sections.length - 1].id;
  let current = sections[0].id;
  for (const s of sections) if (s.top <= line) current = s.id;
  return current;
}

/** True when the document is scrolled to (within 2px of) its end. */
export function atPageBottom(scrollY: number, viewport: number, scrollHeight: number): boolean {
  return scrollHeight > viewport && scrollY + viewport >= scrollHeight - 2;
}
