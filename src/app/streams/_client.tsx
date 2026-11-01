"use client";

import { Search } from "lucide-react";
import { useActionState, useState, useTransition, type CSSProperties } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog, DialogClose, FormDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FieldHelp, FormStatus, Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { TruncatedText } from "@/components/ui/tooltip";
import { plural } from "@/lib/format";
import { STREAM_NAME_MAX } from "@/lib/streams";
import { cn } from "@/lib/utils";

import {
  createStreamAction,
  deleteStreamAction,
  renameStreamAction,
  saveStreamReposAction,
  type StreamFormState,
} from "./actions";

const INITIAL: StreamFormState = { ok: true, message: null };

export interface StreamSummary {
  id: string;
  name: string;
  memberIds: string[];
  /** "W43 · 3 attention" for the latest bulletin; null before the first one. */
  last: string | null;
}

export function NewStreamButton() {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const [state, action, pending] = useActionState(async (prev: StreamFormState, form: FormData) => {
    const res = await createStreamAction(prev, form);
    if (res.ok) {
      setOpen(false);
      if (res.message) toast(res.message);
    }
    return res;
  }, INITIAL);
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={<Button variant="primary">New stream</Button>}
      title="New stream"
      description="A stream gets its own bulletin. You pick its repos next."
    >
      <form action={action} className="grid gap-1.5">
        <Label htmlFor="new-stream">Name</Label>
        <Input
          id="new-stream"
          name="name"
          placeholder="e.g. Client sites"
          maxLength={STREAM_NAME_MAX}
          required
          autoFocus
        />
        <FieldHelp>Shown in the email subject.</FieldHelp>
        {!state.ok && <FormStatus ok={false} message={state.message} />}
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <DialogClose render={<Button variant="secondary">Cancel</Button>} />
          <Button type="submit" variant="primary" disabled={pending}>
            Create stream
          </Button>
        </div>
      </form>
    </FormDialog>
  );
}

export function StreamsEditor({
  streams,
  repos,
  recipients,
  initialId,
}: {
  streams: StreamSummary[];
  repos: { id: string; name: string }[];
  recipients: string;
  initialId: string | null;
}) {
  const [selectedId, setSelectedId] = useState(initialId);
  const selected = streams.find((s) => s.id === selectedId) ?? streams[0] ?? null;

  if (!selected) {
    return (
      <Card className="text-fg-muted rise px-[18px] py-5 [--i:1]">
        No streams yet. Create one to start getting bulletins.
      </Card>
    );
  }
  return (
    <div className="grid items-start gap-[18px] min-[980px]:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="grid gap-3">
        {streams.map((s, i) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={s.id === selected.id}
            onClick={() => setSelectedId(s.id)}
            style={{ "--i": i + 1 } as CSSProperties}
            className={cn(
              "rise bg-surface border-line hover:shadow-raised rounded-card block w-full border p-[18px] text-left transition-[border-color,box-shadow] duration-200",
              s.id === selected.id && "border-brand shadow-[0_0_0_3px_var(--brand-soft)]"
            )}
          >
            <h3 className="type-h3 flex items-center gap-2">
              <i aria-hidden className="bg-brand size-[9px] shrink-0 rounded-full" />
              {s.name}
            </h3>
            <dl className="mt-3.5 grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1.5 text-[13px]">
              <dt className="text-fg-muted">Repos</dt>
              <dd>{s.memberIds.length > 0 ? plural(s.memberIds.length, "repo") : "none yet"}</dd>
              <dt className="text-fg-muted">Sends</dt>
              <dd className="min-w-0 [overflow-wrap:anywhere]">
                {s.memberIds.length === 0
                  ? "Nothing until it has repos"
                  : recipients
                    ? `Monday 04:00 UTC to ${recipients}`
                    : "Nobody: no member has a verified email"}
              </dd>
              {s.last && (
                <>
                  <dt className="text-fg-muted">Last</dt>
                  <dd>{s.last}</dd>
                </>
              )}
            </dl>
          </button>
        ))}
      </div>
      <StreamRepos
        key={`${selected.id}:${selected.memberIds.join(",")}`}
        stream={selected}
        repos={repos}
      />
    </div>
  );
}

