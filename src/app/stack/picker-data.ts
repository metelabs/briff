import "server-only";

import type { OrgContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { withOrg } from "@/lib/db/with-org";
import { isCloud } from "@/lib/env";
import { loadOrgLimits } from "@/lib/org-limits";
import { stackItemLimit } from "@/lib/plans";
import { stackIcons } from "@/lib/stack-icons";
import { DEFAULT_STREAM } from "@/lib/streams";

import type { PickerProps } from "./picker";

/** What every picker page needs besides the stack itself. */
export async function loadPickerData(
  ctx: OrgContext,
  stackId: string | null
): Promise<
  Pick<
    PickerProps,
    "icons" | "streams" | "defaultStreamId" | "itemLimit" | "usedElsewhere" | "canEdit"
  >
> {
  const db = getDb();
  const scoped = withOrg(db, ctx.orgId);
  const others = {
    repo: { source: "manual" as const },
    ...(stackId ? { repoId: { not: stackId } } : {}),
  };
  const [limits, streams, deps, runtimes] = await Promise.all([
    loadOrgLimits(db, ctx.orgId),
    scoped.bulletinStream.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, slug: true },
    }),
    scoped.dependency.count({ where: others }),
    scoped.repoRuntime.count({ where: others }),
  ]);
  return {
    icons: stackIcons(),
    streams: streams.map(({ id, name }) => ({ id, name })),
    defaultStreamId:
      (streams.find((s) => s.slug === DEFAULT_STREAM.slug) ?? streams[0])?.id ?? null,
    itemLimit: stackItemLimit(limits.plan, { cloud: isCloud() }),
    usedElsewhere: deps + runtimes,
    canEdit: ctx.role === "owner",
  };
}
