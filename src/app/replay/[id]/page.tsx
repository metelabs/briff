import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { OG_IMAGE } from "@/components/landing/links";
import { PublicFooter, PublicHeader } from "@/components/landing/public-chrome";
import {
  OutcomeTable,
  ReplayEmailStyles,
  ReplayHero,
  ReplayLayout,
  ReplayMethod,
  ReplayOverview,
  ReplayTimeline,
  SampleRepos,
} from "@/components/replay/replay-timeline";
import { PageContainer } from "@/components/shell/page-container";
import { isCloud } from "@/lib/env";
import { publicSiteUrl } from "@/lib/public-site";
import { isPublicReplayId, publicReplay } from "@/replay/public";
import { replayHeading } from "@/replay/render";
import { SCENARIOS } from "@/replay/scenarios";

// Public: no session, no tenant data. The replay runs the pure pipeline over committed
// fixtures once per process (publicReplay). Rendered per request like every route: the root
// layout reads the theme cookie, and the metadata reads the site URL from the env.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const scenario = SCENARIOS[id];
  if (!scenario || !isPublicReplayId(id)) return {};
  const title = `${replayHeading(scenario)} · Briff`;
  const description = `What Briff would have sent during ${scenario.title}: the real dated items, sample repos, the real email templates.`;
  return {
    metadataBase: new URL(publicSiteUrl()),
    title,
    description,
    alternates: { canonical: `/replay/${id}` },
    openGraph: {
      title,
      description,
      url: `/replay/${id}`,
      siteName: "Briff",
      type: "article",
      images: [OG_IMAGE],
    },
    twitter: { card: "summary_large_image", images: [OG_IMAGE.url] },
    robots: { index: true, follow: true },
  };
}

export default async function ReplayPage({ params }: Params) {
  const { id } = await params;
  if (!isPublicReplayId(id)) notFound();
  const cloud = isCloud();
  const result = publicReplay(id);

  return (
    <div className="flex min-h-svh flex-col">
      <ReplayEmailStyles />
      <PublicHeader pricing={cloud} />
      <PageContainer as="main" className="pb-16">
        <ReplayHero result={result} />
        <ReplayLayout result={result}>
          <ReplayOverview result={result} />
          <SampleRepos result={result} />
          <ReplayTimeline result={result} />
          <OutcomeTable result={result} />
          <ReplayMethod id={result.scenario.id} />
        </ReplayLayout>
      </PageContainer>
      <PublicFooter pricing={cloud} />
    </div>
  );
}
