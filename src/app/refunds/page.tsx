import type { Metadata } from "next";

import { REFUNDS } from "@/components/legal/refunds";
import { LegalPage } from "@/components/legal/legal-page";
import { legalMetadata } from "@/components/legal/metadata";

// Public (docs/LANDING.md): no session, no tenant data; per request for the site URL.
export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return legalMetadata(
    REFUNDS,
    "Refunds for paid Briff plans: 14 days on a first payment, the rest under Paddle's buyer terms."
  );
}

export default function RefundsPage() {
  return <LegalPage doc={REFUNDS} />;
}
