"use client";

import { useActionState, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";

import {
  type AdminState,
  raiseOrgLimitsAction,
  deletePreviewAction,
  previewSynthesisAction,
  type PreviewState,
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

const SELECT_CLASS =
  "border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 h-8 w-full min-w-0 rounded-lg border bg-transparent px-2 text-base outline-none focus-visible:ring-3 md:text-[13.5px]";

export function PreviewForm({
  streams,
  models,
}: {
  streams: { id: string; name: string }[];
  models: readonly string[];
}) {
  const [state, action, pending] = useActionState<PreviewState, FormData>(
    previewSynthesisAction,
    INITIAL
  );
  const streamId = state.streamId ?? streams[0]?.id ?? "";
  const model = state.model ?? models[0] ?? "";
  return (
    <form
      // A <select> ignores a new defaultValue; remount with the values just submitted.
      key={`${streamId}:${model}`}
      action={action}
      className="flex flex-col gap-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[13.5px]">
          <span className="font-medium">Stream</span>
          <select name="streamId" defaultValue={streamId} className={SELECT_CLASS}>
            {streams.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13.5px]">
          <span className="font-medium">Model</span>
          <select name="model" defaultValue={model} className={SELECT_CLASS}>
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Button
        type="submit"
        variant="secondary"
        disabled={pending || streams.length === 0}
        className="w-full justify-start sm:w-auto sm:self-start"
      >
        Preview synthesis
      </Button>
      <Status state={state} />
    </form>
  );
}

export function DeletePreviewButton({ id, label }: { id: string; label: string }) {
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      <ConfirmDialog
        trigger={
          <Button variant="ghost" size="sm" disabled={pending} aria-label={`Delete ${label}`}>
            Delete
          </Button>
        }
        title="Delete this preview?"
        description={`${label} was never emailed; deleting it leaves the week's bulletin alone.`}
        confirmLabel="Delete preview"
        pending={pending}
        onConfirm={() =>
          start(async () => {
            const res = await deletePreviewAction(id);
            setFailed(!res.ok);
          })
        }
      />
      {failed && <span className="text-upgrade text-[12.5px]">Could not delete.</span>}
    </span>
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
}: {
  org: { id: string; name: string; repoLimit: number; streamLimit: number };
}) {
  const [state, action, pending] = useActionState(raiseOrgLimitsAction, {
    ok: true,
    message: null,
  } as import("./actions").LimitsState);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="orgId" value={org.id} />
      <p className="w-full text-[13px] font-medium">{org.name}</p>
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
