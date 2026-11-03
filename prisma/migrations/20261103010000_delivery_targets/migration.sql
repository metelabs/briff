-- CreateEnum
CREATE TYPE "DeliveryTargetKind" AS ENUM ('slack', 'webhook');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrgEventType" ADD VALUE 'delivery_target.created';
ALTER TYPE "OrgEventType" ADD VALUE 'delivery_target.enabled';
ALTER TYPE "OrgEventType" ADD VALUE 'delivery_target.disabled';
ALTER TYPE "OrgEventType" ADD VALUE 'delivery_target.deleted';
ALTER TYPE "OrgEventType" ADD VALUE 'audit.exported';

-- CreateTable
CREATE TABLE "delivery_target" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "streamId" TEXT,
    "kind" "DeliveryTargetKind" NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT,
    "bulletin" BOOLEAN NOT NULL DEFAULT true,
    "alert" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastDeliveredAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_target_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delivery_target_orgId_idx" ON "delivery_target"("orgId");

-- AddForeignKey
ALTER TABLE "delivery_target" ADD CONSTRAINT "delivery_target_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_target" ADD CONSTRAINT "delivery_target_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "bulletin_stream"("id") ON DELETE CASCADE ON UPDATE CASCADE;

