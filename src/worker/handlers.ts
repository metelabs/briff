import { baseImageScan } from "@/security/base-images";
import { githubScan } from "@/lib/github/scan";
import type { JobType } from "@/lib/jobs/types";
import { bulletinPreview } from "@/pipeline/preview";
import { triageItems } from "@/pipeline/triage";
import { weeklyBulletin } from "@/pipeline/weekly";
import { securityScan } from "@/security/scan";
import { collectSources } from "@/sources/collect";
import { refreshPackages } from "@/sources/refresh-packages";

import type { JobHandler } from "./types";

export const handlers: Record<JobType, JobHandler> = {
  "security-scan": securityScan,
  "base-image-scan": baseImageScan,
  "collect-sources": collectSources,
  "triage-items": triageItems,
  "weekly-bulletin": weeklyBulletin,
  "refresh-packages": refreshPackages,
  "bulletin-preview": bulletinPreview,
  "github-scan": githubScan,
};
