ALTER TABLE "package" ADD COLUMN "actionPublic" BOOLEAN;
ALTER TABLE "package" ADD COLUMN "actionVisibilityCheckedAt" TIMESTAMP(3);
ALTER TABLE "package" ADD COLUMN "actionVisibilityRetryAt" TIMESTAMP(3);
