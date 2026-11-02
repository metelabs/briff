import { redirect } from "next/navigation";

import { getOrgContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { getEnv, isCloud } from "@/lib/env";
import { githubAppConfig } from "@/lib/github/config";
import { reposUrl } from "@/lib/github/flow";
import { installationCapacity } from "@/lib/github/installations";
import { atLimit } from "@/lib/plans";
import { signState } from "@/lib/github/state";

// "Connect GitHub": sends the signed-in member to the app's install page with a signed
// state bound to their org and user (docs/GITHUB-APP.md).
export async function GET(): Promise<Response> {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  const config = githubAppConfig();
  if (!config) return Response.redirect(reposUrl("not-configured"), 303);
  // Early answer before the trip to GitHub; the callback checks again under the lock.
  const { used, limit } = await installationCapacity(getDb(), ctx.orgId, isCloud());
  if (atLimit(used, limit)) return Response.redirect(reposUrl("at-limit"), 303);
  const state = signState(getEnv().BETTER_AUTH_SECRET, {
    purpose: "install",
    orgId: ctx.orgId,
    userId: ctx.userId,
  });
  const url = new URL(
    `https://github.com/apps/${encodeURIComponent(config.slug)}/installations/new`
  );
  url.searchParams.set("state", state);
  return Response.redirect(url, 303);
}
