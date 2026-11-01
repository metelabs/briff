import { describe, expect, it } from "vitest";

import { countsLabel, durationLabel, groupRuns, type RunRow } from "./runs";

const run = (id: string, jobType: string, status: string, startedAt: string): RunRow => ({
  id,
  jobType,
  status,
  startedAt: new Date(startedAt),
  finishedAt: null,
  counts: {},
  error: null,
});

describe("groupRuns", () => {
  it("keeps every job type, newest run first, with status counts", () => {
    const groups = groupRuns(
      [
        run("a", "security-scan", "succeeded", "2026-11-01T04:00:00Z"),
        run("b", "security-scan", "failed", "2026-11-02T04:00:00Z"),
        run("c", "retired-type", "succeeded", "2026-11-02T05:00:00Z"),
      ],
      ["security-scan", "collect-sources"]
    );
    expect(groups.map((g) => g.jobType)).toEqual([
      "security-scan",
      "collect-sources",
      "retired-type",
    ]);
    expect(groups[0].runs.map((r) => r.id)).toEqual(["b", "a"]);
    expect(groups[0]).toMatchObject({ succeeded: 1, failed: 1 });
    expect(groups[1].runs).toEqual([]);
  });
});

describe("labels", () => {
  it("formats durations", () => {
    const start = new Date("2026-11-01T04:00:00Z");
    const after = (ms: number) =>
      durationLabel({ startedAt: start, finishedAt: new Date(start.getTime() + ms) });
    expect(after(850)).toBe("850 ms");
    expect(after(42_000)).toBe("42 s");
    expect(after(252_000)).toBe("4 min 12 s");
    expect(after(3_780_000)).toBe("1 h 3 min");
    expect(durationLabel({ startedAt: start, finishedAt: null })).toBeNull();
  });

  it("drops zero counts", () => {
    expect(countsLabel({ fetched: 12, failed: 0, batch: false })).toBe("fetched 12");
    expect(countsLabel(null)).toBe("");
  });
});
