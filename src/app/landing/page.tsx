import type { Metadata } from "next";

import { OG_IMAGE } from "@/components/landing/links";
import { PublicFooter, PublicHeader } from "@/components/landing/public-chrome";
import { scannedFileList } from "@/components/landing/scanned-files";
import {
  Hero,
  PrivacySection,
  ReadsSection,
  ReplaysSection,
  SampleSection,
  type ReplayCardData,
} from "@/components/landing/sections";
import { PageContainer } from "@/components/shell/page-container";
import { publicSiteUrl } from "@/lib/public-site";
import { delayLabel } from "@/replay/render";
import { PUBLIC_REPLAY_IDS, publicReplay, replayEmails, replayHighlights } from "@/replay/public";

// The public landing page. src/proxy.ts rewrites `/` here for a request without a session
// cookie; signed-in members keep the dashboard at `/`. It imports nothing that can read a
// session or the database (src/test/public-routes.test.ts walks its imports).
export const dynamic = "force-dynamic";

const TITLE = "Briff: what changed in your stack this week, and security fixes the same day";
const DESCRIPTION =
  "A weekly briefing of what changed in the packages and runtimes your repos actually run, and a same-day email when a security fix lands for one of them.";

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

/** First sentence of a scenario summary, for the card. */
function lead(summary: string): string {
  const end = summary.indexOf(". ");
  return end === -1 ? summary : summary.slice(0, end + 1);
}

export default function LandingPage() {
  const replays = PUBLIC_REPLAY_IDS.map((id) => publicReplay(id));
  const cards: ReplayCardData[] = replays.map((r) => ({
    id: r.scenario.id,
    title: r.scenario.title,
    lead: lead(r.scenario.summary),
    emails: replayEmails(r).length,
    highlights: replayHighlights(r),
  }));

  // The sample is the PHP2Shell replay: its fix email and the Monday bulletin after it.
  const php = replayEmails(publicReplay("php2shell"));
  const weekly = php.find((m) => m.kind === "weekly" && m.view);
  const fixEmail = php.filter((m) => m.kind === "urgent").at(-1);
  if (!weekly?.view || !fixEmail) throw new Error("landing: the PHP2Shell replay lost its emails");

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
      <PublicHeader />
      <PageContainer as="main">
        <Hero stats={stats} />
        <ReplaysSection cards={cards} />
        <ReadsSection files={files} apiUrl={publicSiteUrl()} />
        <SampleSection view={weekly.view} alert={fixEmail} replayId="php2shell" />
        <PrivacySection />
      </PageContainer>
      <PublicFooter />
    </div>
  );
}
