import { describe, expect, it } from "vitest";

import { splitFirstSentence } from "./callout-text";

describe("splitFirstSentence", () => {
  it("keeps a single sentence whole", () => {
    expect(
      splitFirstSentence(
        "If an account exists for that address, we sent a link to reset its password."
      )
    ).toEqual({
      lead: "If an account exists for that address, we sent a link to reset its password.",
      rest: "",
    });
  });

  it("does not cut inside an email address", () => {
    expect(
      splitFirstSentence("We sent a link to a.b@x.dev. Your email changes once you open it.")
    ).toEqual({
      lead: "We sent a link to a.b@x.dev.",
      rest: "Your email changes once you open it.",
    });
  });

  it("splits short status lines", () => {
    expect(splitFirstSentence("Sent. Check a@x.dev.")).toEqual({
      lead: "Sent.",
      rest: "Check a@x.dev.",
    });
  });

  it("handles text without a full stop", () => {
    expect(splitFirstSentence("  Saved  ")).toEqual({ lead: "Saved", rest: "" });
  });
});
