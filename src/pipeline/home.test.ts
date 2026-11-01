import { describe, expect, it } from "vitest";

import {
  ago,
  attentionSeries,
  burstsOf,
  countdown,
  foldBursts,
  hasTrend,
  isFollowUpScan,
  isOpenAt,
  isStale,
  lastWeeks,
  mergeActivity,
  nextBulletinAt,
  niceMax,
  openAlerts,
  ringArcs,
  severitySplit,
  sparkGeometry,
  stackHealth,
  streamColumns,
  weeklyAttention,
  type Activity,
  type AlertState,
} from "./home";

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

const NOW = new Date("2026-11-04T12:00:00Z");
const d = (iso: string) => new Date(iso);

describe("weeklyAttention", () => {
  it("sums streams per week and counts new advisories once, leaving backlog out", () => {
    const weeks = lastWeeks(NOW, 3);
    const series = weeklyAttention(
      weeks,
      [
        { weekStart: d("2026-11-02T00:00:00Z"), act: 2, know: 3 },
        { weekStart: d("2026-11-02T00:00:00Z"), act: 1, know: 0 },
        { weekStart: d("2026-10-19T00:00:00Z"), act: 0, know: 4 },
        { weekStart: d("2026-08-03T00:00:00Z"), act: 9, know: 9 },
      ],
      [
        { createdAt: d("2026-11-03T08:00:00Z"), advisoryId: "a", kind: "new" },
        { createdAt: d("2026-11-03T09:00:00Z"), advisoryId: "a", kind: "new" },
        { createdAt: d("2026-11-03T09:00:00Z"), advisoryId: "b", kind: "backlog" },
        { createdAt: d("2026-10-27T09:00:00Z"), advisoryId: "c", kind: "new" },
      ]
    );
    expect(
      series.map(({ act, know, alerts, bulletins }) => [act, know, alerts, bulletins])
    ).toEqual([
      [0, 4, 0, 1],
      [0, 0, 1, 0],
      [3, 3, 1, 2],
    ]);
  });

  it("needs two weeks with data for a trend", () => {
    const weeks = lastWeeks(NOW, 3);
    const one = weeklyAttention(weeks, [{ weekStart: weeks[2], act: 1, know: 0 }], []);
    expect(hasTrend(one)).toBe(false);
    const two = weeklyAttention(
      weeks,
      [{ weekStart: weeks[2], act: 1, know: 0 }],
      [{ createdAt: weeks[0], advisoryId: "a", kind: "new" }]
    );
    expect(hasTrend(two)).toBe(true);
  });
});

describe("openAlerts", () => {
  const alert = (over: Partial<AlertState>): AlertState => ({
    advisoryId: "x",
    severity: "HIGH",
    kind: "new",
    createdAt: d("2026-10-01T00:00:00Z"),
    reviewedAt: null,
    resolvedAt: null,
    ...over,
  });

  it("reads open as raised, not resolved and not reviewed at that time", () => {
    const a = alert({ resolvedAt: d("2026-11-01T00:00:00Z") });
    expect(isOpenAt(a, d("2026-10-31T00:00:00Z"))).toBe(true);
    expect(isOpenAt(a, d("2026-11-02T00:00:00Z"))).toBe(false);
    expect(
      isOpenAt(alert({ createdAt: d("2026-11-03T00:00:00Z") }), d("2026-11-01T00:00:00Z"))
    ).toBe(false);
    expect(isOpenAt(alert({ reviewedAt: d("2026-10-02T00:00:00Z") }), NOW)).toBe(false);
  });

  it("splits by severity and compares with a week ago", () => {
    const result = openAlerts(
      [
        alert({ advisoryId: "a", severity: "CRITICAL" }),
        alert({ advisoryId: "a", severity: "CRITICAL" }),
        alert({ advisoryId: "b", severity: "LOW", createdAt: d("2026-11-03T00:00:00Z") }),
        alert({ advisoryId: "c", severity: null, createdAt: d("2026-11-02T00:00:00Z") }),
        alert({ advisoryId: "d", resolvedAt: d("2026-11-01T00:00:00Z") }),
        alert({ advisoryId: "e", severity: "MODERATE" }),
      ],
      NOW
    );
    expect(result).toEqual({
      total: 4,
      urgent: 2,
      delta: 1,
      severity: { critical: 1, high: 1, moderate: 1, low: 1 },
    });
  });
});

