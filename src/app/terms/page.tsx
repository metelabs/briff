import type { Metadata } from "next";

import { TERMS } from "@/components/legal/terms";
import { LegalPage } from "@/components/legal/legal-page";
import { legalMetadata } from "@/components/legal/metadata";

// Public (docs/LANDING.md): no session, no tenant data; per request for the site URL.
export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return legalMetadata(
    TERMS,
    "The terms for the hosted Briff service: accounts, acceptable use, plans and billing through Paddle, refunds, liability."
  );
}

export default function TermsPage() {
  return <LegalPage doc={TERMS} />;
}
