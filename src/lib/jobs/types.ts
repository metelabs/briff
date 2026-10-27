export const JOB_TYPES = [
  "refresh-runtime-lifecycle",
  "security-scan",
  "collect-sources",
  "triage-items",
  "weekly-bulletin",
  "refresh-packages",
  // Admin "Preview synthesis": payload { orgId, streamId, model } (src/pipeline/preview.ts).
  "bulletin-preview",
  // GitHub App: payload { installationId, repos?, force? } (src/lib/github/scan.ts).
  "github-scan",
] as const;

export type JobType = (typeof JOB_TYPES)[number];

export function isJobType(value: string): value is JobType {
  return (JOB_TYPES as readonly string[]).includes(value);
}
