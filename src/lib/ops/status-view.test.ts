import { describe, expect, it } from "vitest";

import { agoLabel, durationLabel, statusView } from "./status-view";

const fresh = (status: "ok" | "stale" | "never", lastSuccessAt: string | null = null) => ({
  status,
  lastSuccessAt,
  dueBy: null,
});

describe("statusView", () => {
  it("is operational when the database answers and every job is on time", () => {
    const view = statusView({
      ok: true,
      db: "ok",
      freshness: {
        "collect-sources": fresh("ok", "2026-11-02T10:00:00.000Z"),
        "weekly-bulletin": fresh("never"),
      },
      queue: { oldestPendingSeconds: null, limitSeconds: 3600 },
    });
    expect(view.overall).toBe("operational");
    expect(view.components.map((c) => [c.name, c.state])).toEqual([
      ["Web", "operational"],
      ["Database", "operational"],
      ["Worker", "operational"],
    ]);
    expect(view.jobs.map((j) => [j.label, j.state])).toEqual([
      ["Source collection", "on-schedule"],
      ["Weekly bulletin", "not-run-yet"],
    ]);
    expect(view.jobs[0].lastSuccessAt).toEqual(new Date("2026-11-02T10:00:00.000Z"));
  });

  it("is degraded when a job is late or the queue does not drain, and names what", () => {
    const view = statusView({
      ok: false,
      db: "ok",
      freshness: { "security-scan": fresh("stale", "2026-10-30T04:00:00.000Z") },
      queue: { oldestPendingSeconds: 7300, limitSeconds: 3600 },
    });
    expect(view.overall).toBe("degraded");
    expect(view.components[2]).toEqual({
      name: "Worker",
      state: "degraded",
      detail: "1 late: Security scan; the queue is not draining",
    });
    expect(view.queue?.late).toBe(true);
  });

  it("is down when the database or the health check itself fails", () => {
    expect(statusView({ ok: false, db: "error", warnings: [] }).overall).toBe("down");
    const unreachable = statusView(null);
    expect(unreachable.overall).toBe("down");
    expect(unreachable.components[1].detail).toBe("The health check did not answer");
    expect(unreachable.jobs).toEqual([]);
  });

  it("lists a job type it has no label for under its own name", () => {
    const view = statusView({ ok: true, db: "ok", freshness: { "new-job": fresh("ok") } });
    expect(view.jobs.map((j) => j.label)).toEqual(["new-job"]);
  });
});

describe("labels", () => {
  it("formats durations and ages", () => {
    expect([12, 240, 7500].map(durationLabel)).toEqual(["12 s", "4 min", "2 h 5 min"]);
    const now = new Date("2026-11-02T12:00:00Z");
    expect(agoLabel(new Date("2026-11-02T11:59:30Z"), now)).toBe("just now");
    expect(agoLabel(new Date("2026-11-02T09:55:00Z"), now)).toBe("2 h 5 min ago");
    expect(agoLabel(new Date("2026-10-31T12:00:00Z"), now)).toBe("2 days ago");
  });
});
