import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { OG_IMAGE } from "@/components/landing/links";
import { PublicFooter, PublicHeader } from "@/components/landing/public-chrome";
import { ReplayMethod, ReplayTimeline, SampleRepos } from "@/components/replay/replay-timeline";
import { PageContainer } from "@/components/shell/page-container";
import { publicSiteUrl } from "@/lib/public-site";
import { isPublicReplayId, publicReplay, replayEmails } from "@/replay/public";
import { REPLAY_KICKER, replayEmailsSentence, replayHeading } from "@/replay/render";
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
  const result = publicReplay(id);
  const scenario = result.scenario;
  const emails = replayEmails(result).length;

  return (
    <div className="flex min-h-svh flex-col">
      <PublicHeader />
      <PageContainer as="main" className="pb-16">
        <header className="rise pt-7 pb-6">
          <p className="text-fg-muted text-[13px]">{REPLAY_KICKER}</p>
          <h1 className="type-page mt-2 mb-3 max-w-[30ch] text-balance">
            {replayHeading(scenario)}
          </h1>
          <p className="text-fg-muted max-w-[72ch] text-[15px]">
            {scenario.summary} {replayEmailsSentence(emails)}
          </p>
        </header>
        <div className="rise [--i:1]">
          <SampleRepos result={result} />
        </div>
        <ReplayTimeline result={result} />
        <ReplayMethod id={scenario.id} />
      </PageContainer>
      <PublicFooter />
    </div>
  );
}
