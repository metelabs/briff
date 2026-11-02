"use client";

import { useActionState, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog, DialogClose, FormDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FieldHelp, FormStatus, Label } from "@/components/ui/label";
import { SecretBox } from "@/components/ui/secret-box";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Tag } from "@/components/ui/tag";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import {
  createDeliveryTargetAction,
  deleteDeliveryTargetAction,
  sendTestDeliveryAction,
  setDeliveryTargetEnabledAction,
  type TargetFormState,
} from "./integration-actions";

export interface TargetRow {
  id: string;
  kind: "slack" | "webhook";
  urlLabel: string;
  streamName: string | null;
  bulletin: boolean;
  alert: boolean;
  enabled: boolean;
  signed: boolean;
  lastDelivered: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
}

const KIND_LABEL = { slack: "Slack", webhook: "Webhook" } as const;

function events(t: Pick<TargetRow, "bulletin" | "alert">): string {
  if (t.bulletin && t.alert) return "bulletins and security alerts";
  return t.bulletin ? "bulletins" : "security alerts";
}

export function TargetList({
  targets,
  canManage,
  paused,
}: {
  targets: TargetRow[];
  canManage: boolean;
  /** The plan no longer includes integrations: rows are kept, nothing is sent. */
  paused: boolean;
}) {
  if (targets.length === 0) {
    return <p className="text-fg-muted text-[13.5px]">No integrations yet.</p>;
  }
  return (
    <ul>
      {targets.map((t) => (
        <li
          key={t.id}
          className="border-line flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t py-2.5 first:border-t-0"
        >
          <div
            className={cn("min-w-0 flex-1 basis-[260px]", (!t.enabled || paused) && "opacity-70")}
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Tag kind={t.kind === "slack" ? "brand" : "read"}>{KIND_LABEL[t.kind]}</Tag>
              <code className="font-mono text-[12.5px] break-all">{t.urlLabel}</code>
              {!t.enabled && <Tag kind="wait">Off</Tag>}
              {t.enabled && paused && <Tag kind="wait">Paused</Tag>}
            </div>
            <small className="text-fg-muted block text-[12.5px]">
              {t.streamName ?? "All streams"} · {events(t)}
              {t.kind === "webhook" && (t.signed ? " · signed" : " · unsigned")}
              {" · "}
              {t.lastDelivered ? `last delivered ${t.lastDelivered}` : "nothing delivered yet"}
            </small>
            {t.lastError && (
              <small className="text-upgrade block text-[12.5px] [overflow-wrap:anywhere]">
                Last error{t.lastErrorAt ? ` ${t.lastErrorAt}` : ""}: {t.lastError}
              </small>
            )}
          </div>
          {canManage && <TargetActions target={t} paused={paused} />}
        </li>
      ))}
    </ul>
  );
}

function TargetActions({ target, paused }: { target: TargetRow; paused: boolean }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const run = (fn: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => {
      const res = await fn();
      toast(res.message, res.ok ? "ok" : "error");
    });
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {!paused && target.enabled && (
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => run(() => sendTestDeliveryAction(target.id))}
        >
          Send test
        </Button>
      )}
      {(!paused || target.enabled) && (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => run(() => setDeliveryTargetEnabledAction(target.id, !target.enabled))}
        >
          {target.enabled ? "Turn off" : "Turn on"}
        </Button>
      )}
      <ConfirmDialog
        trigger={
          <Button variant="ghost" size="sm" disabled={pending}>
            Remove
          </Button>
        }
        title="Remove this integration?"
        description={
          <>
            {KIND_LABEL[target.kind]} <b className="font-medium">{target.urlLabel}</b> gets nothing
            from Briff from now on.
          </>
        }
        confirmLabel="Remove"
        pending={pending}
        onConfirm={() => run(() => deleteDeliveryTargetAction(target.id))}
      />
    </div>
  );
}

const FORM_INITIAL: TargetFormState = { ok: true, message: null };

