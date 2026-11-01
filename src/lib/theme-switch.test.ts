import { describe, expect, it } from "vitest";

import { SWITCHING_ATTR, switchTheme, type ThemeSwitchEnv } from "./theme-switch";

function fakeRoot(initial: Record<string, string> = {}) {
  const attrs = new Map(Object.entries(initial));
  return {
    attrs,
    setAttribute: (name: string, value: string) => void attrs.set(name, value),
    removeAttribute: (name: string) => void attrs.delete(name),
  };
}

function env(
  root: ReturnType<typeof fakeRoot>,
  overrides: Partial<ThemeSwitchEnv> = {}
): ThemeSwitchEnv & { frames: (() => void)[] } {
  const frames: (() => void)[] = [];
  return {
    root,
    reducedMotion: false,
    nextFrame: (cb) => void frames.push(cb),
    frames,
    ...overrides,
  };
}

describe("switchTheme", () => {
  it("flips inside a view transition and clears the marker once it finished", async () => {
    const root = fakeRoot();
    let release: () => void = () => {};
    const finished = new Promise<void>((r) => (release = r));
    let updated = false;
    const done = switchTheme(
      "dark",
      env(root, {
        startViewTransition: (update) => {
          update();
          updated = true;
          return { finished };
        },
      })
    );
    expect(updated).toBe(true);
    expect(root.attrs.get("data-theme")).toBe("dark");
    expect(root.attrs.has(SWITCHING_ATTR)).toBe(true);
    release();
    await done;
    expect(root.attrs.has(SWITCHING_ATTR)).toBe(false);
  });

  it("clears the marker and resolves when the transition is aborted", async () => {
    const root = fakeRoot({ "data-theme": "dark" });
    await switchTheme(
      "system",
      env(root, {
        startViewTransition: (update) => {
          update();
          return { finished: Promise.reject(new Error("skipped")) };
        },
      })
    );
    expect(root.attrs.has("data-theme")).toBe(false);
    expect(root.attrs.has(SWITCHING_ATTR)).toBe(false);
  });

  it("switches at once without the API or with reduced motion, marker off after two frames", async () => {
    for (const overrides of [
      {},
      {
        reducedMotion: true,
        startViewTransition: () => ({ finished: new Promise<void>(() => {}) }),
      },
    ]) {
      const root = fakeRoot();
      const e = env(root, overrides);
      let resolved = false;
      const done = switchTheme("light", e).then(() => (resolved = true));
      expect(root.attrs.get("data-theme")).toBe("light");
      expect(root.attrs.has(SWITCHING_ATTR)).toBe(true);
      e.frames.shift()?.();
      expect(root.attrs.has(SWITCHING_ATTR)).toBe(true);
      e.frames.shift()?.();
      await done;
      expect(resolved).toBe(true);
      expect(root.attrs.has(SWITCHING_ATTR)).toBe(false);
    }
  });
});
