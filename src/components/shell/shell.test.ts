import { describe, expect, it } from "vitest";

import { parseTheme, themeAttribute } from "@/lib/theme";

import { initialsOf } from "./nav";

describe("theme preference", () => {
  it("accepts light and dark, anything else is system", () => {
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("DARK")).toBe("system");
    expect(parseTheme(undefined)).toBe("system");
  });

  it("system leaves data-theme off so CSS follows the OS", () => {
    expect(themeAttribute("system")).toBeUndefined();
    expect(themeAttribute("dark")).toBe("dark");
  });
});

describe("initialsOf", () => {
  it("takes first and last word, upper-cased with a fixed locale", () => {
    expect(initialsOf("Ada Nur Yılmaz", "x@y.z")).toBe("AY");
    expect(initialsOf("ilker", "x@y.z")).toBe("IL");
    expect(initialsOf("", "dev@example.com")).toBe("DE");
  });
});
