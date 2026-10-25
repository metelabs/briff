import { writeFile } from "node:fs/promises";
import { hostname } from "node:os";

import { getDb } from "@/lib/db/client";
import { getEnv } from "@/lib/env";
import { enqueueJob, releaseStaleJobs } from "@/lib/jobs/queue";
import { isJobType, type JobType } from "@/lib/jobs/types";
import { log as rootLog } from "@/lib/log";

import { handlers } from "./handlers";
import { drainQueue } from "./runner";
import { startScheduler } from "./scheduler";

const POLL_INTERVAL_MS = 5_000;
const STALE_CHECK_INTERVAL_MS = 5 * 60_000;
// Read by docker-healthcheck.sh; must be refreshed well within its 180s window.
const HEARTBEAT_FILE = "/tmp/briff-worker-heartbeat";

const log = rootLog.child({ role: "worker" });

async function heartbeat(): Promise<void> {
  try {
    await writeFile(HEARTBEAT_FILE, new Date().toISOString());
  } catch (err) {
    log.warn({ err }, "worker: heartbeat write failed");
  }
}

function parseOnceArgs(argv: string[]): JobType[] | null {
  const index = argv.indexOf("--once");
  if (index === -1) return null;
  const types = argv.slice(index + 1).filter((a) => !a.startsWith("--"));
  const unknown = types.filter((t) => !isJobType(t));
  if (unknown.length > 0) throw new Error(`unknown job types: ${unknown.join(", ")}`);
  return types.filter(isJobType);
}

async function main(): Promise<void> {
  getEnv(); // fail fast on bad configuration
  const db = getDb();
  const workerId = `${hostname()}:${process.pid}`;

  // `--once [types...]`: enqueue the given types, drain the queue, exit. Used for
  // manual runs and verification; the long-running mode is the default.
  const onceTypes = parseOnceArgs(process.argv.slice(2));
  if (onceTypes) {
    for (const type of onceTypes) await enqueueJob(db, type);
    const ran = await drainQueue(db, handlers, workerId, log);
    log.info({ ran }, "worker: --once finished");
    await db.$disconnect();
    return;
  }

  let stopping = false;
  let wake: (() => void) | null = null;
  const stop = (signal: string) => {
    log.info({ signal }, "worker: stopping after the current job");
    stopping = true;
    wake?.();
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));

  const tasks = startScheduler(db, log);
  log.info({ workerId, schedules: tasks.length }, "worker: started");

  let lastStaleCheck = 0;
  while (!stopping) {
    await heartbeat();
    try {
      if (Date.now() - lastStaleCheck > STALE_CHECK_INTERVAL_MS) {
        const released = await releaseStaleJobs(db);
        if (released > 0) log.warn({ released }, "worker: released stale jobs");
        lastStaleCheck = Date.now();
      }
      await drainQueue(db, handlers, workerId, log, () => stopping);
    } catch (err) {
      log.error({ err }, "worker: loop error");
    }
    if (stopping) break;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, POLL_INTERVAL_MS);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    wake = null;
  }

  for (const task of tasks) await task.stop();
  await db.$disconnect();
  log.info({}, "worker: stopped");
}

main().catch((err: unknown) => {
  log.error({ err }, "worker: fatal");
  process.exit(1);
});
