-- AlterTable
-- Nullable on purpose: rows stored before the flag stay null and readers derive it from the
-- version text (isConstraintRow, packages/scan/src/runtimes.ts); the next scan writes it.
ALTER TABLE "repo_runtime" ADD COLUMN     "isConstraint" BOOLEAN;
