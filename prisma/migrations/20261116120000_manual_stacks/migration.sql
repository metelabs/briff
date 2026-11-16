-- AlterEnum
ALTER TYPE "AlertResolvedBy" ADD VALUE 'manual_stack';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrgEventType" ADD VALUE 'stack.created';
ALTER TYPE "OrgEventType" ADD VALUE 'stack.updated';
ALTER TYPE "OrgEventType" ADD VALUE 'stack.deleted';

-- AlterEnum
ALTER TYPE "RepoSource" ADD VALUE 'manual';

-- AlterTable
ALTER TABLE "bulletin_stream" ADD COLUMN     "securityAlerts" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "weeklyBulletin" BOOLEAN NOT NULL DEFAULT true;

