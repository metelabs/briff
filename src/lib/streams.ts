import type { OrgDb } from "@/lib/db/with-org";

// Bulletin streams: named repo sets with one weekly bulletin each. `Repo.included`
// stays the gate for triage and security alerts and means "in at least one
// stream". Every membership change runs in one transaction with the recount
// (syncRepoInclusion), after locking the repo rows it touches, so two concurrent
// changes to the same repo cannot both count from a stale snapshot.

/** The org-scoped client or a transaction opened from it (withOrg scoping carries over). */
export type OrgTx = Pick<OrgDb, "repo" | "streamRepo" | "bulletinStream">;

export const STREAM_NAME_MAX = 40;
export const DEFAULT_STREAM = { name: "Weekly", slug: "weekly" } as const;

export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "stream";
}

/** `slug`, or `slug-2`, `slug-3`… when taken. */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export async function freeSlug(db: OrgTx, name: string, exceptStreamId?: string): Promise<string> {
  const rows = await db.bulletinStream.findMany({
    where: exceptStreamId ? { id: { not: exceptStreamId } } : {},
    select: { slug: true },
  });
  return uniqueSlug(slugify(name), new Set(rows.map((r) => r.slug)));
}

/**
 * Row-locks the repos (a no-op write takes the lock) until the transaction ends.
 * Sorted ids keep the lock order stable between concurrent transactions.
 */
async function lockRepos(tx: OrgTx, repoIds: string[]): Promise<void> {
  for (const id of [...new Set(repoIds)].sort()) {
    await tx.repo.updateMany({ where: { id }, data: { updatedAt: new Date() } });
  }
}

/**
 * Sets `included` from stream membership for the given repos (all repos when
 * omitted). Call it inside the transaction that changed the membership.
 */
export async function syncRepoInclusion(tx: OrgTx, repoIds?: string[]): Promise<void> {
  const repos = await tx.repo.findMany({
    where: repoIds ? { id: { in: repoIds } } : {},
    select: { id: true, included: true, _count: { select: { streams: true } } },
  });
  const now = new Date();
  for (const r of repos) {
    const included = r._count.streams > 0;
    if (included === r.included) continue;
    await tx.repo.updateMany({
      where: { id: r.id },
      data: { included, includedChangedAt: now },
    });
  }
}

/** Replaces a stream's repos with `repoIds` (ids outside the org are ignored). */
export async function setStreamRepos(
  db: OrgDb,
  orgId: string,
  streamId: string,
  repoIds: string[]
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    // Locks the stream row so concurrent saves of the same stream apply one after the other.
    const locked = await tx.bulletinStream.updateMany({
      where: { id: streamId },
      data: { updatedAt: new Date() },
    });
    if (locked.count !== 1) return false;
    const [current, valid] = await Promise.all([
      tx.streamRepo.findMany({ where: { streamId }, select: { repoId: true } }),
      tx.repo.findMany({ where: { id: { in: repoIds } }, select: { id: true } }),
    ]);
    const wanted = new Set(valid.map((r) => r.id));
    const had = new Set(current.map((r) => r.repoId));
    const add = [...wanted].filter((id) => !had.has(id));
    const remove = [...had].filter((id) => !wanted.has(id));
    await lockRepos(tx, [...add, ...remove]);
    if (remove.length > 0)
      await tx.streamRepo.deleteMany({ where: { streamId, repoId: { in: remove } } });
    if (add.length > 0)
      await tx.streamRepo.createMany({
        data: add.map((repoId) => ({ orgId, streamId, repoId })),
        skipDuplicates: true,
      });
    await syncRepoInclusion(tx, [...add, ...remove]);
    return true;
  });
}

/** Adds or removes one repo from one stream. */
export async function setRepoInStream(
  db: OrgDb,
  orgId: string,
  streamId: string,
  repoId: string,
  member: boolean
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const stream = await tx.bulletinStream.findFirst({
      where: { id: streamId },
      select: { id: true },
    });
    if (!stream) return false;
    await lockRepos(tx, [repoId]);
    const repo = await tx.repo.findFirst({ where: { id: repoId }, select: { id: true } });
    if (!repo) return false;
    if (member)
      await tx.streamRepo.createMany({
        data: [{ orgId, streamId, repoId }],
        skipDuplicates: true,
      });
    else await tx.streamRepo.deleteMany({ where: { streamId, repoId } });
    await syncRepoInclusion(tx, [repoId]);
    return true;
  });
}

/** Deletes a stream; its bulletins stay (streamId becomes null) and its repos are recounted. */
export async function deleteStream(db: OrgDb, streamId: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const members = await tx.streamRepo.findMany({
      where: { streamId },
      select: { repoId: true },
    });
    const repoIds = members.map((m) => m.repoId);
    await lockRepos(tx, repoIds);
    const res = await tx.bulletinStream.deleteMany({ where: { id: streamId } });
    if (res.count !== 1) return false;
    await syncRepoInclusion(tx, repoIds);
    return true;
  });
}

/**
 * The org's first stream. Created right after the org, through withOrg, in the
 * sign-up transaction; idempotent so a retry never adds a second one.
 */
export async function ensureDefaultStream(db: OrgTx, orgId: string): Promise<void> {
  const existing = await db.bulletinStream.findFirst({
    where: { slug: DEFAULT_STREAM.slug },
    select: { id: true },
  });
  if (!existing) await db.bulletinStream.create({ data: { orgId, ...DEFAULT_STREAM } });
}
