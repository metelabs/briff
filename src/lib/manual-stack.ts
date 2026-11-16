import { z } from "zod";

import type { IngestDependency } from "@/lib/scan/ingest";
import type { ScanRuntime } from "@/lib/scan/schema";
import {
  catalogEntry,
  cleanRuntimeVersion,
  cleanVersion,
  GITHUB_ECOSYSTEM,
  isExactVersion,
  isPickableEcosystem,
  isRuntimeId,
  itemKey,
  normalizePickedName,
  selectionKey,
  type StackSelection,
} from "@/lib/stack-catalog";
import { normalizeVersion, type Ecosystem } from "@scan/ecosystems";

// A manual stack's items as the rows a scan would store (pure). Without a version a package
// is a requirement row (`constraint` + `unresolved`, version `*` or the typed range): it
// matches release and security items, and is never compared or sent to OSV. An exact version
// is stored like a scanned install. Runtimes become RepoRuntime rows with source "manual".

export const MANUAL_SOURCE = "manual";
export const STACK_NAME_MAX = 60;
export const DEFAULT_STACK_NAME = "My stack";
/** One save carries at most this many items, whatever the plan. */
export const STACK_ITEMS_MAX = 500;

export const stackSelectionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("runtime"),
    name: z.string().max(40),
    version: z.string().max(64).optional(),
  }),
  z.object({
    kind: z.literal("package"),
    ecosystem: z.string().max(40),
    name: z.string().max(300),
    version: z.string().max(64).optional(),
  }),
  z.object({ kind: z.literal("tool"), name: z.string().max(200) }),
]);

export type ParsedSelection = z.infer<typeof stackSelectionSchema>;

export type CleanResult = { ok: true; items: StackSelection[] } | { ok: false; message: string };

/** Checks names and versions, drops duplicates (the last one wins). */
export function cleanSelections(raw: readonly ParsedSelection[]): CleanResult {
  const byKey = new Map<string, StackSelection>();
  for (const item of raw) {
    let clean: StackSelection;
    if (item.kind === "runtime") {
      if (!isRuntimeId(item.name)) return { ok: false, message: `Unknown runtime: ${item.name}.` };
      const version = cleanRuntimeVersion(item.version);
      if (version === null)
        return { ok: false, message: `${item.name}: use a major version like 22 or 8.3.` };
      clean = { kind: "runtime", name: item.name, ...(version ? { version } : {}) };
    } else if (item.kind === "tool") {
      const name = normalizePickedName(GITHUB_ECOSYSTEM, item.name);
      if (!name) return { ok: false, message: `${item.name}: use owner/repo.` };
      clean = { kind: "tool", name };
    } else {
      if (!isPickableEcosystem(item.ecosystem))
        return { ok: false, message: `Unknown ecosystem: ${item.ecosystem}.` };
      const name = normalizePickedName(item.ecosystem, item.name);
      if (!name)
        return { ok: false, message: `${item.name} is not a valid ${item.ecosystem} name.` };
      const version = cleanVersion(item.version);
      if (version === null) return { ok: false, message: `${name}: that version is not valid.` };
      clean = {
        kind: "package",
        ecosystem: item.ecosystem,
        name,
        ...(version && item.ecosystem !== GITHUB_ECOSYSTEM ? { version } : {}),
      };
    }
    byKey.set(selectionKey(clean), clean);
  }
  if (byKey.size > STACK_ITEMS_MAX)
    return { ok: false, message: `A stack holds at most ${STACK_ITEMS_MAX} items.` };
  return { ok: true, items: [...byKey.values()] };
}

/** The dependency and runtime rows a manual stack stores for its items. */
export function manualStackRows(items: readonly StackSelection[]): {
  dependencies: IngestDependency[];
  runtimes: ScanRuntime[];
} {
  const dependencies: IngestDependency[] = [];
  const runtimes: ScanRuntime[] = [];
  for (const item of items) {
    if (item.kind === "runtime") {
      runtimes.push({
        name: item.name,
        version: item.version ?? "*",
        normalized: item.version ?? null,
        source: MANUAL_SOURCE,
        unresolved: false,
        // Without a version the row says only that the runtime is used: never end-of-life.
        constraint: !item.version,
      });
      continue;
    }
    const ecosystem = item.kind === "tool" ? GITHUB_ECOSYSTEM : item.ecosystem;
    const version = item.kind === "package" ? item.version : undefined;
    const pinned = version !== undefined && isExactVersion(version);
    dependencies.push({
      ecosystem,
      name: item.name,
      version:
        pinned && ecosystem !== GITHUB_ECOSYSTEM
          ? normalizeVersion(ecosystem as Ecosystem, version)
          : (version ?? "*"),
      direct: true,
      dev: false,
      manager: null,
      group: null,
      requirement: null,
      project: null,
      constraint: !pinned,
      metadata: undefined,
      unresolved: !pinned,
    });
  }
  return { dependencies, runtimes };
}

/** Rows of a stored manual stack back as selections (the edit page's initial state). */
export function selectionsFromRows(
  deps: readonly { ecosystem: string; name: string; version: string }[],
  runtimes: readonly { name: string; version: string }[]
): StackSelection[] {
  const out: StackSelection[] = [];
  for (const r of runtimes) {
    if (!isRuntimeId(r.name)) continue;
    out.push({
      kind: "runtime",
      name: r.name,
      ...(r.version !== "*" ? { version: r.version } : {}),
    });
  }
  for (const d of deps) {
    if (!isPickableEcosystem(d.ecosystem)) continue;
    if (
      d.ecosystem === GITHUB_ECOSYSTEM &&
      catalogEntry(itemKey(d.ecosystem, d.name))?.kind !== "package"
    ) {
      out.push({ kind: "tool", name: d.name });
      continue;
    }
    const version = d.version !== "*" ? d.version : undefined;
    out.push({
      kind: "package",
      ecosystem: d.ecosystem,
      name: d.name,
      ...(version ? { version } : {}),
    });
  }
  return out;
}

/** Items a stack counts toward the plan's limit. */
export function stackItemCount(rows: { dependencies: number; runtimes: number }): number {
  return rows.dependencies + rows.runtimes;
}
