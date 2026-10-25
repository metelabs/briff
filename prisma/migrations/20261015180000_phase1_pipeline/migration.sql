-- AlterEnum
BEGIN;
CREATE TYPE "BulletinBucket_new" AS ENUM ('security', 'breaking_or_feature', 'model_or_pricing', 'deadline', 'minor');
ALTER TABLE "bulletin_item" ALTER COLUMN "bucket" TYPE "BulletinBucket_new" USING ("bucket"::text::"BulletinBucket_new");
ALTER TYPE "BulletinBucket" RENAME TO "BulletinBucket_old";
ALTER TYPE "BulletinBucket_new" RENAME TO "BulletinBucket";
DROP TYPE "public"."BulletinBucket_old";
COMMIT;

-- AlterTable
ALTER TABLE "bulletin" ADD COLUMN     "emailError" TEXT,
ADD COLUMN     "emailSentAt" TIMESTAMP(3),
ADD COLUMN     "language" TEXT NOT NULL DEFAULT 'tr',
ADD COLUMN     "minorCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "periodEnd" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "periodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "subject" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "bulletin_item" ADD COLUMN     "affectedRepos" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "headline" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "interest_profile" ADD COLUMN     "model" TEXT,
ADD COLUMN     "promptVersion" TEXT,
ADD COLUMN     "refreshedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "repo" ADD COLUMN     "includedChangedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "deliveryEmail" TEXT,
ADD COLUMN     "language" TEXT NOT NULL DEFAULT 'tr';

-- CreateTable
CREATE TABLE "item_triage" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "bucket" "BulletinBucket" NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "packages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dueAt" TIMESTAMP(3),
    "dueWhat" TEXT,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_triage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "item_triage_itemId_key" ON "item_triage"("itemId");

-- CreateIndex
CREATE INDEX "item_triage_createdAt_idx" ON "item_triage"("createdAt");

-- CreateIndex
CREATE INDEX "item_triage_bucket_createdAt_idx" ON "item_triage"("bucket", "createdAt");

-- AddForeignKey
ALTER TABLE "item_triage" ADD CONSTRAINT "item_triage_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AlterTable: delivery is email-only (founder decision, 15 Oct 2026)
ALTER TABLE "bulletin" DROP COLUMN "telegramStatus";
