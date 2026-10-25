import { getOrgContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { log } from "@/lib/log";
import { orgExportStream } from "@/lib/org-data";

// Settings → Your data → Export: the signed-in member's org as one JSON download.
// A GET route because a file download is not a form submission; the session decides the org.
export async function GET(): Promise<Response> {
  const ctx = await getOrgContext();
  if (!ctx) return Response.json({ error: "Sign in first." }, { status: 401 });
  const now = new Date();
  log.info({ orgId: ctx.orgId, userId: ctx.userId }, "data export started");
  const day = now.toISOString().slice(0, 10);
  return new Response(orgExportStream(getDb(), ctx.orgId, now), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="briff-export-${day}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
