import { redirect } from "next/navigation";

import { getOrgContext } from "@/lib/auth/session";
import { getEnv } from "@/lib/env";
import { githubAppConfig } from "@/lib/github/config";
import { reposUrl } from "@/lib/github/flow";
import { signState } from "@/lib/github/state";

// "Connect GitHub": sends the signed-in member to the app's install page with a signed
// state bound to their org and user (docs/GITHUB-APP.md).
export async function GET(): Promise<Response> {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  const config = githubAppConfig();
  if (!config) return Response.redirect(reposUrl("not-configured"), 303);
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
