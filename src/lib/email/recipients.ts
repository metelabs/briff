import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { PRODUCT_LANGUAGE, type Language } from "@/lib/i18n";

import { receivesDelivery } from "./delivery-rule";

export interface Recipient {
  userId: string;
  to: string;
  language: Language;
}

/**
 * Org members who get bulletins and alerts, at their delivery address (else the account
 * email). Accounts unverified for over 7 days are left out (`receivesDelivery`).
 */
export async function orgRecipients(
  db: PrismaClient,
  orgId: string,
  now = new Date()
): Promise<Recipient[]> {
  const members = await withOrg(db, orgId).orgMember.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      user: {
        select: {
          id: true,
          email: true,
          deliveryEmail: true,
          emailVerified: true,
          createdAt: true,
        },
      },
    },
  });
  return members
    .filter(({ user }) => receivesDelivery(user, now))
    .map(({ user }) => ({
      userId: user.id,
      to: user.deliveryEmail ?? user.email,
      // English only for now (bulletin.md §15); User.language is kept for a later option.
      language: PRODUCT_LANGUAGE,
    }));
}
