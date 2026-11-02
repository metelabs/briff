import { redirect } from "next/navigation";

import { getOrgContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { getEnv, isCloud } from "@/lib/env";
import { appJwt, exchangeOAuthCode, getInstallation, userInstallationIds } from "@/lib/github/api";
import { githubAppConfig } from "@/lib/github/config";
import { enqueueGithubScan, reposUrl } from "@/lib/github/flow";
import { installationCapacity, linkInstallation } from "@/lib/github/installations";
import { verifyState } from "@/lib/github/state";
import { log } from "@/lib/log";

// The app's OAuth callback: the user token (used once, never stored) must list the
// installation among the ones this GitHub user can access; only then is it linked to the
// org that started the flow, and its repos are scanned.
export async function GET(request: Request): Promise<Response> {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  const config = githubAppConfig();
  if (!config) return Response.redirect(reposUrl("not-configured"), 303);
  const params = new URL(request.url).searchParams;
  const state = verifyState(getEnv().BETTER_AUTH_SECRET, params.get("state"));
  const code = params.get("code");
  if (
    !state ||
    state.purpose !== "verify" ||
    state.orgId !== ctx.orgId ||
    state.userId !== ctx.userId ||
    !state.installationId ||
    !code
  ) {
    return Response.redirect(reposUrl("invalid-state"), 303);
  }
  const installationId = state.installationId;
  const http = (url: string, init?: RequestInit) => fetch(url, init);
  try {
    const userToken = await exchangeOAuthCode(http, config.clientId, config.clientSecret, code);
    if (!(await userInstallationIds(http, userToken)).includes(installationId)) {
      log.warn({ orgId: ctx.orgId, installationId }, "github: user cannot access the installation");
      return Response.redirect(reposUrl("forbidden"), 303);
    }
    const info = await getInstallation(
      http,
      appJwt(config.appId, config.privateKey),
      installationId
    );
    const db = getDb();
    const { limit } = await installationCapacity(db, ctx.orgId, isCloud());
    const result = await linkInstallation(db, {
      orgId: ctx.orgId,
      installationId,
      accountLogin: info.account?.login ?? "",
      accountType: info.account?.type ?? "",
      suspendedAt: info.suspended_at ? new Date(info.suspended_at) : null,
      limit,
    });
    if (result === "other-org") return Response.redirect(reposUrl("other-org"), 303);
    if (result === "at-limit") {
      log.info({ orgId: ctx.orgId, installationId, limit }, "github: installation limit reached");
      return Response.redirect(reposUrl("at-limit"), 303);
    }
    await enqueueGithubScan(db, { installationId, force: true });
    log.info(
      { orgId: ctx.orgId, installationId, result },
      "github: installation linked, scan queued"
    );
    return Response.redirect(reposUrl("connected"), 303);
  } catch (err) {
    log.error({ err, orgId: ctx.orgId, installationId }, "github: setup failed");
    return Response.redirect(reposUrl("failed"), 303);
  }
}
