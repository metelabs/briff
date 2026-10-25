-- AlterTable
ALTER TABLE "source" ADD COLUMN     "runtime" TEXT;

-- CreateTable
CREATE TABLE "repo_runtime" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "normalized" TEXT,
    "source" TEXT NOT NULL,
    "unresolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repo_runtime_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "repo_runtime_orgId_name_idx" ON "repo_runtime"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "repo_runtime_repoId_name_source_version_key" ON "repo_runtime"("repoId", "name", "source", "version");

-- AddForeignKey
ALTER TABLE "repo_runtime" ADD CONSTRAINT "repo_runtime_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repo_runtime" ADD CONSTRAINT "repo_runtime_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

