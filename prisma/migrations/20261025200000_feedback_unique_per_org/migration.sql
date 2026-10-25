-- One feedback row per user and item in each org, so a user in two orgs can rate the same
-- item in both. The old (userId, itemId) key was stricter, so existing rows already satisfy
-- the new one. The (orgId) index is a prefix of the new key; (userId) keeps user deletes fast.

-- DropIndex
DROP INDEX "feedback_orgId_idx";

-- DropIndex
DROP INDEX "feedback_userId_itemId_key";

-- CreateIndex
CREATE INDEX "feedback_userId_idx" ON "feedback"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_orgId_userId_itemId_key" ON "feedback"("orgId", "userId", "itemId");
