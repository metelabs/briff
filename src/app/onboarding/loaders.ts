import "server-only";

import { getDb } from "@/lib/db/client";
import { withOrg } from "@/lib/db/with-org";
import { getEnv } from "@/lib/env";
import { githubAppConfig } from "@/lib/github/config";
import { findActiveScanToken } from "@/lib/scan/token-store";

import {
  type ConnectData,
  type GithubAppState,
  ONBOARDING_TOKEN_NAMES,
  type ScanStatus,
  type TokenState,
} from "./scan-status";

// Page loaders that take an org id. They live outside actions.ts on purpose: every export of
// a "use server" module is callable by any client with any argument.

export async function loadScanStatus(orgId: string): Promise<ScanStatus> {
  const db = withOrg(getDb(), orgId);
  const [repos, included, latest] = await Promise.all([
    db.repo.count(),
    db.repo.count({ where: { included: true } }),
    db.repo.findFirst({
      where: { lastScannedAt: { not: null } },
      orderBy: { lastScannedAt: "desc" },
      select: { lastScannedAt: true },
    }),
  ]);
  return { repos, included, lastScannedAt: latest?.lastScannedAt?.toISOString() ?? null };
}

/** Active onboarding tokens per method; their secrets are gone, only the prefix is shown. */
export async function loadOnboardingTokens(orgId: string): Promise<TokenState> {
  const db = getDb();
  const [action, local] = await Promise.all(
    (["action", "local"] as const).map(async (method) => {
      const token = await findActiveScanToken(db, orgId, ONBOARDING_TOKEN_NAMES[method]);
      return token ? { name: token.name, prefix: token.prefix, secret: null } : null;
    })
  );
  return { action, local };
}

/** Whether the instance has the GitHub App, and this org's installations. */
export async function loadGithubAppState(orgId: string): Promise<GithubAppState> {
  const rows = await withOrg(getDb(), orgId).githubInstallation.findMany({
    orderBy: { createdAt: "asc" },
    select: { accountLogin: true, accountType: true, suspendedAt: true },
  });
  return {
    configured: githubAppConfig() !== null,
    installations: rows.map((r) => ({
      accountLogin: r.accountLogin,
      accountType: r.accountType,
      suspended: r.suspendedAt !== null,
    })),
  };
}

/** Everything the connect steps show: the first stream, the API origin, scan status, tokens. */
export async function loadConnectData(orgId: string): Promise<ConnectData> {
  const [stream, status, tokens, github] = await Promise.all([
    withOrg(getDb(), orgId).bulletinStream.findFirst({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    }),
    loadScanStatus(orgId),
    loadOnboardingTokens(orgId),
    loadGithubAppState(orgId),
  ]);
  return {
    stream,
    apiUrl: getEnv().BETTER_AUTH_URL.replace(/\/$/, ""),
    status,
    tokens,
    github,
  };
}
