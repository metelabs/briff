-- AlterTable
ALTER TABLE "dependency" ADD COLUMN     "group" TEXT,
ADD COLUMN     "manager" TEXT,
ADD COLUMN     "project" TEXT,
ADD COLUMN     "requirement" TEXT,
ADD COLUMN     "unresolved" BOOLEAN NOT NULL DEFAULT false;
