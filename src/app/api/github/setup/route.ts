import { redirect } from "next/navigation";

import { getOrgContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { getEnv } from "@/lib/env";
import { githubAppConfig } from "@/lib/github/config";
import { enqueueGithubScan, reposUrl } from "@/lib/github/flow";
import { findInstallation } from "@/lib/github/installations";
import { signState, verifyState } from "@/lib/github/state";
import { log } from "@/lib/log";

// GitHub's Setup URL: GitHub sends the browser here after an install or a change of repo
// selection, with `installation_id`, `setup_action` and our `state`. The installation id in
// the URL is not proof of anything (anyone can type one), so a new installation is linked
// only after the user proves, through the app's OAuth, that they can access it (callback).
export async function GET(request: Request): Promise<Response> {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  const config = githubAppConfig();
  if (!config) return Response.redirect(reposUrl("not-configured"), 303);
  const params = new URL(request.url).searchParams;
  // An organisation owner still has to approve the install request on GitHub (no id yet).
  if (params.get("setup_action") === "request")
    return Response.redirect(reposUrl("requested"), 303);
  const installationId = params.get("installation_id") ?? "";
  if (!/^\d{1,20}$/.test(installationId)) return Response.redirect(reposUrl("invalid-state"), 303);
  const db = getDb();
  const linked = await findInstallation(db, installationId);
  // A change of repo selection on GitHub ("Redirect on update") carries no state of ours; an
  // installation already linked to this org only gets a rescan (webhooks do the rest).
  if (linked?.orgId === ctx.orgId) {
    await enqueueGithubScan(db, { installationId, force: true });
    log.info({ orgId: ctx.orgId, installationId }, "github: installation updated, scan queued");
    return Response.redirect(reposUrl("updated"), 303);
  }
  const secret = getEnv().BETTER_AUTH_SECRET;
  const state = verifyState(secret, params.get("state"));
  if (
    !state ||
    state.purpose !== "install" ||
    state.orgId !== ctx.orgId ||
    state.userId !== ctx.userId
  ) {
    return Response.redirect(reposUrl("invalid-state"), 303);
  }
  if (linked) return Response.redirect(reposUrl("other-org"), 303);
  const verify = signState(secret, {
    purpose: "verify",
    orgId: ctx.orgId,
    userId: ctx.userId,
    installationId,
  });
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("state", verify);
  return Response.redirect(url, 303);
}
