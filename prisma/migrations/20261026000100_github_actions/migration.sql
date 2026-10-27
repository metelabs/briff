ALTER TABLE "dependency" ADD COLUMN "constraint" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "metadata" JSONB;
ALTER TABLE "package" ADD COLUMN "actionTags" JSONB;
