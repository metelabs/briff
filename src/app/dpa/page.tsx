import type { Metadata } from "next";

import { DPA } from "@/components/legal/dpa";
import { LegalPage } from "@/components/legal/legal-page";
import { legalMetadata } from "@/components/legal/metadata";

// Public (docs/LANDING.md): no session, no tenant data; per request for the site URL.
export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return legalMetadata(
    DPA,
    "Summary of how Briff processes your organisation's data as a processor, and how to request a signed DPA."
  );
}

export default function DpaPage() {
  return <LegalPage doc={DPA} />;
}
