-- CreateEnum
CREATE TYPE "OpsAlertKind" AS ENUM ('failed', 'stale');

-- CreateTable
CREATE TABLE "ops_alert" (
    "id" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "kind" "OpsAlertKind" NOT NULL,
    "lastSentAt" TIMESTAMP(3) NOT NULL,
    "lastMessage" TEXT NOT NULL,
    "suppressed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ops_alert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ops_alert_jobType_kind_key" ON "ops_alert"("jobType", "kind");

