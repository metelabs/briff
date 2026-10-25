"use client";

import { useState } from "react";

import { EcosystemTag } from "@/components/ui/ecosystem-tag";
import { FilterChips } from "@/components/ui/filter-chips";
import { SearchField } from "@/components/ui/search-field";
import { Tooltip, TruncatedText } from "@/components/ui/tooltip";
import { caps } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { DriftCell, DriftColumn, DriftRow } from "@/pipeline/stack-drift";

type Filter = "all" | "drift" | "major" | "eol";

const CELL_CLASS: Record<DriftCell["status"], string> = {
  ok: "text-ok",
  minor: "text-fg",
  plain: "text-fg",
  major: "bg-upgrade-soft text-upgrade",
  eol: "bg-sec-soft text-sec",
  none: "text-fg-subtle",
};

function Cell({ cell, column }: { cell: DriftCell; column: DriftColumn }) {
  if (cell.status === "none") {
    return (
      <span className="text-fg-subtle px-[7px]" aria-label="not used">
        –
      </span>
    );
  }
  const title = [
    cell.source,
    cell.status === "ok" && "current",
    cell.status === "minor" && `minor behind ${column.latest}`,
    cell.status === "major" && `${cell.behind} behind ${column.latest}`,
    cell.status === "eol" && "end of life",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Tooltip content={title} disabled={!title}>
      <span
        tabIndex={title ? 0 : undefined}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-[6px] px-[7px] py-0.5 font-mono",
          CELL_CLASS[cell.status]
        )}
      >
        {cell.version}
        {cell.status === "eol" && (
          <small className="font-sans text-[11px] font-semibold">EOL</small>
        )}
        {cell.status === "major" && (
          <small className="font-sans text-[11px] font-semibold">−{cell.behind}</small>
        )}
      </span>
    </Tooltip>
  );
}

function matchesQuery(row: DriftRow, columns: DriftColumn[], q: string): boolean {
  if (!q) return true;
  const query = q.toLowerCase();
  if (row.repo.toLowerCase().includes(query)) return true;
  return columns.some(
    (c) =>
      (c.label.toLowerCase().includes(query) || c.ecosystem?.toLowerCase() === query) &&
      row.cells[c.key]?.status !== "none"
  );
}

/** Repo x runtime / package table; first column sticky, scrolls inside its card. */
export function DriftTable({ columns, rows }: { columns: DriftColumn[]; rows: DriftRow[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const counts = {
    all: rows.length,
    drift: rows.filter((r) => r.drift).length,
    major: rows.filter((r) => r.majorsBehind > 0).length,
    eol: rows.filter((r) => r.eol).length,
  };
  const visible = rows.filter(
    (r) =>
      (filter === "all" ||
        (filter === "drift" && r.drift) ||
        (filter === "major" && r.majorsBehind > 0) ||
        (filter === "eol" && r.eol)) &&
      matchesQuery(r, columns, query)
  );

  return (
    <>
      <div className="rise mb-3.5 flex flex-wrap items-center gap-2 [--i:1]">
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
          className="ml-auto"
          value={query}
          onChange={setQuery}
          placeholder="Repo or package"
          label="Filter repos or packages"
        />
      </div>
      <div className="rise bg-surface border-line rounded-card overflow-x-auto border [--i:2]">
        <table className="w-full min-w-[720px] border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr>
              <th className="bg-surface-2 border-line text-fg-muted type-label sticky left-0 z-1 border-r px-3.5 py-2.5 text-left">
                {caps("Repo")}
              </th>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className="bg-surface-2 text-fg-muted px-3.5 py-2.5 text-left align-bottom whitespace-nowrap"
                >
                  <span className="flex items-center gap-1.5">
                    <span className="type-label">{caps(c.label)}</span>
                    {c.ecosystem && <EcosystemTag>{c.ecosystem}</EcosystemTag>}
                  </span>
                  <small className="text-fg block font-mono text-[11.5px] font-normal">
                    {c.kind === "runtime"
                      ? "end-of-life check"
                      : c.latest
                        ? `latest ${c.latest}`
                        : "latest: no data"}
                  </small>
                </th>
              ))}
              <th className="bg-surface-2 text-fg-muted type-label px-3.5 py-2.5 text-left whitespace-nowrap">
                {caps("Majors behind")}
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.repo} className="group/row">
                <th
                  scope="row"
                  className="bg-surface group-hover/row:bg-surface-2 border-line sticky left-0 z-1 max-w-[220px] border-t border-r px-3.5 py-2.5 text-left font-mono font-medium transition-colors"
                >
                  <TruncatedText>{r.repo}</TruncatedText>
                </th>
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className="group-hover/row:bg-surface-2 border-line border-t px-3.5 py-2.5 whitespace-nowrap transition-colors"
                  >
                    <Cell cell={r.cells[c.key]} column={c} />
                  </td>
                ))}
                <td className="group-hover/row:bg-surface-2 border-line border-t px-3.5 py-2.5 transition-colors">
                  <span
                    className={cn(
                      "font-display text-[17px] font-semibold tabular-nums",
                      r.eol ? "text-sec" : r.majorsBehind > 0 ? "text-upgrade" : "text-ok"
                    )}
                  >
                    {r.majorsBehind}
                  </span>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length + 2}
                  className="text-fg-muted border-line border-t px-3.5 py-5"
                >
                  No repo matches.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="text-fg-muted mt-3 flex flex-wrap items-center gap-3.5 text-[12.5px]">
        <span className="text-ok font-mono">current</span>
        <span className="text-fg font-mono">minor behind</span>
        <span className="bg-upgrade-soft text-upgrade rounded-[6px] px-[7px] py-0.5 font-mono">
          major behind <small className="font-sans font-semibold">−n</small>
        </span>
        <span className="bg-sec-soft text-sec rounded-[6px] px-[7px] py-0.5 font-mono">
          end of life <small className="font-sans font-semibold">EOL</small>
        </span>
        <span>
          Runtimes are checked against end-of-life dates; packages against the latest release on
          their registry (npm, Packagist, PyPI, the Go module proxy).
        </span>
      </div>
    </>
  );
}