describe("repo and stack helpers", () => {
  it("calls a repo stale after 7 days without a scan, or with none", () => {
    expect(isStale(null, NOW)).toBe(true);
    expect(isStale(d("2026-10-28T11:00:00Z"), NOW)).toBe(true);
    expect(isStale(d("2026-10-28T13:00:00Z"), NOW)).toBe(false);
  });

  it("puts each repo in its most urgent drift bucket", () => {
    const repo = (urgency: number, ...statuses: string[]) => ({
      urgency,
      entries: statuses.map((status) => ({ status })),
    });
    expect(
      stackHealth([
        repo(3, "eol"),
        repo(2, "major"),
        repo(2, "major", "current"),
        repo(0, "current", "unknown"),
        repo(0, "supported"),
        repo(0, "unknown"),
        repo(0),
      ])
    ).toEqual({ eol: 1, major: 2, minor: 0, current: 2, unknown: 2 });
  });

  it("does not count the upload that added a repo as a separate scan", () => {
    const first = d("2026-11-01T10:00:00Z");
    expect(isFollowUpScan(first, d("2026-11-01T10:00:20Z"))).toBe(false);
    expect(isFollowUpScan(first, d("2026-11-02T10:00:00Z"))).toBe(true);
    expect(isFollowUpScan(first, null)).toBe(false);
  });
});

describe("formatting helpers", () => {
  it("writes a countdown and a relative time", () => {
    expect(countdown(NOW, d("2026-11-09T04:00:00Z"))).toBe("in 4d 16h");
    expect(countdown(NOW, d("2026-11-04T15:20:00Z"))).toBe("in 3h 20m");
    expect(countdown(NOW, d("2026-11-04T12:12:30Z"))).toBe("in 12m");
    expect(countdown(NOW, d("2026-11-04T11:00:00Z"))).toBe("now");
    expect(ago(NOW, d("2026-11-04T11:59:40Z"))).toBe("just now");
    expect(ago(NOW, d("2026-11-04T11:15:00Z"))).toBe("45m ago");
    expect(ago(NOW, d("2026-11-04T07:00:00Z"))).toBe("5h ago");
    expect(ago(NOW, d("2026-11-01T12:00:00Z"))).toBe("3d ago");
  });

  it("picks stream columns that fill rows evenly", () => {
    expect([1, 2, 3, 4, 5, 6].map(streamColumns)).toEqual([1, 2, 3, 2, 3, 3]);
  });

  it("rounds the axis up to an even, round number", () => {
    expect([0, 3, 5, 7, 13, 17, 41, 85, 130].map(niceMax)).toEqual([
      4, 4, 6, 8, 16, 20, 50, 100, 160,
    ]);
  });

  it("lays ring arcs end to end with a gap between them", () => {
    expect(
      ringArcs(
        [
          { key: "a", count: 1 },
          { key: "b", count: 0 },
          { key: "c", count: 3 },
        ],
        100,
        2
      )
    ).toEqual([
      { key: "a", length: 23, start: 0 },
      { key: "c", length: 73, start: 25 },
    ]);
    expect(ringArcs([{ key: "a", count: 2 }], 100, 2)).toEqual([
      { key: "a", length: 100, start: 0 },
    ]);
  });
});

describe("activity", () => {
  it("folds bursts of the same kind and keeps the newest time", () => {
    const events = [
      { at: d("2026-11-04T10:00:00Z"), key: "1", name: "a" },
      { at: d("2026-11-04T10:08:00Z"), key: "2", name: "b" },
      { at: d("2026-11-04T10:15:00Z"), key: "3", name: "c" },
      { at: d("2026-11-04T08:00:00Z"), key: "4", name: "d" },
    ];
    const folded = foldBursts(events, (g) => g.map((e) => e.name).join("+"));
    expect(folded).toEqual([
      { at: d("2026-11-04T10:15:00Z"), key: "3", text: "c+b+a", count: 3 },
      { at: d("2026-11-04T08:00:00Z"), key: "4", text: "d", count: 1 },
    ]);
    expect(foldBursts(events, (g) => String(g.length), 3 * 3_600_000)).toHaveLength(1);
    expect(burstsOf(events).map((g) => g.map((e) => e.key))).toEqual([["3", "2", "1"], ["4"]]);
  });

  it("merges sources newest first and keeps the first ten", () => {
    const ev = (key: string, iso: string): Activity => ({
      kind: "scan",
      at: d(iso),
      key,
      text: key,
      href: "/stack",
    });
    const a = Array.from({ length: 8 }, (_, i) => ev(`a${i}`, `2026-11-0${i + 1}T00:00:00Z`));
    const b = [ev("b0", "2026-11-04T12:00:00Z"), ev("b1", "2026-11-04T00:00:00Z")];
    const c = [ev("c0", "2026-10-01T00:00:00Z")];
    const merged = mergeActivity([a, b, c]);
    expect(merged).toHaveLength(10);
    expect(merged.slice(0, 5).map((e) => e.key)).toEqual(["a7", "a6", "a5", "a4", "b0"]);
    expect(merged.slice(5, 7).map((e) => e.key)).toEqual(["a3", "b1"]);
    expect(merged.map((e) => e.key)).not.toContain("c0");
  });
});
