-- The other ids of one vulnerability (OSV aliases) on its canonical advisory. Existing rows
-- keep NULL, which the next security scan reads as "stored before aliases were collapsed"
-- and refetches; that pass also merges duplicate rows and their alerts (src/security/scan.ts).

-- AlterTable
ALTER TABLE "advisory" ADD COLUMN     "aliases" JSONB;

-- CreateIndex
CREATE INDEX "advisory_aliases_idx" ON "advisory" USING GIN ("aliases");

