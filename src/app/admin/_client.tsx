"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import {
  type AdminState,
  raiseOrgLimitsAction,
  runJobAction,
  sendTestEmailAction,
} from "./actions";

const INITIAL: AdminState = { ok: true, message: null };

function Status({ state }: { state: AdminState }) {
  if (!state.message) return null;
  return (
    <p
      role="status"
      className={state.ok ? "text-fg-muted text-[12.5px]" : "text-upgrade text-[12.5px]"}
    >
      {state.message}
    </p>
  );
}

export function JobButton({ type, label }: { type: string; label: string }) {
  const [state, action, pending] = useActionState(runJobAction, INITIAL);
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="type" value={type} />
      <Button type="submit" variant="secondary" disabled={pending} className="w-full justify-start">
        {label}
      </Button>
      <Status state={state} />
    </form>
  );
}

export function TestEmailButton() {
  const [state, action, pending] = useActionState(sendTestEmailAction, INITIAL);
  return (
    <form action={action} className="flex flex-col gap-1">
      <Button type="submit" variant="secondary" disabled={pending} className="w-full justify-start">
        Send test email
      </Button>
      <Status state={state} />
    </form>
  );
}

export function LimitsForm({
  org,
  meta,
}: {
  org: { id: string; name: string; repoLimit: number; streamLimit: number };
  /** One muted line under the name (usage against the limits). */
  meta?: string;
}) {
  const [state, action, pending] = useActionState(raiseOrgLimitsAction, {
    ok: true,
    message: null,
  } as import("./actions").LimitsState);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="orgId" value={org.id} />
      <p className="w-full text-[13px] font-medium">
        {org.name}
        {meta && (
          <span className="text-fg-muted mt-0.5 block text-[12.5px] font-normal tabular-nums">
            {meta}
          </span>
        )}
      </p>
      <label className="text-fg-muted text-[12px]">
        Repositories
        <input
          aria-label="Repository limit"
          className="border-line bg-surface mt-1 block w-28 rounded border p-2"
          type="number"
          name="repoLimit"
          min={org.repoLimit}
          defaultValue={state.repoLimit ?? org.repoLimit}
          required
        />
      </label>
      <label className="text-fg-muted text-[12px]">
        Streams
        <input
          aria-label="Stream limit"
          className="border-line bg-surface mt-1 block w-28 rounded border p-2"
          type="number"
          name="streamLimit"
          min={org.streamLimit}
          defaultValue={state.streamLimit ?? org.streamLimit}
          required
        />
      </label>
      <Button type="submit" disabled={pending}>
        Save limits
      </Button>
      <Status state={state} />
    </form>
  );
}
