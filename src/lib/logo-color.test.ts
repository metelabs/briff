import { describe, expect, it } from "vitest";

import { contrast, logoColors, luminance, monogram, monogramHue } from "./logo-color";

describe("logo colours", () => {
  it("computes WCAG luminance and contrast", () => {
    expect(luminance("#000000")).toBe(0);
    expect(luminance("ffffff")).toBeCloseTo(1);
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21);
  });

  it("keeps a brand colour that reads in both themes", () => {
    expect(logoColors("3178C6")).toEqual({ light: "#3178c6", dark: "#3178c6" });
  });

  it("switches near-black marks to the foreground on dark tiles", () => {
    expect(logoColors("000000")).toEqual({ light: "#000000", dark: null });
    expect(logoColors("0A0A0A").dark).toBeNull();
    expect(logoColors("362D59").dark).toBeNull();
  });

  it("switches near-white marks to the foreground on light tiles", () => {
    expect(logoColors("ECE8D1")).toEqual({ light: null, dark: "#ece8d1" });
    expect(logoColors("FFFFFF").light).toBeNull();
  });

  it("builds a stable two-letter monogram", () => {
    expect(monogram("Dokploy")).toBe("Do");
    expect(monogram("n8n")).toBe("N8");
    expect(monogram("@playwright/test")).toBe("Pl");
    expect(monogramHue("Payload")).toBe(monogramHue("payload"));
    expect(monogramHue("Payload")).toBeGreaterThanOrEqual(0);
    expect(monogramHue("Payload")).toBeLessThan(360);
  });
});
