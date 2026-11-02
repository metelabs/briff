import { refreshRuntimeLifecycle } from "@/lib/runtime-eol-catalog";

import { baseImageScan } from "@/security/base-images";
import { billingCheck, billingNotify } from "@/lib/billing/jobs";
import { deliverTarget } from "@/lib/delivery-targets/deliver";
import { githubScan } from "@/lib/github/scan";
import type { JobType } from "@/lib/jobs/types";
import { opsCheck } from "@/lib/ops/check";
import { triageItems } from "@/pipeline/triage";
import { weeklyBulletin } from "@/pipeline/weekly";
import { securityScan } from "@/security/scan";
import { collectSources } from "@/sources/collect";
import { refreshPackages } from "@/sources/refresh-packages";

import type { JobHandler } from "./types";

export const handlers: Record<JobType, JobHandler> = {
  "refresh-runtime-lifecycle": refreshRuntimeLifecycle,
  "security-scan": securityScan,
  "base-image-scan": baseImageScan,
  "collect-sources": collectSources,
  "triage-items": triageItems,
  "weekly-bulletin": weeklyBulletin,
  "refresh-packages": refreshPackages,
  "ops-check": opsCheck,
  "github-scan": githubScan,
  "billing-check": billingCheck,
  "billing-notify": billingNotify,
  "deliver-target": deliverTarget,
};
