ALTER TABLE "org" ADD COLUMN "repoLimit" INTEGER NOT NULL DEFAULT 10,
 ADD COLUMN "streamLimit" INTEGER NOT NULL DEFAULT 2,
 ADD COLUMN "githubRepoLimitReached" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "org" ADD CONSTRAINT "org_repoLimit_positive" CHECK ("repoLimit" > 0),
 ADD CONSTRAINT "org_streamLimit_positive" CHECK ("streamLimit" > 0);
