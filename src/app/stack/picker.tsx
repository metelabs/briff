"use client";

import { Check, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition, type CSSProperties } from "react";

import { StackLogo, type LogoData } from "@/components/stack/stack-logo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EcosystemTag } from "@/components/ui/ecosystem-tag";
import { Input } from "@/components/ui/input";
import { FieldHelp, FormStatus, Label } from "@/components/ui/label";
import { SearchField } from "@/components/ui/search-field";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { plural } from "@/lib/format";
import { STACK_NAME_MAX } from "@/lib/manual-stack";
import {
  catalogEntry,
  GITHUB_ECOSYSTEM,
  PACKAGE_ENTRIES,
  PICKABLE_ECOSYSTEMS,
  pickableEcosystemLabel,
  RUNTIME_ENTRIES,
  searchCatalog,
  selectionKey,
  TOOL_ENTRIES,
  type CatalogEntry,
  type PickableEcosystem,
  type StackSelection,
} from "@/lib/stack-catalog";
import type { ExactLookup } from "@/lib/stack-lookup";
import type { CadenceChoice } from "@/lib/streams";
import { cn } from "@/lib/utils";

import {
  checkToolAction,
  deleteStackAction,
  saveStackAction,
  suggestPackagesAction,
} from "./actions";

export interface PickerProps {
  mode: "new" | "edit" | "onboarding";
  stackId: string | null;
  initialName: string;
  initialItems: StackSelection[];
  icons: Record<string, LogoData>;
  streams: { id: string; name: string }[];
  defaultStreamId: string | null;
  /** Items allowed across all manual stacks; null = unlimited. */
  itemLimit: number | null;
  /** Items the org's other manual stacks hold. */
  usedElsewhere: number;
  canEdit: boolean;
}

const NO_STREAM = "none";

/** A selection's tile: the catalog entry, or one built for a name typed by hand. */
function entryOf(s: StackSelection): CatalogEntry {
  const key = selectionKey(s);
  const known = catalogEntry(key);
  if (known) return known;
  if (s.kind === "runtime") throw new Error(`unknown runtime ${s.name}`);
  return {
    kind: s.kind === "tool" || s.ecosystem === GITHUB_ECOSYSTEM ? "tool" : "package",
    key,
    ecosystem: s.kind === "tool" ? GITHUB_ECOSYSTEM : s.ecosystem,
    name: s.name,
    label: s.name,
    icon: null,
  };
}

function selectionFor(entry: CatalogEntry): StackSelection {
  if (entry.ecosystem === "runtime") {
    return {
      kind: "runtime",
      name: entry.name as Extract<StackSelection, { kind: "runtime" }>["name"],
    };
  }
  if (entry.kind === "tool") return { kind: "tool", name: entry.name };
  return { kind: "package", ecosystem: entry.ecosystem, name: entry.name };
}

function versionOf(s: StackSelection): string {
  return s.kind === "tool" ? "" : (s.version ?? "");
}

