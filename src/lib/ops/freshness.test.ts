import { describe, expect, it } from "vitest";

import { SCHEDULE } from "@/lib/jobs/schedule";

import { cronIntervalMs, nextCronTime } from "./cron";
import { jobFreshness, staleAfterMs } from "./freshness";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (iso: string) => new Date(iso);

describe("cron evaluation", () => {
  it("finds the next fire strictly after a time", () => {
    expect(nextCronTime("0 4 * * *", at("2026-11-01T03:59:30Z"))).toEqual(
      at("2026-11-01T04:00:00Z")
    );
    expect(nextCronTime("0 4 * * *", at("2026-11-01T04:00:00Z"))).toEqual(
      at("2026-11-02T04:00:00Z")
    );
    // 2026-11-01 is a Sunday; the bulletin runs Monday.
    expect(nextCronTime("0 4 * * 1", at("2026-11-01T12:00:00Z"))).toEqual(
      at("2026-11-02T04:00:00Z")
    );
    expect(nextCronTime("30 */6 * * *", at("2026-11-01T06:31:00Z"))).toEqual(
      at("2026-11-01T12:30:00Z")
    );
    expect(nextCronTime("10,40 * * * *", at("2026-11-01T06:11:00Z"))).toEqual(
      at("2026-11-01T06:40:00Z")
    );
  });

  it("derives each schedule's interval", () => {
    expect(cronIntervalMs("0 * * * *")).toBe(HOUR);
    expect(cronIntervalMs("0 3 * * *")).toBe(DAY);
    expect(cronIntervalMs("0 4 * * 1")).toBe(7 * DAY);
    expect(cronIntervalMs("30 */6 * * *")).toBe(6 * HOUR);
    expect(cronIntervalMs("10,40 * * * *")).toBe(30 * 60_000);
  });

  it("rejects malformed expressions", () => {
    expect(() => nextCronTime("0 4 * *", new Date())).toThrow();
    expect(() => nextCronTime("61 * * * *", new Date())).toThrow();
  });
});

describe("staleness thresholds", () => {
  const byType = Object.fromEntries(SCHEDULE.map((s) => [s.type, staleAfterMs(s.cron)]));

  it("allows daily jobs 26h, the hourly collect 3h and the weekly bulletin 8 days", () => {
    expect(byType["security-scan"]).toBe(26 * HOUR);
    expect(byType["refresh-packages"]).toBe(26 * HOUR);
    expect(byType["collect-sources"]).toBe(3 * HOUR);
    expect(byType["weekly-bulletin"]).toBe(8 * DAY);
    expect(byType["triage-items"]).toBe(8 * HOUR);
  });
});

describe("jobFreshness", () => {
  const now = at("2026-11-02T12:00:00Z");

  it("is ok inside the threshold and stale past it", () => {
    const fresh = jobFreshness(
      "0 4 * * *",
      { lastSuccessAt: at("2026-11-01T12:00:01Z"), firstQueuedAt: null },
      now
    );
    expect(fresh.status).toBe("ok");
    expect(fresh.dueBy).toEqual(at("2026-11-02T14:00:01Z"));
    const stale = jobFreshness(
      "0 4 * * *",
      { lastSuccessAt: at("2026-11-01T09:59:00Z"), firstQueuedAt: null },
      now
    );
    expect(stale.status).toBe("stale");
  });

  it("never alerts on a type that was never queued (fresh install, new job type)", () => {
    expect(jobFreshness("0 * * * *", { lastSuccessAt: null, firstQueuedAt: null }, now)).toEqual({
      status: "never",
      dueBy: null,
    });
  });

  it("turns a queued but never successful type stale after the grace period", () => {
    const queued = at("2026-11-02T10:30:00Z");
    expect(
      jobFreshness("0 * * * *", { lastSuccessAt: null, firstQueuedAt: queued }, now).status
    ).toBe("never");
    const older = at("2026-11-02T09:59:00Z");
    expect(
      jobFreshness("0 * * * *", { lastSuccessAt: null, firstQueuedAt: older }, now).status
    ).toBe("stale");
    // Weekly: a day of grace.
    expect(
      jobFreshness(
        "0 4 * * 1",
        { lastSuccessAt: null, firstQueuedAt: at("2026-11-02T04:00:00Z") },
        now
      ).status
    ).toBe("never");
  });
});
