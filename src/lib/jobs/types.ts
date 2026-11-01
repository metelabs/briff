export const JOB_TYPES = [
  "refresh-runtime-lifecycle",
  "security-scan",
  "base-image-scan",
  "collect-sources",
  "triage-items",
  "weekly-bulletin",
  "refresh-packages",
  // Every 30 min: alerts on scheduled job types without a recent success (src/lib/ops/check.ts).
  "ops-check",
  // Admin "Preview synthesis": payload { orgId, streamId, model } (src/pipeline/preview.ts).
  "bulletin-preview",
  // GitHub App: payload { installationId, repos?, force? } (src/lib/github/scan.ts).
  "github-scan",
] as const;

export type JobType = (typeof JOB_TYPES)[number];

export function isJobType(value: string): value is JobType {
  return (JOB_TYPES as readonly string[]).includes(value);
}
