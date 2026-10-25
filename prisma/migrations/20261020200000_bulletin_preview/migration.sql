-- DropIndex
DROP INDEX "bulletin_orgId_streamId_weekStart_key";

-- AlterTable
ALTER TABLE "bulletin" ADD COLUMN     "preview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "previewKey" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE UNIQUE INDEX "bulletin_orgId_streamId_weekStart_previewKey_key" ON "bulletin"("orgId", "streamId", "weekStart", "previewKey");

