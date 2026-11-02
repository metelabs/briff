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
  // GitHub App: payload { installationId, repos?, force? } (src/lib/github/scan.ts).
  "github-scan",
  // Daily: reconciles Paddle subscriptions, ends grace periods (src/lib/billing/jobs.ts).
  "billing-check",
  // Billing email to an org's owners: payload { orgId, kind, ... } (src/lib/billing/jobs.ts).
  "billing-notify",
  // One Slack / webhook post: payload { orgId, targetId, event, ... } (src/lib/delivery-targets).
  "deliver-target",
] as const;

export type JobType = (typeof JOB_TYPES)[number];

export function isJobType(value: string): value is JobType {
  return (JOB_TYPES as readonly string[]).includes(value);
}
