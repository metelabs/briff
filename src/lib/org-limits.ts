import type { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { freeSlug } from "@/lib/streams";

export class OrgLimitError extends Error {}
export function repoLimitMessage(limit: number): string {
  return `Repository limit reached (${limit}). Ask the instance admin to raise your organisation's limit.`;
}

export async function createLimitedStream(
  db: PrismaClient,
  orgId: string,
  name: string
): Promise<void> {
  await withOrg(db, orgId).$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(68422::int, hashtext(${orgId}))`;
    const org = await tx.org.findUniqueOrThrow({
      where: { id: orgId },
      select: { streamLimit: true },
    });
    if ((await tx.bulletinStream.count()) >= org.streamLimit)
      throw new OrgLimitError(
        `Stream limit reached (${org.streamLimit}). Ask the instance admin to raise your organisation's limit.`
      );
    await tx.bulletinStream.create({ data: { orgId, name, slug: await freeSlug(tx, name) } });
  });
}
