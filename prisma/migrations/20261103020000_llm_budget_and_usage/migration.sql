-- AlterEnum
ALTER TYPE "OpsAlertKind" ADD VALUE 'budget';

-- AlterTable
ALTER TABLE "bulletin" ADD COLUMN     "condensed" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "org" ADD COLUMN     "llmBudgetNotifiedMonth" DATE,
ADD COLUMN     "llmBudgetNotifiedPct" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "llmBudgetUsd" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "org_usage" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "bulletins" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedUsdMicros" INTEGER NOT NULL DEFAULT 0,
    "scanUploads" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "org_usage_orgId_day_key" ON "org_usage"("orgId", "day");

-- AddForeignKey
ALTER TABLE "org_usage" ADD CONSTRAINT "org_usage_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

