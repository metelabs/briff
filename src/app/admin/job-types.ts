import { JOB_TYPES, type JobType } from "@/lib/jobs/types";

/** Job types an admin can queue by hand; GitHub scans need a payload. */
export const RUNNABLE_JOB_TYPES = JOB_TYPES.filter(
  (t): t is Exclude<JobType, "github-scan"> => t !== "github-scan"
);
