import { describe, expect, it } from "vitest";

import { attentionSeries, lastWeeks, nextBulletinAt, severitySplit, sparkGeometry } from "./home";

describe("lastWeeks", () => {
  it("gives 12 Mondays ending with the current week", () => {
    const weeks = lastWeeks(new Date("2026-10-24T15:00:00Z"));
    expect(weeks).toHaveLength(12);
    expect(weeks.at(-1)?.toISOString()).toBe("2026-10-19T00:00:00.000Z");
    expect(weeks[0].toISOString()).toBe("2026-08-03T00:00:00.000Z");
  });
});

describe("attentionSeries", () => {
  it("places each bulletin on its week and leaves weeks without one empty", () => {
    const weeks = lastWeeks(new Date("2026-10-24T15:00:00Z"), 3);
    expect(
      attentionSeries(weeks, [
        { weekStart: new Date("2026-10-19T00:00:00Z"), act: 4 },
        { weekStart: new Date("2026-10-05T00:00:00Z"), act: 0 },
      ])
    ).toEqual([0, null, 4]);
  });
});

describe("severitySplit", () => {
  it("counts advisories once and reads unknown severity as high", () => {
    expect(
      severitySplit([
        { advisoryId: "a", severity: "CRITICAL" },
        { advisoryId: "a", severity: "CRITICAL" },
        { advisoryId: "b", severity: "moderate" },
        { advisoryId: "c", severity: null },
        { advisoryId: "d", severity: "CVSS:3.1/AV:N" },
        { advisoryId: "e", severity: "LOW" },
      ])
    ).toEqual({ critical: 1, high: 2, moderate: 1, low: 1 });
  });
});

describe("nextBulletinAt", () => {
  it("is the next Monday 04:00 UTC", () => {
    expect(nextBulletinAt(new Date("2026-10-24T15:00:00Z")).toISOString()).toBe(
      "2026-10-26T04:00:00.000Z"
    );
    expect(nextBulletinAt(new Date("2026-10-26T03:59:00Z")).toISOString()).toBe(
      "2026-10-26T04:00:00.000Z"
    );
    expect(nextBulletinAt(new Date("2026-10-26T04:00:00Z")).toISOString()).toBe(
      "2026-11-02T04:00:00.000Z"
    );
  });
});

describe("sparkGeometry", () => {
  it("scales to the largest value and breaks the line at missing weeks", () => {
    const { segments, max } = sparkGeometry([2, 4, null, 0], 30, 28, 4);
    expect(max).toBe(4);
    expect(segments).toEqual([
      [
        { index: 0, x: 0, y: 14, value: 2 },
        { index: 1, x: 10, y: 4, value: 4 },
      ],
      [{ index: 3, x: 30, y: 24, value: 0 }],
    ]);
  });

  it("keeps an all-zero series on the baseline", () => {
    expect(sparkGeometry([0, 0], 10, 20, 2).segments[0].map((p) => p.y)).toEqual([18, 18]);
  });
});
