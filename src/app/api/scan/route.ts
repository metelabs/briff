import { loadOrgLimits, repoLimitMessage } from "@/lib/org-limits";
import { z } from "zod";

import { getDb } from "@/lib/db/client";
import { getEnv, isCloud } from "@/lib/env";
import { readCapped } from "@/lib/http/read-capped";
import { log } from "@/lib/log";
import { acceptScan } from "@/lib/scan/accept";
import { resolveScannerOrg } from "@/lib/scan/ingest";
import { scanBodySchema } from "@/lib/scan/schema";
import { findScanTokenByHash, touchScanToken } from "@/lib/scan/token-store";
import { resolveScanAuth } from "@/lib/scan/tokens";
import { planAllowance, PLANS } from "@/lib/plans";
import { takeScanUpload } from "@/lib/usage";

const ORG_ERRORS = {
  no_org: "No org exists yet. Sign up in the web app first.",
  ambiguous_org: "Several orgs exist. Set SCANNER_ORG_ID.",
  unknown_org: "SCANNER_ORG_ID does not match an org.",
} as const;

export async function POST(request: Request): Promise<Response> {
  const env = getEnv();
  const db = getDb();
  const auth = await resolveScanAuth(
    request.headers.get("authorization"),
    (hash) => findScanTokenByHash(db, hash),
    env.SCANNER_TOKEN
  );
  if (!auth.ok) {
    const error = auth.reason === "revoked" ? "This scan token was revoked." : "Unauthorized";
    return Response.json({ error }, { status: 401 });
  }

  // Refused before buffering when content-length says so; else the read stops at the cap.
  const maxBytes = env.BRIFF_SCAN_MAX_BYTES;
  const body = await readCapped(request, maxBytes);
  if (!body) {
    return Response.json(
      {
        code: "SCAN_TOO_LARGE",
        error: `Scan upload is larger than ${megabytes(maxBytes)}. Upload fewer repos at a time (briff-scan --chunk).`,
      },
      { status: 413 }
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const parsed = scanBodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid scan payload.", details: z.treeifyError(parsed.error) },
      { status: 400 }
    );
  }

  let orgId: string;
  if (auth.kind === "token") {
    orgId = auth.orgId;
    await touchScanToken(db, orgId, auth.tokenId, new Date());
  } else {
    log.warn(
      {},
      "scan: SCANNER_TOKEN is deprecated; create a scan token in Settings and send it as BRIFF_TOKEN (docs/SCANNER.md)"
    );
    const org = await resolveScannerOrg(db, env.SCANNER_ORG_ID);
    if (!org.ok) return Response.json({ error: ORG_ERRORS[org.reason] }, { status: 409 });
    orgId = org.orgId;
  }

  const now = new Date();
  const { plan } = await db.org.findUniqueOrThrow({ where: { id: orgId }, select: { plan: true } });
  const dailyLimit = planAllowance(plan, "scanUploadsPerDay", { cloud: isCloud() });
  if (!(await takeScanUpload(db, orgId, dailyLimit, now))) {
    log.warn({ orgId, dailyLimit }, "scan: daily upload limit reached");
    return Response.json(
      {
        code: "SCAN_RATE_LIMIT",
        error: `Daily scan upload limit reached (${dailyLimit} on the ${PLANS[plan].name} plan). It resets at 00:00 UTC; see Settings → Billing for the plans.`,
      },
      { status: 429, headers: { "retry-after": String(secondsToUtcMidnight(now)) } }
    );
  }

  const accepted = await acceptScan(db, orgId, parsed.data, new Date(), { skipRepoLimit: true });
  const { repos, refreshJob: job, urgentPass } = accepted;
  const savedNames = new Set(repos.map((repo) => repo.name));
  const rejected = parsed.data.repos
    .filter((repo) => !savedNames.has(repo.name))
    .map((repo) => repo.name);
  log.info(
    {
      orgId,
      auth: auth.kind,
      repos: repos.length,
      newRepos: repos.filter((r) => r.created).length,
      jobId: job.id,
      scanId: parsed.data.scanId ?? null,
      final: parsed.data.final ?? null,
      urgentPass,
    },
    "scan: ingested"
  );
  if (rejected.length > 0) {
    return Response.json(
      {
        code: "REPO_LIMIT",
        error: repoLimitMessage(await loadOrgLimits(db, orgId)),
        rejected,
        repos,
        refreshJob: job,
        urgentPass,
      },
      { status: 409 }
    );
  }
  return Response.json({ repos, refreshJob: job, urgentPass });
}

function megabytes(bytes: number): string {
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;
}

function secondsToUtcMidnight(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}
