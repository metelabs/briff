import { themeAttribute, type Theme } from "./theme";

export interface ThemeSwitchEnv {
  root: Pick<Element, "setAttribute" | "removeAttribute">;
  reducedMotion: boolean;
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
  nextFrame: (callback: () => void) => void;
}

export const SWITCHING_ATTR = "data-theme-switching";

/**
 * A crossfade of the page snapshot (View Transitions, 200ms in globals.css) instead of
 * transitioning every element's colours, which restyled the whole tree each frame. Element
 * transitions are off while the attribute flips, so nothing lags behind the snapshot; without the
 * API or with reduced motion the switch is instant. Resolves once it has painted, also when the
 * transition is skipped or aborted.
 */
export function switchTheme(theme: Theme, env: ThemeSwitchEnv): Promise<void> {
  const attr = themeAttribute(theme);
  const flip = () => {
    env.root.setAttribute(SWITCHING_ATTR, "");
    if (attr) env.root.setAttribute("data-theme", attr);
    else env.root.removeAttribute("data-theme");
  };
  const done = () => env.root.removeAttribute(SWITCHING_ATTR);
  if (!env.reducedMotion && env.startViewTransition) {
    return env.startViewTransition(flip).finished.then(done, done);
  }
  flip();
  return new Promise((resolve) =>
    env.nextFrame(() =>
      env.nextFrame(() => {
        done();
        resolve();
      })
    )
  );
}
