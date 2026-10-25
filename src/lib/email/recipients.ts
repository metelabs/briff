import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { PRODUCT_LANGUAGE, type Language } from "@/lib/i18n";

export interface Recipient {
  userId: string;
  to: string;
  language: Language;
}

/** Every org member, at their delivery address (else the account email). */
export async function orgRecipients(db: PrismaClient, orgId: string): Promise<Recipient[]> {
  const members = await withOrg(db, orgId).orgMember.findMany({
    orderBy: { createdAt: "asc" },
    select: { user: { select: { id: true, email: true, deliveryEmail: true } } },
  });
  return members.map(({ user }) => ({
    userId: user.id,
    to: user.deliveryEmail ?? user.email,
    // English only for now (bulletin.md §15); User.language is kept for a later option.
    language: PRODUCT_LANGUAGE,
  }));
}
