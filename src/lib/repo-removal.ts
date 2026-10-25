import type { OrgDb } from "@/lib/db/with-org";

// Removing a repo deletes its row; Dependency, RepoRuntime, Alert and StreamRepo rows go with
// it (ON DELETE CASCADE). Ids left in ItemMatch.repoIds / urgentRepoIds and Deadline.affectedRepos
// stay: every reader keeps only the ids of current included repos, and emptying a list would turn
// a repo match into a stack-wide one. Bulletins store repo names, so past bulletins keep them.

/** Deletes one repo of the org; null when it does not exist (or belongs to another org). */
export async function removeRepo(db: OrgDb, repoId: string): Promise<{ name: string } | null> {
  const repo = await db.repo.findFirst({ where: { id: repoId }, select: { name: true } });
  if (!repo) return null;
  const res = await db.repo.deleteMany({ where: { id: repoId } });
  return res.count === 1 ? repo : null;
}
