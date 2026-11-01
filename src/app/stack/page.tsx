import { Layers } from "lucide-react";
import type { Metadata } from "next";

import { AppShell } from "@/components/shell/app-shell";
import { ConnectReposButton } from "@/components/shell/connect-sheet";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/section-header";
import { requireOrgContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { plural, shortDateTime } from "@/lib/format";
import { loadDrift } from "@/lib/stack-load";
import { loadStreamScope, repoScope } from "@/lib/stream-scope";
import { loadUnfixedDistros } from "@/security/base-image-view";

import { StackCards } from "./_client";

export const metadata: Metadata = { title: "Stack · Briff" };

export default async function StackPage() {
  const ctx = await requireOrgContext();
  const scope = await loadStreamScope(ctx.orgId);
  const [{ repos, drift }, unfixed] = await Promise.all([
    loadDrift(ctx.orgId, scope),
    loadUnfixedDistros(getDb(), ctx.orgId, repoScope(scope)),
  ]);

  return (
    <AppShell ctx={ctx} active="/stack">
      <PageHeader
        eyebrow={`${plural(repos.length, "repo")} · ${scope.current?.name ?? "all streams"}`}
        title="Stack"
        sub="What every repo runs and what to move to, most urgent first. Runtimes come from package files, Dockerfiles and compose files; key packages are the direct dependencies most of your repos share."
      />
      {repos.length === 0 || drift.every((r) => r.entries.length === 0) ? (
        <Card className="rise [--i:1]">
          <EmptyState
            icon={<Layers strokeWidth={1.4} />}
            title={repos.length === 0 ? "Nothing scanned yet" : "No runtime data yet"}
            action={<ConnectReposButton />}
          >
            {repos.length === 0
              ? "Once this stream has scanned repos, each one appears here with its runtimes and key packages, and what to move to."
              : "No scan has reported a runtime or package for these repos yet. Connect a repo or run the scanner, and each one appears here with what to move to."}
          </EmptyState>
        </Card>
      ) : (
        <StackCards
          cards={drift.map(({ lastScannedAt, ...card }) => ({
            ...card,
            lastScan: lastScannedAt ? shortDateTime(lastScannedAt) : "never",
          }))}
        />
      )}
      {unfixed.map((d) => (
        <p key={d.distro} className="text-fg-muted mt-3 text-[13px]">
          {d.distro}: {plural(d.unfixed, "known unfixed issue")} in the watched base packages. No
          fix is published for this release yet, so rebuilding does not help.
        </p>
      ))}
    </AppShell>
  );
}
