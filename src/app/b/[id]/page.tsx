import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { BulletinContent, type FeedbackSlot } from "@/components/bulletin/bulletin-content";
import { AppShell } from "@/components/shell/app-shell";
import { MinimalHeader, PageContainer } from "@/components/shell/page-container";
import { getOrgContext } from "@/lib/auth/session";
import { bulletinHasItem, resolveBulletinAccess } from "@/lib/bulletin-access";
import { getDb } from "@/lib/db/client";
import { withOrg } from "@/lib/db/with-org";
import { strings } from "@/lib/i18n";
import { allItems, loadBulletinView } from "@/pipeline/bulletin-view";
import { recordFeedback } from "@/pipeline/feedback";

import { FeedbackButtons } from "./_client";

export const metadata: Metadata = { title: "Bulletin · Briff" };

type Kind = "up" | "down" | "less";
const FEEDBACK_PARAM = /^([A-Za-z0-9_-]{1,64}):(up|down|less)$/;

export default async function BulletinPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getOrgContext();
  const { id } = await params;
  const query = await searchParams;
  const token = typeof query.t === "string" ? query.t : null;

  const access = await resolveBulletinAccess(id, token);
  if (!access) {
    if (!ctx) redirect("/login");
    notFound();
  }
  const db = getDb();

  // One-click feedback from the email: sets (never toggles) the chosen kind.
  let feedbackNotice: "saved" | "invalid" | null = null;
  const fb = typeof query.fb === "string" ? FEEDBACK_PARAM.exec(query.fb) : null;
  if (typeof query.fb === "string") {
    feedbackNotice = "invalid";
    if (fb && (await bulletinHasItem(access.orgId, id, fb[1]))) {
      const res = await recordFeedback(db, {
        orgId: access.orgId,
        userId: access.userId,
        itemId: fb[1],
        kind: fb[2] as Kind,
        toggle: false,
      });
      if (res.ok) feedbackNotice = "saved";
    }
  }

  const view = await loadBulletinView(db, access.orgId, id);
  if (!view) notFound();
  const t = strings(view.language);
  const itemIds = allItems(view).map((i) => i.itemId);
  const rows = await withOrg(db, access.orgId).feedback.findMany({
    where: { userId: access.userId, itemId: { in: itemIds } },
    select: { itemId: true, kind: true },
  });
  const byItem = new Map<string, Kind>(rows.map((f) => [f.itemId, f.kind]));
  const labels: Record<Kind, string> = { up: t.fb_up, down: t.fb_down, less: t.fb_less };
  const feedback: FeedbackSlot = (itemId, className) => (
    <FeedbackButtons
      bulletinId={view.id}
      itemId={itemId}
      initial={byItem.get(itemId) ?? null}
      token={access.via === "token" ? token : null}
      labels={labels}
      className={className}
    />
  );
  const signedIn = Boolean(ctx && access.via === "session");

  const content = (
    <BulletinContent
      view={view}
      t={t}
      feedback={feedback}
      notice={feedbackNotice}
      signedIn={signedIn}
    />
  );

  if (ctx && access.via === "session") {
    return (
      <AppShell ctx={ctx} active="/bulletins">
        {content}
      </AppShell>
    );
  }
  // Opened from the email without a session: same page, minimal header.
  return (
    <div className="min-h-svh">
      <MinimalHeader />
      <PageContainer as="main" className="pb-16">
        {content}
      </PageContainer>
    </div>
  );
}