function StreamRepos({
  stream,
  repos,
}: {
  stream: StreamSummary;
  repos: { id: string; name: string }[];
}) {
  const toast = useToast();
  const [reposState, reposAction, saving] = useActionState(
    async (prev: StreamFormState, form: FormData) => {
      const res = await saveStreamReposAction(prev, form);
      if (res.message) toast(res.message, res.ok ? "ok" : "info");
      return res;
    },
    INITIAL
  );
  const [chosen, setChosen] = useState(() => new Set(reposState.repoIds ?? stream.memberIds));
  const [filter, setFilter] = useState("");
  const visible = repos.filter((r) => r.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const dirty =
    chosen.size !== stream.memberIds.length || stream.memberIds.some((id) => !chosen.has(id));

  return (
    <Card className="rise [--i:2]">
      <div className="border-line flex flex-wrap items-center justify-between gap-2.5 border-b px-[18px] py-4">
        <h3 className="type-h2 min-w-0 [overflow-wrap:anywhere]">Repos in {stream.name}</h3>
        <label className="bg-surface border-line focus-within:border-brand rounded-control flex h-9 min-w-0 flex-[0_1_200px] items-center gap-2 border px-2.5 focus-within:shadow-[0_0_0_3px_var(--brand-soft)]">
          <Search aria-hidden className="text-fg-muted size-[15px]" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter"
            aria-label="Filter repos"
            className="placeholder:text-fg-subtle min-w-0 flex-1 bg-transparent text-[13.5px] outline-none focus-visible:outline-none"
          />
        </label>
      </div>
      <form action={reposAction}>
        <input type="hidden" name="streamId" value={stream.id} />
        {repos.length === 0 ? (
          <p className="text-fg-muted px-[18px] py-6">
            No repos scanned yet. Connected repos are listed here so you can group them.
          </p>
        ) : (
          <fieldset className="grid max-h-[520px] gap-0.5 overflow-auto p-2 min-[768px]:grid-cols-2">
            <legend className="sr-only">Repos in {stream.name}</legend>
            {visible.map((r) => (
              <label
                key={r.id}
                className="hover:bg-surface-2 flex min-w-0 cursor-pointer items-center gap-2.5 rounded-[10px] px-3 py-[9px] transition-colors duration-[120ms]"
              >
                <input
                  type="checkbox"
                  name="repoId"
                  value={r.id}
                  checked={chosen.has(r.id)}
                  onChange={(e) => {
                    const next = new Set(chosen);
                    if (e.target.checked) next.add(r.id);
                    else next.delete(r.id);
                    setChosen(next);
                  }}
                  className="accent-brand size-4 shrink-0"
                />
                <TruncatedText className="font-mono text-[13px]">{r.name}</TruncatedText>
              </label>
            ))}
            {/* Filtered-out repos keep their membership. */}
            {repos
              .filter((r) => chosen.has(r.id) && !visible.includes(r))
              .map((r) => (
                <input key={r.id} type="hidden" name="repoId" value={r.id} />
              ))}
            {visible.length === 0 && (
              <p className="text-fg-muted px-3 py-2 text-[13px]">No repo matches.</p>
            )}
          </fieldset>
        )}
        <div className="border-line flex flex-wrap items-center justify-between gap-2.5 border-t px-[18px] py-3">
          <span className="text-fg-muted text-[12.5px]">
            {chosen.size} of {repos.length} selected
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={!dirty}
              onClick={() => setChosen(new Set(stream.memberIds))}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving || !dirty}>
              Save
            </Button>
          </div>
        </div>
      </form>
      <StreamSettings stream={stream} />
    </Card>
  );
}

function StreamSettings({ stream }: { stream: StreamSummary }) {
  const [state, action, renaming] = useActionState(renameStreamAction, INITIAL);
  const [deleting, startDelete] = useTransition();
  const [deleteFailed, setDeleteFailed] = useState(false);
  // React resets the form after an action; default to what was just saved.
  const shownName = state.name ?? stream.name;
  return (
    <div className="border-line grid gap-4 border-t px-[18px] py-4">
      <form action={action} className="grid gap-1.5">
        <input type="hidden" name="streamId" value={stream.id} />
        <Label htmlFor={`name-${stream.id}`}>Name (shown in the email subject)</Label>
        <div className="flex gap-2">
          <Input
            id={`name-${stream.id}`}
            name="name"
            key={shownName}
            defaultValue={shownName}
            maxLength={STREAM_NAME_MAX}
            required
          />
          <Button type="submit" variant="secondary" disabled={renaming}>
            Rename
          </Button>
        </div>
        <FormStatus ok={state.ok} message={state.message} />
      </form>
      <div className="flex flex-wrap items-center gap-3">
        <ConfirmDialog
          trigger={
            <Button variant="ghost" size="sm" disabled={deleting}>
              Delete stream
            </Button>
          }
          title={`Delete “${stream.name}”?`}
          description="Its past bulletins stay readable, without a stream. Repos that are in no other stream stop getting security alerts."
          confirmLabel="Delete stream"
          pending={deleting}
          onConfirm={() =>
            startDelete(async () => {
              const res = await deleteStreamAction(stream.id);
              setDeleteFailed(!res.ok);
            })
          }
        />
        {deleteFailed && <span className="text-upgrade text-[12.5px]">Could not delete.</span>}
      </div>
    </div>
  );
}
