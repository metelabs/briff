-- DropIndex
DROP INDEX "bulletin_orgId_weekStart_key";

-- AlterTable
ALTER TABLE "bulletin" ADD COLUMN     "streamId" TEXT,
ALTER COLUMN "language" SET DEFAULT 'en';

-- AlterTable
ALTER TABLE "user" ALTER COLUMN "language" SET DEFAULT 'en';

-- CreateTable
CREATE TABLE "bulletin_stream" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bulletin_stream_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stream_repo" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stream_repo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bulletin_stream_orgId_slug_key" ON "bulletin_stream"("orgId", "slug");

-- CreateIndex
CREATE INDEX "stream_repo_orgId_idx" ON "stream_repo"("orgId");

-- CreateIndex
CREATE INDEX "stream_repo_repoId_idx" ON "stream_repo"("repoId");

-- CreateIndex
CREATE UNIQUE INDEX "stream_repo_streamId_repoId_key" ON "stream_repo"("streamId", "repoId");

-- CreateIndex
CREATE INDEX "bulletin_streamId_idx" ON "bulletin"("streamId");

-- CreateIndex
CREATE UNIQUE INDEX "bulletin_orgId_streamId_weekStart_key" ON "bulletin"("orgId", "streamId", "weekStart");

-- AddForeignKey
ALTER TABLE "bulletin_stream" ADD CONSTRAINT "bulletin_stream_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stream_repo" ADD CONSTRAINT "stream_repo_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stream_repo" ADD CONSTRAINT "stream_repo_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "bulletin_stream"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stream_repo" ADD CONSTRAINT "stream_repo_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulletin" ADD CONSTRAINT "bulletin_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "bulletin_stream"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Data: one default stream per org ("Weekly") holding every currently included repo;
-- existing bulletins belong to it. Ids are UUIDs (Prisma only needs unique strings).
INSERT INTO "bulletin_stream" ("id", "orgId", "name", "slug", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, o."id", 'Weekly', 'weekly', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "org" o;

INSERT INTO "stream_repo" ("id", "orgId", "streamId", "repoId", "createdAt")
SELECT gen_random_uuid()::text, r."orgId", s."id", r."id", CURRENT_TIMESTAMP
FROM "repo" r
JOIN "bulletin_stream" s ON s."orgId" = r."orgId" AND s."slug" = 'weekly'
WHERE r."included" = true;

UPDATE "bulletin" b
SET "streamId" = s."id"
FROM "bulletin_stream" s
WHERE s."orgId" = b."orgId" AND s."slug" = 'weekly';

-- English only (bulletin.md §15): the language picker is gone, so nobody could switch back.
UPDATE "user" SET "language" = 'en';
