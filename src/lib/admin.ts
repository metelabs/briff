import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";

/** The first account bootstraps the instance and is its admin (web and worker share this). */
export async function findInstanceAdmin(
  db: PrismaClient
): Promise<{ id: string; email: string; deliveryEmail: string | null } | null> {
  return db.user.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, deliveryEmail: true },
  });
}
