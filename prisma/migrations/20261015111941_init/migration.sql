-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('owner', 'member');

-- CreateEnum
CREATE TYPE "RepoSource" AS ENUM ('local', 'github');

-- CreateEnum
CREATE TYPE "SourceKind" AS ENUM ('github_releases', 'rss', 'changelog_md', 'npm', 'osv');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('pending', 'sent', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "BulletinBucket" AS ENUM ('security', 'breaking', 'feature', 'model_pricing', 'deadline', 'minor');

-- CreateEnum
CREATE TYPE "FeedbackKind" AS ENUM ('up', 'down', 'less');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('pending', 'running', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('running', 'succeeded', 'failed');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_member" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL DEFAULT 'owner',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repo" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" "RepoSource" NOT NULL,
    "path" TEXT,
    "ecosystem" TEXT NOT NULL DEFAULT 'npm',
    "included" BOOLEAN NOT NULL DEFAULT false,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastScannedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dependency" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "installedVersion" TEXT NOT NULL,
    "direct" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package" (
    "id" TEXT NOT NULL,
    "ecosystem" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "latestVersion" TEXT,
    "deprecated" TEXT,
    "repoUrl" TEXT,
    "releaseFeedUrl" TEXT,
    "eolDate" TIMESTAMP(3),
    "eolInfo" JSONB,
    "serviceId" TEXT,
    "lastRefreshedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "package_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "homepage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source" (
    "id" TEXT NOT NULL,
    "kind" "SourceKind" NOT NULL,
    "url" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "packageId" TEXT,
    "serviceId" TEXT,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "etag" TEXT,
    "lastModified" TEXT,
    "lastFetchedAt" TIMESTAMP(3),
    "lastStatus" INTEGER,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "guid" TEXT,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "rawText" TEXT NOT NULL DEFAULT '',
    "contentHash" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_match" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "packageId" TEXT,
    "serviceId" TEXT,
    "repoIds" JSONB NOT NULL DEFAULT '[]',
    "reason" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advisory" (
    "id" TEXT NOT NULL,
    "osvId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "summary" TEXT,
    "affected" JSONB NOT NULL,
    "severity" TEXT,
    "fixedVersion" TEXT,
    "url" TEXT,
    "publishedAt" TIMESTAMP(3),
    "modifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "advisory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "advisoryId" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bulletin" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "emailStatus" "DeliveryStatus" NOT NULL DEFAULT 'pending',
    "telegramStatus" "DeliveryStatus" NOT NULL DEFAULT 'pending',
    "inputHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bulletin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bulletin_item" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "bulletinId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "bucket" "BulletinBucket" NOT NULL,
    "order" INTEGER NOT NULL,
    "line" TEXT NOT NULL,

    CONSTRAINT "bulletin_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "kind" "FeedbackKind" NOT NULL,
    "tag" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interest_profile" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "weights" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interest_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deadline" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "what" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "affectedRepos" JSONB NOT NULL DEFAULT '[]',
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deadline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "JobStatus" NOT NULL DEFAULT 'pending',
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run" (
    "id" TEXT NOT NULL,
    "jobId" TEXT,
    "jobType" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "counts" JSONB NOT NULL DEFAULT '{}',
    "tokens" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,

    CONSTRAINT "run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE INDEX "org_member_userId_idx" ON "org_member"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "org_member_orgId_userId_key" ON "org_member"("orgId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "repo_orgId_source_name_key" ON "repo"("orgId", "source", "name");

-- CreateIndex
CREATE INDEX "dependency_orgId_idx" ON "dependency"("orgId");

-- CreateIndex
CREATE INDEX "dependency_packageId_idx" ON "dependency"("packageId");

-- CreateIndex
CREATE UNIQUE INDEX "dependency_repoId_packageId_installedVersion_key" ON "dependency"("repoId", "packageId", "installedVersion");

-- CreateIndex
CREATE UNIQUE INDEX "package_ecosystem_name_key" ON "package"("ecosystem", "name");

-- CreateIndex
CREATE UNIQUE INDEX "service_key_key" ON "service"("key");

-- CreateIndex
CREATE UNIQUE INDEX "source_url_key" ON "source"("url");

-- CreateIndex
CREATE INDEX "source_kind_idx" ON "source"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "item_contentHash_key" ON "item"("contentHash");

-- CreateIndex
CREATE INDEX "item_sourceId_publishedAt_idx" ON "item"("sourceId", "publishedAt");

-- CreateIndex
CREATE INDEX "item_createdAt_idx" ON "item"("createdAt");

-- CreateIndex
CREATE INDEX "item_match_orgId_score_idx" ON "item_match"("orgId", "score");

-- CreateIndex
CREATE UNIQUE INDEX "item_match_orgId_itemId_key" ON "item_match"("orgId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "advisory_osvId_key" ON "advisory"("osvId");

-- CreateIndex
CREATE INDEX "advisory_packageId_idx" ON "advisory"("packageId");

-- CreateIndex
CREATE INDEX "alert_orgId_idx" ON "alert"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "alert_advisoryId_repoId_key" ON "alert"("advisoryId", "repoId");

-- CreateIndex
CREATE UNIQUE INDEX "bulletin_orgId_weekStart_key" ON "bulletin"("orgId", "weekStart");

-- CreateIndex
CREATE INDEX "bulletin_item_orgId_idx" ON "bulletin_item"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "bulletin_item_bulletinId_itemId_key" ON "bulletin_item"("bulletinId", "itemId");

-- CreateIndex
CREATE INDEX "feedback_orgId_idx" ON "feedback"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_userId_itemId_key" ON "feedback"("userId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "interest_profile_orgId_key" ON "interest_profile"("orgId");

-- CreateIndex
CREATE INDEX "deadline_orgId_dueAt_idx" ON "deadline"("orgId", "dueAt");

-- CreateIndex
CREATE INDEX "job_status_runAfter_idx" ON "job"("status", "runAfter");

-- CreateIndex
CREATE INDEX "job_dedupeKey_status_idx" ON "job"("dedupeKey", "status");

-- CreateIndex
CREATE INDEX "run_jobType_startedAt_idx" ON "run"("jobType", "startedAt");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_member" ADD CONSTRAINT "org_member_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_member" ADD CONSTRAINT "org_member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repo" ADD CONSTRAINT "repo_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dependency" ADD CONSTRAINT "dependency_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dependency" ADD CONSTRAINT "dependency_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dependency" ADD CONSTRAINT "dependency_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package" ADD CONSTRAINT "package_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source" ADD CONSTRAINT "source_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source" ADD CONSTRAINT "source_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item" ADD CONSTRAINT "item_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_match" ADD CONSTRAINT "item_match_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_match" ADD CONSTRAINT "item_match_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_match" ADD CONSTRAINT "item_match_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "package"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_match" ADD CONSTRAINT "item_match_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advisory" ADD CONSTRAINT "advisory_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert" ADD CONSTRAINT "alert_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert" ADD CONSTRAINT "alert_advisoryId_fkey" FOREIGN KEY ("advisoryId") REFERENCES "advisory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert" ADD CONSTRAINT "alert_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulletin" ADD CONSTRAINT "bulletin_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulletin_item" ADD CONSTRAINT "bulletin_item_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulletin_item" ADD CONSTRAINT "bulletin_item_bulletinId_fkey" FOREIGN KEY ("bulletinId") REFERENCES "bulletin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulletin_item" ADD CONSTRAINT "bulletin_item_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interest_profile" ADD CONSTRAINT "interest_profile_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deadline" ADD CONSTRAINT "deadline_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deadline" ADD CONSTRAINT "deadline_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run" ADD CONSTRAINT "run_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
