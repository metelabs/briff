-- AlterTable
ALTER TABLE "item_match" ADD COLUMN     "fixNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "urgentRepoIds" JSONB;

-- Handled matches count as covered for the repos they list today, so the first run after
-- the deploy sends no follow-up for them.
UPDATE "item_match" SET "urgentRepoIds" = "repoIds" WHERE "urgentAt" IS NOT NULL;