export function NewTargetButton({ streams }: { streams: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [round, setRound] = useState(0);
  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (next) setRound((r) => r + 1);
        setOpen(next);
      }}
      trigger={<Button variant="secondary">Add integration</Button>}
      title="Add integration"
      description="Briff posts each weekly bulletin and the same-day security alerts here."
    >
      <NewTargetForm key={round} streams={streams} onDone={() => setOpen(false)} />
    </FormDialog>
  );
}

function NewTargetForm({
  streams,
  onDone,
}: {
  streams: { id: string; name: string }[];
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(createDeliveryTargetAction, FORM_INITIAL);
  const saved = state.values;
  const [kind, setKind] = useState<"slack" | "webhook">(
    saved?.kind === "webhook" ? "webhook" : "slack"
  );
  const [streamId, setStreamId] = useState(saved?.streamId ?? "");
  const [bulletin, setBulletin] = useState(saved?.bulletin ?? true);
  const [alert, setAlert] = useState(saved?.alert ?? true);

  if (state.ok && state.urlLabel) {
    return (
      <div className="grid gap-3">
        <p className="text-[13.5px]">
          <b className="font-medium">{state.urlLabel}</b> is added. Use{" "}
          <span className="font-medium">Send test</span> in the list to check it.
        </p>
        {state.secret && (
          <>
            <p className="text-[13.5px]">
              Verify the <code className="font-mono text-[12.5px]">X-Briff-Signature</code> header
              with this signing secret (docs: Integrations).
            </p>
            <SecretBox
              secret={state.secret}
              note="Copy it now. It will not be shown again; remove and re-add the webhook to get a new one."
            />
          </>
        )}
        <div className="flex justify-end">
          <Button variant="primary" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="bulletin" value={bulletin ? "on" : ""} />
      <input type="hidden" name="alert" value={alert ? "on" : ""} />
      <Segmented
        label="Kind"
        value={kind}
        onChange={setKind}
        options={[
          { value: "slack", label: "Slack" },
          { value: "webhook", label: "Webhook" },
        ]}
      />
      <div className="grid gap-1.5">
        <Label htmlFor="target-url">{kind === "slack" ? "Incoming webhook URL" : "URL"}</Label>
        <Input
          id="target-url"
          name="url"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder={
            kind === "slack"
              ? "https://hooks.slack.com/services/…"
              : "https://example.com/hooks/briff"
          }
          defaultValue={saved?.url ?? ""}
          required
          autoFocus
        />
        <FieldHelp>
          {kind === "slack"
            ? "In Slack: Apps → Incoming WebHooks → Add to a channel, then copy the URL."
            : "Briff POSTs JSON, signed with a secret it shows once. Public https URLs only."}
        </FieldHelp>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="target-stream">Stream</Label>
        <Select
          id="target-stream"
          name="streamId"
          value={streamId}
          onValueChange={setStreamId}
          options={[
            { value: "", label: "All streams" },
            ...streams.map((s) => ({ value: s.id, label: s.name })),
          ]}
        />
      </div>
      <fieldset className="grid gap-2">
        <legend className="text-fg mb-1.5 text-[13px] font-medium">Send</legend>
        <label className="flex items-center gap-2 text-[13.5px]">
          <Checkbox checked={bulletin} onCheckedChange={setBulletin} />
          Weekly bulletin
        </label>
        <label className="flex items-center gap-2 text-[13.5px]">
          <Checkbox checked={alert} onCheckedChange={setAlert} />
          Same-day security alerts (critical and high)
        </label>
      </fieldset>
      <FormStatus ok={state.ok} message={state.message} />
      <div className="mt-1 flex flex-wrap justify-end gap-2">
        <DialogClose render={<Button variant="secondary">Cancel</Button>} />
        <Button type="submit" variant="primary" disabled={pending || (!bulletin && !alert)}>
          Add integration
        </Button>
      </div>
    </form>
  );
}
