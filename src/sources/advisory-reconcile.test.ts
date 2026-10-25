import { describe, expect, it } from "vitest";

import { reopensUrgent } from "./advisory-reconcile";

const meta = (severity: string | null) => ({
  kind: "advisory",
  cveIds: [],
  severity,
  fixedVersions: [],
});

describe("reopensUrgent", () => {
  it("reopens only when severity crosses the email threshold upwards", () => {
    expect(reopensUrgent(meta("medium"), meta("critical"))).toBe(true);
    expect(reopensUrgent(meta("low"), meta(null))).toBe(true);
    expect(reopensUrgent(meta("high"), meta("critical"))).toBe(false);
    expect(reopensUrgent(meta("critical"), meta("medium"))).toBe(false);
    expect(reopensUrgent(meta("medium"), meta("low"))).toBe(false);
    expect(reopensUrgent(null, meta("critical"))).toBe(false);
  });
});
