-- CreateEnum
CREATE TYPE "BulletinSection" AS ENUM ('act', 'know', 'rest');

-- CreateEnum
CREATE TYPE "TodoKind" AS ENUM ('upgrade', 'read', 'wait', 'ignore');

-- AlterTable
ALTER TABLE "bulletin_item" ADD COLUMN     "action" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "foldedItemIds" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "section" "BulletinSection",
ADD COLUMN     "todo" "TodoKind";


-- Vercel blog was matched through the Next.js service (and its "Vercel" name
-- mentions). Next.js and Vercel are separate services now; drop the stale matches
-- so untriaged posts never reach triage or a bulletin. New matches come from
-- collect-sources with the split mapping. Past bulletins keep their items.
DELETE FROM "item_match" m
USING "item" i, "source" s
WHERE m."itemId" = i."id"
  AND i."sourceId" = s."id"
  AND s."url" = 'https://vercel.com/atom'
  AND (m."reason" LIKE 'service:nextjs%' OR m."reason" LIKE 'trait:nextjs%');

DELETE FROM "item_match" WHERE "reason" = 'mention:nextjs';
