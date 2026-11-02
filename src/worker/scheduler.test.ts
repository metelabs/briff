import cron from "node-cron";
import { describe, expect, it } from "vitest";

import { JOB_TYPES } from "@/lib/jobs/types";

import { onlyDueSources } from "@/sources/collect";

import { SCHEDULE } from "./scheduler";

describe("SCHEDULE", () => {
  it("schedules every job type but the on-demand ones (GitHub App scan, billing email) exactly once", () => {
    const onDemand: readonly string[] = ["github-scan", "deliver-target", "billing-notify"];
    const scheduled = JOB_TYPES.filter((t) => !onDemand.includes(t));
    expect(SCHEDULE.map((s) => s.type).sort()).toEqual([...scheduled].sort());
    for (const entry of SCHEDULE) expect(cron.validate(entry.cron)).toBe(true);
  });

  it("runs security daily and the bulletin on Monday at 04:00 UTC", () => {
    const byType = Object.fromEntries(SCHEDULE.map((s) => [s.type, s.cron]));
    expect(byType["security-scan"]).toBe("0 4 * * *");
    expect(byType["weekly-bulletin"]).toBe("0 4 * * 1");
    expect(byType["collect-sources"]).toBe("0 * * * *");
  });

  it("marks the hourly collect so only security and 6h-old sources are fetched", () => {
    const collect = SCHEDULE.find((s) => s.type === "collect-sources");
    expect(collect?.payload).toEqual({ due: true });
    expect(onlyDueSources(collect?.payload)).toBe(true);
    expect(onlyDueSources({})).toBe(false);
  });
});
