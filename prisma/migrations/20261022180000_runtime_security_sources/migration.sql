-- CreateEnum
CREATE TYPE "SourceClass" AS ENUM ('security', 'releases', 'news');

-- AlterEnum
ALTER TYPE "SourceKind" ADD VALUE 'github_advisories';

-- AlterTable
ALTER TABLE "item" ADD COLUMN     "metadata" JSONB;

-- AlterTable
ALTER TABLE "item_match" ADD COLUMN     "urgentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "source" ADD COLUMN     "class" "SourceClass" NOT NULL DEFAULT 'news';

