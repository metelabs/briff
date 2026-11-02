-- CreateEnum
CREATE TYPE "AlertResolvedBy" AS ENUM ('briff_scan', 'github_app', 'security_scan');

-- AlterTable
ALTER TABLE "alert" ADD COLUMN     "resolvedBy" "AlertResolvedBy";

