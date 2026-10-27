ALTER TABLE "org" ADD COLUMN "baseImageAlerts" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "repo" ADD COLUMN "baseImageScannedAt" TIMESTAMP(3);
CREATE TABLE "base_image_alert" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orgId" TEXT NOT NULL REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "repoId" TEXT NOT NULL REFERENCES "repo"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "image" TEXT NOT NULL,
  "ecosystem" TEXT NOT NULL,
  "osvId" TEXT NOT NULL,
  "summary" TEXT,
  "severity" TEXT,
  "packages" JSONB NOT NULL,
  "action" TEXT NOT NULL,
  "kind" "AlertKind" NOT NULL DEFAULT 'new',
  "publishedAt" TIMESTAMP(3),
  "modifiedAt" TIMESTAMP(3) NOT NULL,
  "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "base_image_alert_repoId_image_osvId_key" ON "base_image_alert"("repoId", "image", "osvId");
CREATE INDEX "base_image_alert_orgId_idx" ON "base_image_alert"("orgId");
