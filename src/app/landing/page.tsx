import type { Metadata } from "next";

import { AlertRow } from "@/components/alerts/alert-row";
import { BulletinContent } from "@/components/bulletin/bulletin-content";
import { OG_IMAGE } from "@/components/landing/links";
import { PublicFooter, PublicHeader } from "@/components/landing/public-chrome";
import { RevealObserver } from "@/components/landing/reveal";
import { SAMPLE_BULLETIN } from "@/components/landing/sample-bulletin";
import { sampleAlerts, sampleStack } from "@/components/landing/sample-screens";
import { scannedFileList } from "@/components/landing/scanned-files";
import {
  CoverageStrip,
  FinalCta,
  Hero,
  HowSection,
  OpenSection,
  PricingTeaser,
  ShowcaseSection,
  TrustSection,
} from "@/components/landing/sections";
import { ShowcaseTabs } from "@/components/landing/showcase-tabs";
import { MailFrame } from "@/components/replay/mail-frame";
import { PageContainer } from "@/components/shell/page-container";
import { StackCards } from "@/app/stack/_client";
import { isCloud } from "@/lib/env";
import { strings } from "@/lib/i18n";
import { publicSiteUrl } from "@/lib/public-site";
import { delayLabel } from "@/replay/render";
import { PUBLIC_REPLAY_IDS, publicReplay, replayEmails, replayHighlights } from "@/replay/public";

// The public landing page. src/proxy.ts rewrites `/` here for a request without a session
// cookie; signed-in members keep the dashboard at `/`. It imports nothing that can read a
// session or the database (src/test/public-routes.test.ts walks its imports).
export const dynamic = "force-dynamic";

const TITLE = "Briff: your stack's weekly briefing, plus same-day security alerts";
const DESCRIPTION =
  "Weekly briefings and same-day security alerts for the packages, runtimes and base images your repos run. Briff reads lockfiles and manifests, never your source code.";

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

const INCIDENT = "php2shell";

export default function LandingPage() {
  const cloud = isCloud();
  const replays = PUBLIC_REPLAY_IDS.map((id) => publicReplay(id));
  const php2shell = publicReplay(INCIDENT);
  // The PHP2Shell replay's fix email: the hero's notification and the Alert email tab.
  const fixEmail = replayEmails(php2shell)
    .filter((m) => m.kind === "urgent")
    .at(-1);
  const fixHighlight = replayHighlights(php2shell).at(-1);
  if (!fixEmail || !fixHighlight)
    throw new Error("landing: the PHP2Shell replay lost its fix email");

  const t = strings(SAMPLE_BULLETIN.language);
  const tabs = [
    {
      id: "bulletin",
      label: "Bulletin",
      caption: "Every Monday: what needs you, with the command for each repo.",
      panel: (
        <div
          id="sample-bulletin"
          className="border-line bg-bg rounded-card overflow-hidden border px-[15px] pb-6 min-[560px]:px-6"
        >
          <BulletinContent
            view={SAMPLE_BULLETIN}
            t={t}
            feedback={null}
            notice={null}
            signedIn={false}
            headlineAs="h3"
          />
        </div>
      ),
    },
    {
      id: "email",
      label: "Alert email",
      caption: "The same-day email from the PHP2Shell replay, as it was sent.",
      panel: (
        <div className="mx-auto max-w-[760px]">
          <MailFrame subject={fixEmail.subject} html={fixEmail.html} className="bg-surface" />
        </div>
      ),
    },
    {
      id: "stack",
      label: "Stack",
      caption: "What every repo runs and what to move to, most urgent first.",
      panel: <StackCards cards={sampleStack()} repoLinks={false} />,
    },
    {
      id: "alerts",
      label: "Alerts",
      caption: "Open advisories per package, with the fix for each release line.",
      panel: (
        <div className="bg-surface border-line rounded-card overflow-hidden border">
          {sampleAlerts().map((g) => (
            <AlertRow key={g.packageName} group={g} />
          ))}
        </div>
      ),
    },
  ];

  return (
    <div className="flex min-h-svh flex-col">
      <RevealObserver />
      <PublicHeader pricing={cloud} />
      <PageContainer as="main">
        <Hero
          pricing={cloud}
          incident={{
            href: `/replay/${INCIDENT}`,
            delay: delayLabel(fixHighlight.email.delayMinutes),
            subject: fixHighlight.email.subject,
          }}
        />
        <TrustSection files={scannedFileList()} />
        <HowSection />
        <ShowcaseSection
          replays={replays.map((r) => ({ id: r.scenario.id, title: r.scenario.title }))}
        >
          <ShowcaseTabs tabs={tabs} />
        </ShowcaseSection>
        <CoverageStrip />
        <OpenSection />
        {cloud && <PricingTeaser />}
        <FinalCta incidentHref={`/replay/${INCIDENT}`} />
      </PageContainer>
      <PublicFooter pricing={cloud} />
    </div>
  );
}
