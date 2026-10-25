import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // `prisma generate` runs at install/build time without a database; only
  // migrate commands need a real URL.
  datasource: { url: process.env.DATABASE_URL ?? "postgresql://build:build@localhost:5432/build" },
});
