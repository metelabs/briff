import type { Metadata } from "next";

import { PRIVACY } from "@/components/legal/privacy";
import { LegalPage } from "@/components/legal/legal-page";
import { legalMetadata } from "@/components/legal/metadata";

// Public (docs/LANDING.md): no session, no tenant data; per request for the site URL.
export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return legalMetadata(
    PRIVACY,
    "What Briff collects, why, who processes it, how long it is kept, and how to export or delete it."
  );
}

export default function PrivacyPage() {
  return <LegalPage doc={PRIVACY} />;
}
