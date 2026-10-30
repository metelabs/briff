-- AlterTable
ALTER TABLE "base_image_alert" ADD COLUMN     "fixedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "base_image_watch" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "since" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "base_image_watch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "base_image_distro" (
    "ecosystem" TEXT NOT NULL,
    "unfixed" INTEGER NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "base_image_distro_pkey" PRIMARY KEY ("ecosystem")
);

-- CreateTable
CREATE TABLE "base_image_fix" (
    "id" TEXT NOT NULL,
    "ecosystem" TEXT NOT NULL,
    "package" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "fixedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "base_image_fix_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "base_image_watch_orgId_idx" ON "base_image_watch"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "base_image_watch_repoId_image_key" ON "base_image_watch"("repoId", "image");

-- CreateIndex
CREATE UNIQUE INDEX "base_image_fix_ecosystem_package_version_key" ON "base_image_fix"("ecosystem", "package", "version");

-- AddForeignKey
ALTER TABLE "base_image_watch" ADD CONSTRAINT "base_image_watch_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "base_image_watch" ADD CONSTRAINT "base_image_watch_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Every existing row came from the scan that treated each advisory ever published for the
-- release as affecting the image. None satisfies the new rule (a fix published within 14
-- days, after Briff first saw the image: no image had a watch yet), so all go, silently.
-- Deleting instead of deactivating keeps an old `deliveredAt` from suppressing a future
-- alert for the same advisory.
DELETE FROM "base_image_alert";
