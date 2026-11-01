-- CreateEnum
CREATE TYPE "PlanSource" AS ENUM ('default', 'admin', 'paddle');

-- AlterEnum
ALTER TYPE "OrgEventType" ADD VALUE 'plan.changed';

-- AlterTable
ALTER TABLE "org" ADD COLUMN     "paddleCustomerId" TEXT,
ADD COLUMN     "planSource" "PlanSource" NOT NULL DEFAULT 'default';

-- Plans other than Free could only be set by the instance admin before billing existed.
UPDATE "org" SET "planSource" = 'admin' WHERE "plan" <> 'free';

-- CreateTable
CREATE TABLE "subscription" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "paddleSubscriptionId" TEXT NOT NULL,
    "paddleCustomerId" TEXT NOT NULL,
    "paddlePriceId" TEXT NOT NULL,
    "plan" "OrgPlan" NOT NULL,
    "interval" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3),
    "nextBilledAt" TIMESTAMP(3),
    "scheduledChange" JSONB,
    "canceledAt" TIMESTAMP(3),
    "pastDueSince" TIMESTAMP(3),
    "stateAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_event" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "billing_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_paddleSubscriptionId_key" ON "subscription"("paddleSubscriptionId");

-- CreateIndex
CREATE INDEX "subscription_orgId_idx" ON "subscription"("orgId");

-- CreateIndex
CREATE INDEX "billing_event_processedAt_idx" ON "billing_event"("processedAt");

-- CreateIndex
CREATE INDEX "org_paddleCustomerId_idx" ON "org"("paddleCustomerId");

-- AddForeignKey
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

