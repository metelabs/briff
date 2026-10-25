import type { BulletinBucket } from "@/generated/prisma/enums";

export const BUCKETS = [
  "security",
  "breaking_or_feature",
  "model_or_pricing",
  "deadline",
  "minor",
] as const satisfies readonly BulletinBucket[];

export type Bucket = (typeof BUCKETS)[number];
