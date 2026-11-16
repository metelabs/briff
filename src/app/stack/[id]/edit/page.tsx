import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/section-header";
import { requireOrgContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { selectionsFromRows } from "@/lib/manual-stack";
import { loadManualStack } from "@/lib/manual-stack-store";

import { StackPicker } from "../../picker";
import { loadPickerData } from "../../picker-data";

export const metadata: Metadata = { title: "Edit stack · Briff" };

export default async function EditStackPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireOrgContext();
  const { id } = await params;
  const stack = await loadManualStack(getDb(), ctx.orgId, id);
  if (!stack) notFound();
  const data = await loadPickerData(ctx, stack.id);
  return (
    <AppShell ctx={ctx} active="/stack">
      <PageHeader
        eyebrow="Stack · picked by hand"
        title={stack.name}
        sub="Add or remove items and set versions. A version makes Briff check that exact release for advisories; without one, every release and advisory of the item reaches you."
      />
      <StackPicker
        {...data}
        mode="edit"
        stackId={stack.id}
        initialName={stack.name}
        initialItems={selectionsFromRows(
          stack.dependencies.map((d) => ({
            ecosystem: d.package.ecosystem,
            name: d.package.name,
            version: d.installedVersion,
          })),
          stack.runtimes
        )}
      />
    </AppShell>
  );
}
