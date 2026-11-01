"use client";

import Link from "next/link";
import { useState } from "react";

import { EcosystemTag } from "@/components/ui/ecosystem-tag";
import { FilterChips } from "@/components/ui/filter-chips";
import { Masonry } from "@/components/ui/masonry";
import { SearchField } from "@/components/ui/search-field";
import { Tag, type TagKind } from "@/components/ui/tag";
import { plural } from "@/lib/format";
import { caps } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { EntryStatus, StackEntry, StackRepo } from "@/pipeline/stack-drift";

export interface StackCardView extends StackRepo {
  id: string;
  connection: string;
  lastScan: string;
}

type Filter = "all" | "drift" | "major" | "eol";

const STATUS_KIND: Record<EntryStatus, TagKind> = {
  eol: "eol",
  major: "upgrade",
  minor: "wait",
  supported: "ok",
  current: "ok",
  unknown: "wait",
};

function statusText(e: StackEntry): string {
  switch (e.status) {
    case "eol":
      return e.until ? `EOL since ${e.until}` : "EOL";
    case "supported":
      return e.until ? `Supported until ${e.until}` : "Supported";
    case "current":
      return "Current";
    case "minor":
    case "major":
      return "Behind";
    case "unknown":
      return "Not judged";
  }
}

/** Header chips: end-of-life count, majors behind, minor drift, or "Up to date". */
function repoChips(r: StackRepo): { kind: TagKind; text: string }[] {
  const minor = r.entries.filter((e) => e.status === "minor").length;
  const chips: { kind: TagKind; text: string }[] = [];
  if (r.eolCount > 0) chips.push({ kind: "eol", text: `${r.eolCount} EOL` });
  if (r.majorsBehind > 0) {
    chips.push({ kind: "upgrade", text: plural(r.majorsBehind, "major", "majors") + " behind" });
  }
  if (chips.length === 0 && minor > 0) chips.push({ kind: "wait", text: `${minor} behind` });
  if (chips.length > 0) return chips;
  if (r.entries.length === 0) return [{ kind: "wait", text: "No runtime data" }];
  return r.entries.some((e) => e.status !== "unknown")
    ? [{ kind: "ok", text: "Up to date" }]
    : [{ kind: "wait", text: "Not judged" }];
}

function matchesQuery(r: StackRepo, q: string): boolean {
  if (!q) return true;
  const query = q.toLowerCase();
  return (
    r.repo.toLowerCase().includes(query) ||
    r.entries.some(
      (e) => e.label.toLowerCase().includes(query) || e.ecosystem?.toLowerCase() === query
    )
  );
}

function EntryRow({ entry }: { entry: StackEntry }) {
  return (
    <li className="border-line border-t py-2.5 first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[14px] font-medium">{entry.label}</span>
          {entry.ecosystem && <EcosystemTag>{entry.ecosystem}</EcosystemTag>}
          {entry.version && (
            <span className="font-mono text-[13px] break-all">{entry.version}</span>
          )}
          {entry.status === "major" && (
            <small className="text-upgrade text-[11.5px] font-semibold whitespace-nowrap tabular-nums">
              {plural(entry.behind, "major", "majors")} behind
            </small>
          )}
          {entry.source && (
            <span className="text-fg-muted font-mono text-[12px] break-all">{entry.source}</span>
          )}
        </span>
        <Tag kind={STATUS_KIND[entry.status]} className="ml-auto">
          {statusText(entry)}
        </Tag>
      </div>
      {entry.target && (
        <p
          className={cn(
            "mt-1 text-[13px]",
            entry.status === "eol" ? "text-fg font-medium" : "text-fg-muted"
          )}
        >
          <span aria-hidden className="text-fg-subtle mr-1.5">
            →
          </span>
          {entry.target}
        </p>
      )}
      {entry.note && <p className="text-fg-muted mt-1 text-[12.5px]">{entry.note}</p>}
    </li>
  );
}

function EntryGroup({ title, entries }: { title: string; entries: StackEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <div className="mt-3.5">
      <h4 className="type-label text-fg-muted">{caps(title)}</h4>
      <ul className="mt-1">
        {entries.map((e) => (
          <EntryRow key={e.key} entry={e} />
        ))}
      </ul>
    </div>
  );
}

