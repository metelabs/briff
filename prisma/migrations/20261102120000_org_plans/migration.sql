-- Plans (src/lib/plans.ts). Every existing org starts on Free, the plan whose limits (10 repos,
-- 2 streams) were the column defaults until now.
CREATE TYPE "OrgPlan" AS ENUM ('free', 'pro', 'team', 'unlimited');

ALTER TABLE "org" ADD COLUMN "plan" "OrgPlan" NOT NULL DEFAULT 'free',
ADD COLUMN "planUpdatedAt" TIMESTAMP(3);

-- repoLimit / streamLimit become the instance admin's overrides: NULL means "the plan's limit",
-- a value counts only where it is above it (limitsFor takes the larger of the two). The
-- existing CHECK (> 0) constraints stay and accept NULL.
ALTER TABLE "org" ALTER COLUMN "repoLimit" DROP NOT NULL,
ALTER COLUMN "repoLimit" DROP DEFAULT,
ALTER COLUMN "streamLimit" DROP NOT NULL,
ALTER COLUMN "streamLimit" DROP DEFAULT;

-- Data: a value equal to the old default (10 repos, 2 streams) was never chosen by the admin,
-- so it becomes NULL and follows the plan from now on. Any other value was set in Admin → Edit
-- limits (which could only raise them) and is kept as that org's override. Each column is
-- cleared on its own: an org raised to 50 repos keeps repoLimit = 50 and gets streamLimit = NULL.
-- On Free every org keeps exactly the limits it had: max(10, NULL) = 10, max(10, 50) = 50.
UPDATE "org" SET "repoLimit" = NULL WHERE "repoLimit" = 10;
UPDATE "org" SET "streamLimit" = NULL WHERE "streamLimit" = 2;
