import { describe, expect, it } from "vitest";

import { loadPrompt, parsePrompt } from "./prompts";

describe("prompts", () => {
  it("every prompt file carries a version header", () => {
    for (const name of ["triage", "synthesis", "profile"] as const) {
      const prompt = loadPrompt(name);
      expect(prompt.version).toMatch(new RegExp(`^${name}-v\\d+$`));
      expect(prompt.text.length).toBeGreaterThan(200);
      expect(prompt.text).not.toContain("<!--");
    }
  });

  it("refuses a prompt without a version", () => {
    expect(() => parsePrompt("triage", "no header")).toThrow(/version/);
  });
});
