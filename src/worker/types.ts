import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { Logger } from "@/lib/log";

export interface JobContext {
  db: PrismaClient;
  log: Logger;
  jobId: string;
  payload: Prisma.JsonValue;
  /** Extends the job lock; long waits (batch polls) call it so the runner does not release the job. */
  heartbeat: () => Promise<void>;
}

export interface JobResult {
  counts?: Record<string, number>;
  /** Token totals per task/model, plus `batch` markers (see TokenMeter). */
  tokens?: Record<string, number | boolean>;
}

export type JobHandler = (ctx: JobContext) => Promise<JobResult>;
