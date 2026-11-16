import type { Metadata } from "next";

import { SignOutLink } from "@/app/onboarding/_client";
import { AppShell } from "@/components/shell/app-shell";
import { MinimalHeader } from "@/components/shell/page-container";
import { PageHeader } from "@/components/ui/section-header";
import { requireOrgContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { withOrg } from "@/lib/db/with-org";
import { DEFAULT_STACK_NAME } from "@/lib/manual-stack";
import { shouldOnboard } from "@/lib/member-state";

import { StackPicker } from "../picker";
import { loadPickerData } from "../picker-data";

export const metadata: Metadata = { title: "Pick your stack · Briff" };

const SUB =
  "Pick the runtimes, packages and tools your projects use. Briff watches their releases and security advisories, without access to your code.";

export default async function NewStackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireOrgContext();
  const query = await searchParams;
  const db = getDb();
  const onboarding = query.first === "1" && (await shouldOnboard(db, ctx.orgId, ctx.userId));
  const [data, taken] = await Promise.all([
    loadPickerData(ctx, null),
    withOrg(db, ctx.orgId).repo.count({
      where: { source: "manual", name: { startsWith: DEFAULT_STACK_NAME } },
    }),
  ]);
  const picker = (
    <StackPicker
      {...data}
      mode={onboarding ? "onboarding" : "new"}
      stackId={null}
      initialName={taken === 0 ? DEFAULT_STACK_NAME : `${DEFAULT_STACK_NAME} ${taken + 1}`}
      initialItems={[]}
    />
  );

  if (onboarding) {
    return (
      <div className="min-h-svh">
        <MinimalHeader>
          <SignOutLink />
        </MinimalHeader>
        <main className="gutter mx-auto w-full max-w-[1200px] pb-20">
          <PageHeader eyebrow="Step 2 of 3 · Connect repos" title="Pick your stack" sub={SUB} />
          {picker}
        </main>
      </div>
    );
  }
  return (
    <AppShell ctx={ctx} active="/stack">
      <PageHeader eyebrow="Stack" title="Pick a stack" sub={SUB} />
      {picker}
    </AppShell>
  );
}
