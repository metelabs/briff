import type { Metadata } from "next";

import { OG_IMAGE } from "@/components/landing/links";
import { PublicFooter, PublicHeader } from "@/components/landing/public-chrome";
import { SAMPLE_BULLETIN } from "@/components/landing/sample-bulletin";
import { scannedFileList } from "@/components/landing/scanned-files";
import {
  Hero,
  CoverageSection,
  PrivacySection,
  ReadsSection,
  ReplaysSection,
  SampleSection,
  type ReplayCardData,
} from "@/components/landing/sections";
import { PageContainer } from "@/components/shell/page-container";
import { isCloud } from "@/lib/env";
import { publicSiteUrl } from "@/lib/public-site";
import { delayLabel, summaryParts } from "@/replay/render";
import { PUBLIC_REPLAY_IDS, publicReplay, replayEmails, replayHighlights } from "@/replay/public";

// The public landing page. src/proxy.ts rewrites `/` here for a request without a session
// cookie; signed-in members keep the dashboard at `/`. It imports nothing that can read a
// session or the database (src/test/public-routes.test.ts walks its imports).
export const dynamic = "force-dynamic";

const TITLE = "Briff: what changed in your stack this week, and security fixes the same day";
const DESCRIPTION =
  "Weekly briefings and same-day security alerts for package ecosystems from npm to Hex, GitHub Actions, runtimes and Docker base images. Open sign-up.";

export function generateMetadata(): Metadata {
  return {
    metadataBase: new URL(publicSiteUrl()),
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: "/" },
    openGraph: {
      title: TITLE,
      description: DESCRIPTION,
      url: "/",
      siteName: "Briff",
      type: "website",
      images: [OG_IMAGE],
    },
    twitter: { card: "summary_large_image", images: [OG_IMAGE.url] },
    robots: { index: true, follow: true },
  };
}

export default function LandingPage() {
  const cloud = isCloud();
  const replays = PUBLIC_REPLAY_IDS.map((id) => publicReplay(id));
  const cards: ReplayCardData[] = replays.map((r) => ({
    id: r.scenario.id,
    title: r.scenario.title,
    lead: summaryParts(r.scenario.summary).lead,
    emails: replayEmails(r).length,
    highlights: replayHighlights(r),
  }));

  // The sample: a static Monday bulletin (sample-bulletin.ts) and the PHP2Shell replay's fix email.
  const fixEmail = replayEmails(publicReplay("php2shell"))
    .filter((m) => m.kind === "urgent")
    .at(-1);
  if (!fixEmail) throw new Error("landing: the PHP2Shell replay lost its fix email");

  const files = scannedFileList();
  const fileCount = files.names.length + files.patterns.length;
  const [phpFix, nodeFix] = cards.map((c) => c.highlights.at(-1));
  const stats = [
    phpFix && {
      value: delayLabel(phpFix.email.delayMinutes),
      caption: "PHP2Shell: from the php-src advisories to Briff's fix email",
      href: "/replay/php2shell",
      security: true,
    },
    nodeFix && {
      value: delayLabel(nodeFix.email.delayMinutes),
      caption: "Node.js, October 2026: from the release post to the fix email",
      href: "/replay/node-oct-2026",
      security: true,
    },
    {
      value: String(fileCount),
      caption: "file names and patterns it reads. No source code.",
      href: "#reads",
      security: false,
    },
  ].filter((s) => s !== undefined);

  return (
    <div className="flex min-h-svh flex-col">
      <PublicHeader pricing={cloud} />
      <PageContainer as="main">
        <Hero stats={stats} pricing={cloud} />
        <ReplaysSection cards={cards} />
        <CoverageSection />
        <ReadsSection files={files} apiUrl={publicSiteUrl()} />
        <SampleSection view={SAMPLE_BULLETIN} alert={fixEmail} replayId="php2shell" />
        <PrivacySection />
      </PageContainer>
      <PublicFooter pricing={cloud} />
    </div>
  );
}
