-- AlterTable
ALTER TABLE "advisory" ADD COLUMN     "packages" JSONB;

-- AlterTable
ALTER TABLE "alert" ADD COLUMN     "resolvedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "org" ADD COLUMN     "recheckRequestedAt" TIMESTAMP(3);

