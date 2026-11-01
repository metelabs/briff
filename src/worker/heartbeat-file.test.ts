import { describe, expect, it } from "vitest";

import { log } from "@/lib/log";

import { heartbeatFile } from "./heartbeat-file";

describe("heartbeatFile", () => {
  it("writes at most once per 15s however often it is called", async () => {
    let now = 1_000_000;
    const writes: string[] = [];
    const touch = heartbeatFile(
      log,
      "/tmp/hb",
      async (_p, data) => void writes.push(data),
      () => now
    );
    await touch();
    await touch();
    now += 14_999;
    await touch();
    expect(writes).toHaveLength(1);
    now += 1;
    await touch();
    expect(writes).toEqual([new Date(1_000_000).toISOString(), new Date(1_015_000).toISOString()]);
  });

  it("swallows a failed write", async () => {
    const touch = heartbeatFile(log, "/tmp/hb", async () => {
      throw new Error("read-only");
    });
    await expect(touch()).resolves.toBeUndefined();
  });
});
