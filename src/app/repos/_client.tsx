"use client";

import Link from "next/link";
import { Fragment, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { SearchField } from "@/components/ui/search-field";
import { Tag } from "@/components/ui/tag";
import { useToast } from "@/components/ui/toast";
import { Tooltip, TruncatedText } from "@/components/ui/tooltip";
import { plural } from "@/lib/format";
import type { RuntimeChip } from "@/lib/repos";
import { cn } from "@/lib/utils";

import { removeRepoAction } from "./actions";

const SCANNER_DOCS = "https://www.npmjs.com/package/briff-scan";

export interface RepoListRow {
  id: string;
  name: string;
  source: string;
  /** Which scanner uploads it, so the remove dialog says how to stop the next upload. */
  scanner: "github" | "local";
  isNew: boolean;
  inNoStream: boolean;
  /** One part per ecosystem (dependencySummary); each part stays on one line. */
  deps: string[];
  chips: RuntimeChip[];
  openAlerts: number;
  /** The repo is in the stream the Alerts page shows. */
  alertsInScope: boolean;
  lastScan: string;
}

export function RepoList({ rows }: { rows: RepoListRow[] }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const visible = q
    ? rows.filter(
        (r) => r.name.toLowerCase().includes(q) || r.chips.some((c) => c.label.includes(q))
      )
    : rows;
  return (
    <>
      <div className="rise mb-3.5 flex [--i:2]">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search repos"
          label="Search repos"
        />
      </div>
      <div className="rise bg-surface border-line rounded-card overflow-hidden border [--i:3]">
        {visible.length === 0 && (
          <p className="text-fg-muted px-[18px] py-5">
            {rows.length === 0 ? "No repos here." : "No repo matches."}
          </p>
        )}
        {visible.map((r) => (
          <div
            key={r.id}
            id={`repo-${r.id}`}
            className="border-line target:bg-brand-soft grid scroll-mt-[calc(var(--bar-h,64px)+12px)] items-center gap-x-4 gap-y-2 border-t px-[18px] py-3.5 transition-colors first:border-t-0 max-[980px]:grid-cols-[minmax(0,1fr)_auto] min-[980px]:grid-cols-[minmax(170px,1fr)_minmax(0,2fr)_150px_140px_auto]"
          >
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <TruncatedText as="b" className="font-mono text-[14px] font-medium">
                  {r.name}
                </TruncatedText>
                {r.isNew && <Tag kind="brand">New</Tag>}
              </div>
              <span className="text-fg-muted text-[12.5px]">
                {r.source} ·{" "}
                {r.deps.map((part, i) => (
                  <Fragment key={part}>
                    {i > 0 && ", "}
                    <span className="whitespace-nowrap">{part}</span>
                  </Fragment>
                ))}
              </span>
            </div>
            <div className="flex min-w-0 flex-wrap gap-[5px] max-[980px]:col-start-1 max-[980px]:row-start-2">
              {r.chips.map((c) => (
                <Tooltip
                  key={c.label}
                  content={
                    <span className="font-mono whitespace-pre-line">
                      {c.unresolved ? `${c.detail}\nVersion comes from a build variable` : c.detail}
                    </span>
                  }
                >
                  <span
                    tabIndex={0}
                    className={cn(
                      "rounded-chip inline-flex max-w-full min-w-0 cursor-default items-center gap-1 border px-2 py-[3px] font-mono text-[12px] whitespace-nowrap",
                      c.eol ? "bg-sec-soft text-sec border-transparent" : "bg-surface-2 border-line"
                    )}
                  >
                    <span className="min-w-0 truncate">
                      {c.label}
                      {c.unresolved && " ?"}
                      <span className={c.eol ? "opacity-85" : "text-fg-muted"}> · {c.sources}</span>
                    </span>
                    {c.eol && (
                      <b className="ml-0.5 font-sans text-[11px] font-semibold">
                        {c.eolDate ? `EOL on ${c.eolDate}` : "EOL"}
                      </b>
                    )}
                  </span>
                </Tooltip>
              ))}
              {r.inNoStream && (
                <Link href="/streams" className="text-brand self-center text-[12.5px] font-medium">
                  Add to a stream
                </Link>
              )}
            </div>
            <div className="text-[13px] max-[980px]:col-start-2 max-[980px]:row-start-1">
              {r.openAlerts > 0 && r.alertsInScope ? (
                <Link href="/alerts" className="text-sec font-semibold hover:underline">
                  {plural(r.openAlerts, "new advisory", "new advisories")}
                </Link>
              ) : r.openAlerts > 0 ? (
                <Tooltip content="On Alerts once its stream is chosen in the top bar">
                  <span tabIndex={0} className="text-sec cursor-default font-semibold">
                    {plural(r.openAlerts, "new advisory", "new advisories")}
                  </span>
                </Tooltip>
              ) : (
                <span className="text-ok font-medium">No new advisories</span>
              )}
            </div>
            <div className="text-fg-muted text-[12.5px] max-[980px]:hidden">{r.lastScan}</div>
            <div className="justify-self-end max-[980px]:col-start-2 max-[980px]:row-start-2">
              <RemoveRepoButton repo={r} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

const Mono = ({ children }: { children: string }) => (
  <code className="bg-surface-2 border-line rounded-chip border px-1 font-mono text-[12.5px]">
    {children}
  </code>
);

function RemoveRepoButton({ repo }: { repo: RepoListRow }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  return (
    <ConfirmDialog
      trigger={
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          aria-label={`Remove ${repo.name}`}
          className="relative before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']"
        >
          Remove
        </Button>
      }
      title={`Remove ${repo.name}?`}
      description={
        <>
          <span className="block">
            Its dependencies, runtimes and alerts are deleted and it leaves every stream. Past
            bulletins still mention it.
          </span>
          <span className="mt-2 block">
            {repo.scanner === "github" ? (
              <>
                It comes back on the next scan unless the GitHub Action stops scanning it: delete{" "}
                <Mono>.github/workflows/briff.yml</Mono> in the repo, or disable that workflow.
              </>
            ) : (
              <>
                It comes back on the next scan unless the local scanner stops scanning it: add{" "}
                <Mono>{`--exclude ${repo.name}`}</Mono> (briff-scan 0.1.1 or later), or stop running
                it in that folder.
              </>
            )}{" "}
            <a
              href={SCANNER_DOCS}
              target="_blank"
              rel="noreferrer"
              className="text-brand font-medium underline-offset-4 hover:underline"
            >
              Scanner docs
            </a>
          </span>
        </>
      }
      confirmLabel="Remove repo"
      pending={pending}
      onConfirm={() =>
        start(async () => {
          const res = await removeRepoAction(repo.id);
          toast(res.message, res.ok ? "ok" : "info");
        })
      }
    />
  );
}
