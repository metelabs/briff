-- CreateEnum
CREATE TYPE "AlertKind" AS ENUM ('backlog', 'new');

-- AlterTable
ALTER TABLE "alert" ADD COLUMN     "kind" "AlertKind" NOT NULL DEFAULT 'new';

-- AlterTable
ALTER TABLE "repo" ADD COLUMN     "securityScannedAt" TIMESTAMP(3);


-- Backfill: an alert from a repo's first alerting run is backlog when that run came within
-- 26 hours (one daily security scan plus slack) of the repo being added (first ingest or the
-- last time it entered a stream). Alerts are created in one statement per org and run, so a
-- run shares one createdAt; one hour of slack covers a long run.
WITH first_run AS (
  SELECT a."repoId", MIN(a."createdAt") AS at
  FROM "alert" a
  GROUP BY a."repoId"
)
UPDATE "alert" a
SET "kind" = 'backlog'
FROM first_run f, "repo" r
WHERE a."repoId" = f."repoId"
  AND r."id" = a."repoId"
  AND a."createdAt" <= f.at + INTERVAL '1 hour'
  AND f.at <= GREATEST(r."firstSeenAt", COALESCE(r."includedChangedAt", r."firstSeenAt")) + INTERVAL '26 hours';

-- Backlog that never went out stays out: it is listed on the bulletin page instead of
-- arriving as a late first-scan email after this deploy.
UPDATE "alert" SET "deliveredAt" = "createdAt" WHERE "kind" = 'backlog' AND "deliveredAt" IS NULL;

-- A repo with alerts was scanned when they were created. An included repo with dependencies
-- that was added before the last successful security-scan run went through that run.
UPDATE "repo" r
SET "securityScannedAt" = s.at
FROM (SELECT "repoId", MAX("createdAt") AS at FROM "alert" GROUP BY "repoId") s
WHERE r."id" = s."repoId";

UPDATE "repo" r
SET "securityScannedAt" = GREATEST(COALESCE(r."securityScannedAt", last_run.at), last_run.at)
FROM (
  SELECT MAX("startedAt") AS at FROM "run" WHERE "jobType" = 'security-scan' AND "status" = 'succeeded'
) last_run
WHERE last_run.at IS NOT NULL
  AND r."included" = true
  AND COALESCE(r."includedChangedAt", r."firstSeenAt") < last_run.at
  AND EXISTS (SELECT 1 FROM "dependency" d WHERE d."repoId" = r."id");
