import { describe, expect, it } from "vitest";

import { rematchOrgOf } from "@/sources/collect";

import {
  SCAN_DEBOUNCE_MS,
  SCAN_SESSION_TIMEOUT_MS,
  scanFollowUp,
  scanFollowUpKey,
} from "./follow-up";

const now = new Date("2026-10-23T03:31:08.100Z");
const later = (ms: number) => new Date(now.getTime() + ms);

describe("scanFollowUp", () => {
  it("never runs the urgent pass mid-session: a non-final upload only arms the safety net", () => {
    expect(scanFollowUp({ scanId: "s", final: false }, now)).toEqual({
      runAfter: later(SCAN_SESSION_TIMEOUT_MS),
    });
    expect(scanFollowUp({ scanId: "s" }, now)).toEqual({
      runAfter: later(SCAN_SESSION_TIMEOUT_MS),
    });
  });

  it("runs the pass now after the final upload, whether or not runtimes changed", () => {
    expect(scanFollowUp({ scanId: "s", final: true }, now)).toEqual({ runAfter: now });
  });

  it("debounces every upload of an older scanner without a session", () => {
    expect(scanFollowUp({}, now)).toEqual({ runAfter: later(SCAN_DEBOUNCE_MS) });
    // `final` without a session id means nothing.
    expect(scanFollowUp({ final: true }, now)).toEqual({ runAfter: later(SCAN_DEBOUNCE_MS) });
  });

  it("keys the pass per org and hands the org to collect-sources", () => {
    expect(scanFollowUpKey("org1")).toBe("collect-sources:scan:org1");
    expect(rematchOrgOf({ due: true, rematchOrgId: "org1" })).toBe("org1");
    expect(rematchOrgOf({ due: true })).toBeNull();
    expect(rematchOrgOf(null)).toBeNull();
    expect(rematchOrgOf(["org1"])).toBeNull();
  });
});
