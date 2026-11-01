import { JOB_TYPES, type JobType } from "@/lib/jobs/types";

/** Job types an admin can queue by hand; preview and GitHub scans need a payload. */
export const RUNNABLE_JOB_TYPES = JOB_TYPES.filter(
  (t): t is Exclude<JobType, "bulletin-preview" | "github-scan"> =>
    t !== "bulletin-preview" && t !== "github-scan"
);
