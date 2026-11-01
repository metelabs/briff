import { writeFile } from "node:fs/promises";

import type { Logger } from "@/lib/log";

// Read by docker-healthcheck.sh, which fails the worker when the file is older than 180s.
export const HEARTBEAT_FILE = "/tmp/briff-worker-heartbeat";
const MIN_INTERVAL_MS = 15_000;

/**
 * A throttled touch of the heartbeat file: the main loop, a timer and every job heartbeat call
 * it, and at most one write per 15s reaches the disk. The timer keeps the file fresh during a
 * long drain, which the main loop only touches between drains.
 */
export function heartbeatFile(
  log: Logger,
  path: string = HEARTBEAT_FILE,
  write: (path: string, data: string) => Promise<void> = writeFile,
  clock: () => number = Date.now
): () => Promise<void> {
  let last = -Infinity;
  return async () => {
    const now = clock();
    if (now - last < MIN_INTERVAL_MS) return;
    last = now;
    try {
      await write(path, new Date(now).toISOString());
    } catch (err) {
      log.warn({ err }, "worker: heartbeat write failed");
    }
  };
}