function RepoCard({ card, index }: { card: StackCardView; index: number }) {
  return (
    <article
      aria-labelledby={`stack-${card.id}`}
      className="rise bg-surface border-line rounded-card min-w-0 border p-[18px] max-[560px]:p-[15px]"
      style={{ ["--i" as string]: Math.min(index + 3, 10) }}
    >
      <header className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 grow basis-64">
          <h3 id={`stack-${card.id}`} className="font-mono text-[14.5px] font-medium break-all">
            <Link
              href={`/repos?show=all#repo-${card.id}`}
              className="hover:text-brand underline-offset-4 hover:underline"
            >
              {card.repo}
            </Link>
          </h3>
          <p className="text-fg-muted mt-0.5 text-[12.5px]">
            {card.connection} · last scan {card.lastScan}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {repoChips(card).map((c) => (
            <Tag key={c.text} kind={c.kind}>
              {c.text}
            </Tag>
          ))}
        </div>
      </header>
      {card.entries.length === 0 ? (
        <p className="text-fg-muted mt-3 text-[13px]">
          No runtime or key package on record for this repo.
        </p>
      ) : (
        <>
          <EntryGroup title="Runtimes" entries={card.entries.filter((e) => e.kind === "runtime")} />
          <EntryGroup
            title="Key packages"
            entries={card.entries.filter((e) => e.kind === "package")}
          />
        </>
      )}
    </article>
  );
}

/** Rough card height in px from its rows, for the server's column split (DESIGN.md §6 Stack). */
function estimateHeight(card: StackCardView): number {
  if (card.entries.length === 0) return 110;
  const groups = new Set(card.entries.map((e) => e.kind)).size;
  const rows = card.entries.reduce((h, e) => h + 41 + (e.target ? 24 : 0) + (e.note ? 22 : 0), 0);
  return 86 + groups * 34 + rows;
}

function Stat({
  value,
  caption,
  alarm = false,
}: {
  value: number;
  caption: string;
  alarm?: boolean;
}) {
  return (
    <div className="bg-surface border-line rounded-tile border px-4 py-3.5">
      <b className={cn("type-stat block tabular-nums", alarm ? "text-sec" : "text-fg")}>{value}</b>
      <span className="text-fg-muted mt-1.5 block text-[12px]">{caption}</span>
    </div>
  );
}

/** Summary strip, filters and one card per repo, most urgent first (computeDrift's order). */
export function StackCards({ cards }: { cards: StackCardView[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const counts = {
    all: cards.length,
    drift: cards.filter((r) => r.drift).length,
    major: cards.filter((r) => r.majorsBehind > 0).length,
    eol: cards.filter((r) => r.eol).length,
  };
  const eolRuntimes = cards.reduce((n, r) => n + r.eolCount, 0);
  const majorPackages = cards.reduce(
    (n, r) => n + r.entries.filter((e) => e.status === "major").length,
    0
  );
  const upToDate = cards.filter((r) => repoChips(r)[0]?.kind === "ok").length;
  const visible = cards.filter(
    (r) =>
      (filter === "all" ||
        (filter === "drift" && r.drift) ||
        (filter === "major" && r.majorsBehind > 0) ||
        (filter === "eol" && r.eol)) &&
      matchesQuery(r, query)
  );

  return (
    <>
      <section
        aria-label="Summary"
        className="rise mb-6 grid grid-cols-4 gap-3 [--i:1] max-[560px]:grid-cols-2"
      >
        <Stat
          value={cards.length}
          caption={cards.length === 1 ? "repo scanned" : "repos scanned"}
        />
        <Stat
          value={eolRuntimes}
          caption={eolRuntimes === 1 ? "end-of-life runtime" : "end-of-life runtimes"}
          alarm={eolRuntimes > 0}
        />
        <Stat
          value={majorPackages}
          caption={majorPackages === 1 ? "package a major behind" : "packages a major behind"}
        />
        <Stat value={upToDate} caption={upToDate === 1 ? "repo up to date" : "repos up to date"} />
      </section>
      <div className="rise mb-3.5 flex flex-wrap items-center gap-2 [--i:2]">
        <FilterChips<Filter>
          label="Filter repos"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All repos", count: counts.all },
            { value: "drift", label: "Any drift", count: counts.drift },
            { value: "major", label: "Majors behind", count: counts.major },
            { value: "eol", label: "End of life", count: counts.eol },
          ]}
        />
        <SearchField
          className="ml-auto max-[560px]:ml-0 max-[560px]:w-full"
          value={query}
          onChange={setQuery}
          placeholder="Repo, runtime or package"
          label="Filter repos, runtimes or packages"
        />
      </div>
      {visible.length === 0 ? (
        <p className="bg-surface border-line rounded-card text-fg-muted border px-[18px] py-5">
          No repo matches.
        </p>
      ) : (
        <Masonry
          items={visible.map((c, i) => ({
            key: c.id,
            estimate: estimateHeight(c),
            node: <RepoCard card={c} index={i} />,
          }))}
        />
      )}
      <p className="text-fg-muted mt-3 max-w-[72ch] text-[12.5px]">
        Runtimes are checked against end-of-life dates (endoflife.date); a target stays on your
        release line unless the line is past end of life. Packages are checked against the latest
        release on their registry (npm, Packagist, PyPI, the Go module proxy).
      </p>
    </>
  );
}
