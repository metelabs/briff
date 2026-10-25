-- AlterTable
ALTER TABLE "repo" ADD COLUMN     "githubHeadSha" TEXT,
ADD COLUMN     "githubInstallationId" TEXT;

-- CreateTable
CREATE TABLE "github_installation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "accountLogin" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "suspendedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "github_installation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "github_installation_installationId_key" ON "github_installation"("installationId");

-- CreateIndex
CREATE INDEX "github_installation_orgId_idx" ON "github_installation"("orgId");

-- AddForeignKey
ALTER TABLE "github_installation" ADD CONSTRAINT "github_installation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repo" ADD CONSTRAINT "repo_githubInstallationId_fkey" FOREIGN KEY ("githubInstallationId") REFERENCES "github_installation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

