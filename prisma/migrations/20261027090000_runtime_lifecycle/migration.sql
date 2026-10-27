CREATE TABLE "runtime_lifecycle" (
 "product" TEXT NOT NULL,
 "cycle" TEXT NOT NULL,
 "eol" JSONB NOT NULL,
 "latest" TEXT,
 "lts" JSONB,
 "support" JSONB,
 "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "runtime_lifecycle_pkey" PRIMARY KEY ("product", "cycle")
);
