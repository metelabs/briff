import { describe, expect, it } from "vitest";

import { defaultConnectMethod, scanStepOf } from "./scan-status";

describe("scanStepOf", () => {
  it("waits until the first scan arrives", () => {
    expect(scanStepOf({ repos: 0, included: 0, lastScannedAt: null })).toBe("waiting");
  });

  it("asks to pick repos while some are in no stream, also for a returning org", () => {
    expect(scanStepOf({ repos: 3, included: 0, lastScannedAt: "x" })).toBe("pick");
    expect(scanStepOf({ repos: 12, included: 10, lastScannedAt: "x" })).toBe("pick");
  });

  it("is done once every repo is in a stream", () => {
    expect(scanStepOf({ repos: 10, included: 10, lastScannedAt: "x" })).toBe("done");
  });
});

describe("defaultConnectMethod", () => {
  it("recommends the GitHub App only where the instance has it", () => {
    expect(defaultConnectMethod({ configured: true, installations: [] })).toBe("app");
    expect(defaultConnectMethod({ configured: false, installations: [] })).toBe("action");
  });
});