export function StackPicker(props: PickerProps) {
  const { mode, icons, canEdit } = props;
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(props.initialName);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Map<string, StackSelection>>(
    () => new Map(props.initialItems.map((s) => [selectionKey(s), s]))
  );
  const [streamId, setStreamId] = useState(props.defaultStreamId ?? NO_STREAM);
  const [cadence, setCadence] = useState<CadenceChoice>("both");
  const [status, setStatus] = useState<{ ok: boolean; message: string | null }>({
    ok: true,
    message: null,
  });
  const [saving, startSave] = useTransition();
  const [deleting, startDelete] = useTransition();

  const custom = useMemo(
    () => [...selected.values()].filter((s) => !catalogEntry(selectionKey(s))).map(entryOf),
    [selected]
  );
  const sections = [
    { title: "Runtimes & platforms", entries: RUNTIME_ENTRIES, versionHint: "22" },
    {
      title: "Packages & frameworks",
      entries: [...PACKAGE_ENTRIES, ...custom.filter((e) => e.kind === "package")],
      versionHint: "^19 or 19.2.1",
    },
    {
      title: "Tools",
      entries: [...TOOL_ENTRIES, ...custom.filter((e) => e.kind === "tool")],
      versionHint: null,
    },
  ].map((s) => ({ ...s, shown: searchCatalog(query, s.entries) }));

  const count = selected.size;
  const limit = props.itemLimit;
  const over = limit !== null && props.usedElsewhere + count > limit;

  const toggle = (entry: CatalogEntry) => {
    const next = new Map(selected);
    if (next.has(entry.key)) next.delete(entry.key);
    else next.set(entry.key, selectionFor(entry));
    setSelected(next);
  };
  const add = (s: StackSelection) => {
    const next = new Map(selected);
    next.set(selectionKey(s), s);
    setSelected(next);
  };
  const setVersion = (key: string, version: string) => {
    const current = selected.get(key);
    if (!current || current.kind === "tool") return;
    const next = new Map(selected);
    next.set(key, { ...current, version: version || undefined } as StackSelection);
    setSelected(next);
  };

  const save = () =>
    startSave(async () => {
      const res = await saveStackAction({
        stackId: props.stackId,
        name,
        items: [...selected.values()].map((s) => ({
          ...s,
          ...(s.kind !== "tool" && s.version ? { version: s.version.trim() } : {}),
        })),
        ...(mode === "onboarding"
          ? { onboarding: cadence }
          : mode === "new"
            ? { streamId: streamId === NO_STREAM ? null : streamId }
            : {}),
      });
      setStatus(res);
      if (!res.ok) return;
      toast(res.message);
      if (mode === "onboarding") router.push("/");
      else if (mode === "new") router.push("/stack");
      else router.refresh();
    });

  return (
    <div className="grid items-start gap-[18px] min-[980px]:grid-cols-[minmax(0,1fr)_320px]">
      <div className="grid min-w-0 gap-[18px]">
        <div className="rise flex flex-wrap items-center gap-3 [--i:1]">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Search runtimes, packages, tools"
            label="Search the catalog"
            className="flex-[1_1_320px]"
          />
          <span className="text-fg-muted text-[13px]">
            Nothing to install. Versions are optional.
          </span>
        </div>
        {sections.map((section, i) => (
          <section
            key={section.title}
            aria-label={section.title}
            className="rise"
            style={{ "--i": i + 2 } as CSSProperties}
          >
            <h2 className="type-h2 mb-2.5">{section.title}</h2>
            {section.shown.length === 0 ? (
              <p className="text-fg-muted text-[13.5px]">No match in this section.</p>
            ) : (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2 min-[560px]:grid-cols-[repeat(auto-fill,minmax(176px,1fr))]">
                {section.shown.map((entry) => (
                  <Tile
                    key={entry.key}
                    entry={entry}
                    icon={entry.icon ? (icons[entry.icon] ?? null) : null}
                    selection={selected.get(entry.key) ?? null}
                    versionHint={section.versionHint}
                    onToggle={() => toggle(entry)}
                    onVersion={(v) => setVersion(entry.key, v)}
                  />
                ))}
              </ul>
            )}
            {section.title === "Packages & frameworks" && <AddPackage onAdd={add} />}
            {section.title === "Tools" && <AddTool onAdd={add} />}
          </section>
        ))}
      </div>

      <aside
        id="stack-summary"
        className="rise scroll-mt-[calc(var(--bar-h,64px)+12px)] [--i:2] min-[980px]:sticky min-[980px]:top-[calc(var(--bar-h,64px)+12px)]"
      >
        <Card className="grid gap-4 p-[18px]">
          <div className="grid gap-1.5">
            <Label htmlFor="stack-name">Stack name</Label>
            <Input
              id="stack-name"
              value={name}
              maxLength={STACK_NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Agency stack"
            />
          </div>
          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <span className="text-[13px] font-medium">Selected</span>
              <span
                className={cn(
                  "text-[12.5px] tabular-nums",
                  over ? "text-upgrade" : "text-fg-muted"
                )}
              >
                {limit === null
                  ? plural(count, "item")
                  : `${props.usedElsewhere + count} of ${limit} items`}
              </span>
            </div>
            {count === 0 ? (
              <p className="text-fg-muted text-[13px]">
                Nothing yet. Pick what your projects run on.
              </p>
            ) : (
              <ul className="grid max-h-[340px] gap-1 overflow-auto">
                {[...selected.values()].map((s) => {
                  const entry = entryOf(s);
                  return (
                    <li key={entry.key} className="flex min-w-0 items-center gap-2.5 py-0.5">
                      <StackLogo
                        size="sm"
                        label={entry.label}
                        name={entry.name}
                        icon={entry.icon ? (icons[entry.icon] ?? null) : null}
                      />
                      <span className="min-w-0 flex-1 truncate text-[13.5px]">{entry.label}</span>
                      <span className="text-fg-muted font-mono text-[12px]">
                        {versionOf(s) || (s.kind === "tool" ? "releases" : "any")}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={`Remove ${entry.label}`}
                        onClick={() => toggle(entry)}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {mode === "onboarding" && (
            <div className="grid gap-1.5">
              <span className="text-[13px] font-medium">What do you want?</span>
              <Segmented
                label="What do you want?"
                value={cadence}
                onChange={setCadence}
                className="w-full"
                options={[
                  { value: "weekly", label: "Weekly" },
                  { value: "security", label: "Security" },
                  { value: "both", label: "Both" },
                ]}
              />
              <FieldHelp>
                {cadence === "weekly"
                  ? "A bulletin every Monday; security news waits for it."
                  : cadence === "security"
                    ? "Same-day emails for security fixes only; no Monday bulletin."
                    : "A bulletin every Monday, and same-day emails for security fixes."}
              </FieldHelp>
            </div>
          )}
          {mode === "new" && (
            <div className="grid gap-1.5">
              <Label htmlFor="stack-stream">Stream</Label>
              <Select
                id="stack-stream"
                value={streamId}
                onValueChange={setStreamId}
                options={[
                  ...props.streams.map((s) => ({ value: s.id, label: s.name })),
                  { value: NO_STREAM, label: "None for now" },
                ]}
              />
              <FieldHelp>Bulletins and alerts cover a stack once it is in a stream.</FieldHelp>
            </div>
          )}
          {over && limit !== null && (
            <p className="text-upgrade text-[13px]">
              Your plan allows {limit} items across all stacks. Remove some, or see Settings →
              Billing for the plans.
            </p>
          )}
          {!canEdit && (
            <p className="text-fg-muted text-[13px]">Only an owner can change stacks.</p>
          )}
          <FormStatus ok={status.ok} message={status.message} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            {mode === "edit" && props.stackId ? (
              <ConfirmDialog
                trigger={
                  <Button variant="ghost" size="sm" disabled={!canEdit || deleting}>
                    Delete stack
                  </Button>
                }
                title={`Delete “${props.initialName}”?`}
                description="Its alerts and stream memberships go with it. Past bulletins keep its name."
                confirmLabel="Delete stack"
                pending={deleting}
                onConfirm={() =>
                  startDelete(async () => {
                    const res = await deleteStackAction(props.stackId ?? "");
                    if (res.ok) {
                      toast(res.message);
                      router.push("/stack");
                    } else setStatus(res);
                  })
                }
              />
            ) : (
              <span />
            )}
            <Button
              variant="primary"
              disabled={!canEdit || saving || count === 0 || !name.trim() || over}
              onClick={save}
            >
              {mode === "edit"
                ? "Save"
                : mode === "onboarding"
                  ? "Save and continue"
                  : "Create stack"}
            </Button>
          </div>
        </Card>
      </aside>
      {/* Narrow screens: the summary sits below the catalog; this bar keeps it one tap away. */}
      {count > 0 && (
        <a
          href="#stack-summary"
          className="bg-brand text-on-brand rounded-control fixed inset-x-3 bottom-3 z-40 flex h-11 items-center justify-between px-4 text-[14px] font-medium shadow-lg min-[980px]:hidden"
        >
          <span>{plural(count, "item")} selected</span>
          <span>Review and save</span>
        </a>
      )}
    </div>
  );
}

function Tile({
  entry,
  icon,
  selection,
  versionHint,
  onToggle,
  onVersion,
}: {
  entry: CatalogEntry;
  icon: LogoData | null;
  selection: StackSelection | null;
  versionHint: string | null;
  onToggle: () => void;
  onVersion: (version: string) => void;
}) {
  const on = selection !== null;
  const ecosystem =
    entry.ecosystem === "runtime" || entry.kind === "tool"
      ? null
      : pickableEcosystemLabel(entry.ecosystem);
  return (
    <li
      className={cn(
        "bg-surface border-line rounded-card border transition-[border-color,box-shadow] duration-150",
        on && "border-brand shadow-[0_0_0_3px_var(--brand-soft)]"
      )}
    >
      <button
        type="button"
        aria-pressed={on}
        onClick={onToggle}
        className="flex w-full min-w-0 items-center gap-3 rounded-[inherit] p-2.5 text-left"
      >
        <StackLogo label={entry.label} name={entry.name} icon={icon} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium">{entry.label}</span>
          <span className="text-fg-muted flex items-center gap-1.5 truncate text-[12px]">
            {ecosystem && <EcosystemTag>{ecosystem}</EcosystemTag>}
            <span className="truncate font-mono">
              {entry.kind === "runtime" ? "runtime" : entry.name}
            </span>
          </span>
        </span>
        <span
          aria-hidden
          className={cn(
            "grid size-5 shrink-0 place-items-center rounded-full border",
            on ? "bg-brand text-on-brand border-transparent" : "border-line-strong"
          )}
        >
          {on && <Check className="size-3" strokeWidth={3} />}
        </span>
      </button>
      {on && versionHint !== null && selection.kind !== "tool" && (
        <div className="px-2.5 pb-2.5">
          <Input
            aria-label={`${entry.label} version`}
            value={selection.version ?? ""}
            onChange={(e) => onVersion(e.target.value)}
            placeholder={entry.kind === "runtime" ? "any (e.g. 22)" : "any version"}
            className="h-8 font-mono text-[12.5px]"
            maxLength={64}
          />
        </div>
      )}
    </li>
  );
}

const PACKAGE_ECOSYSTEMS = PICKABLE_ECOSYSTEMS.filter((e) => e !== GITHUB_ECOSYSTEM);

function lookupNote(ecosystem: PickableEcosystem, exact: ExactLookup | null): string | null {
  const where = pickableEcosystemLabel(ecosystem);
  if (!exact) return null;
  switch (exact.status) {
    case "found":
      return `Found on ${where}.`;
    case "not_found":
      return `Not found on ${where}.`;
    case "unverified":
      return `Could not reach ${where}; it is added as typed.`;
    case "invalid":
      return `Not a valid ${where} name.`;
  }
}

/** Any package of a supported ecosystem: names Briff knows first, then the registry. */
function AddPackage({ onAdd }: { onAdd: (s: StackSelection) => void }) {
  const [ecosystem, setEcosystem] = useState<PickableEcosystem>("npm");
  const [name, setName] = useState("");
  const [result, setResult] = useState<{
    key: string;
    known: string[];
    exact: ExactLookup;
  } | null>(null);
  const typed = name.trim();
  const key = `${ecosystem}:${typed}`;
  const active = typed.length >= 2;
  const current = active && result?.key === key ? result : null;
  const checking = active && !current;
  const known = current?.known.filter((k) => k !== typed) ?? [];
  const exact = current?.exact ?? null;

  useEffect(() => {
    if (!active) return;
    let live = true;
    const timer = window.setTimeout(async () => {
      const res = await suggestPackagesAction(ecosystem, typed);
      if (live) setResult({ key, ...res });
    }, 350);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [active, ecosystem, typed, key]);

  const addable = exact && (exact.status === "found" || exact.status === "unverified");
  const commit = (packageName: string) => {
    onAdd({ kind: "package", ecosystem, name: packageName });
    setName("");
  };

  return (
    <div className="border-line rounded-card mt-3 grid gap-2 border border-dashed p-3">
      <span className="text-[13px] font-medium">Another package</span>
      <div className="flex flex-wrap gap-2">
        <Select
          aria-label="Ecosystem"
          value={ecosystem}
          onValueChange={setEcosystem}
          className="w-[140px]"
          options={PACKAGE_ECOSYSTEMS.map((e) => ({ value: e, label: pickableEcosystemLabel(e) }))}
        />
        <Input
          aria-label="Package name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={ecosystem === "npm" ? "e.g. nodemailer" : "Package name"}
          className="flex-[1_1_200px] font-mono text-[13px]"
          maxLength={214}
        />
        <Button
          disabled={!addable || checking}
          onClick={() => exact && "name" in exact && commit(exact.name)}
        >
          <Plus className="size-4" aria-hidden />
          Add
        </Button>
      </div>
      {known.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {known.map((k) => (
            <Button key={k} size="sm" variant="secondary" onClick={() => commit(k)}>
              <span className="font-mono">{k}</span>
            </Button>
          ))}
        </div>
      )}
      <p className="text-fg-muted text-[12.5px]" role="status">
        {checking
          ? "Checking…"
          : (lookupNote(ecosystem, exact) ?? "Names Briff already watches come first.")}
      </p>
    </div>
  );
}

/** Any public GitHub repository, followed through its releases and security advisories. */
function AddTool({ onAdd }: { onAdd: (s: StackSelection) => void }) {
  const [name, setName] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [checking, startCheck] = useTransition();

  const check = () =>
    startCheck(async () => {
      const res = await checkToolAction(name);
      if (res.status === "found" || res.status === "unverified") {
        onAdd({ kind: "tool", name: res.name });
        setName("");
        setNote(
          res.status === "unverified"
            ? `GitHub did not answer; ${res.name} is added unverified.`
            : null
        );
      } else {
        setNote(
          res.status === "invalid" ? "Use owner/repo." : "No public GitHub repository by that name."
        );
      }
    });

  return (
    <div className="border-line rounded-card mt-3 grid gap-2 border border-dashed p-3">
      <span className="text-[13px] font-medium">Another tool from GitHub</span>
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="GitHub repository"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="owner/repo"
          className="flex-[1_1_220px] font-mono text-[13px]"
          maxLength={140}
        />
        <Button disabled={!name.includes("/") || checking} onClick={check}>
          <Plus className="size-4" aria-hidden />
          Add
        </Button>
      </div>
      <p className="text-fg-muted text-[12.5px]" role="status">
        {checking
          ? "Checking GitHub…"
          : (note ?? "Its releases and security advisories reach your bulletin.")}
      </p>
    </div>
  );
}
