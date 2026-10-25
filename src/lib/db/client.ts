import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

// One client per process. Created lazily so importing this module during
// `next build` (no DATABASE_URL in CI) never opens a connection.
const globalForPrisma = globalThis as unknown as { briffPrisma?: PrismaClient };

export function getDb(): PrismaClient {
  if (globalForPrisma.briffPrisma) return globalForPrisma.briffPrisma;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  globalForPrisma.briffPrisma = client;
  return client;
}

export type Db = PrismaClient;
