// The instance admin's organisation table: pure filtering, sorting and paging over the
// rows loadOrgDirectory (org-directory.ts) reads. No database here, so it is testable.

/** Prisma defaults of Org.repoLimit / Org.streamLimit; anything else is a custom limit. */
export const DEFAULT_REPO_LIMIT = 10;
export const DEFAULT_STREAM_LIMIT = 2;

export const ORG_PAGE_SIZE = 25;

export const ORG_FILTERS = ["all", "at-limit", "custom"] as const;
export type OrgFilter = (typeof ORG_FILTERS)[number];

export interface OrgRow {
  id: string;
  name: string;
  createdAt: Date;
  /** The oldest owner's email; null for an org without an owner left. */
  ownerEmail: string | null;
  members: number;
  repos: number;
  repoLimit: number;
  streams: number;
  streamLimit: number;
}

/** Uploads beyond the repo limit are refused, so "at" the limit is where it bites. */
export function atLimit(row: Pick<OrgRow, "repos" | "repoLimit" | "streams" | "streamLimit">) {
  return row.repos >= row.repoLimit || row.streams >= row.streamLimit;
}

export function customLimits(row: Pick<OrgRow, "repoLimit" | "streamLimit">): boolean {
  return row.repoLimit !== DEFAULT_REPO_LIMIT || row.streamLimit !== DEFAULT_STREAM_LIMIT;
}

export function parseOrgQuery(params: Record<string, string | string[] | undefined>): {
  q: string;
  filter: OrgFilter;
  page: number;
} {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const filter = one(params.filter);
  const page = Number.parseInt(one(params.page), 10);
  return {
    q: one(params.q).trim().slice(0, 100),
    filter: (ORG_FILTERS as readonly string[]).includes(filter) ? (filter as OrgFilter) : "all",
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

export interface OrgPage {
  rows: OrgRow[];
  /** Rows matching the search and filter, before paging. */
  total: number;
  page: number;
  pages: number;
  /** Per filter, how many rows match the search (the chips' counts). */
  counts: Record<OrgFilter, number>;
}

/** Search (name or owner email, case-insensitive), filter, newest first, one page. */
export function orgPage(
  all: readonly OrgRow[],
  query: { q: string; filter: OrgFilter; page: number },
  size = ORG_PAGE_SIZE
): OrgPage {
  const needle = query.q.toLowerCase();
  const searched = needle
    ? all.filter(
        (r) =>
          r.name.toLowerCase().includes(needle) ||
          (r.ownerEmail ?? "").toLowerCase().includes(needle)
      )
    : [...all];
  const counts: Record<OrgFilter, number> = {
    all: searched.length,
    "at-limit": searched.filter(atLimit).length,
    custom: searched.filter(customLimits).length,
  };
  const filtered =
    query.filter === "at-limit"
      ? searched.filter(atLimit)
      : query.filter === "custom"
        ? searched.filter(customLimits)
        : searched;
  filtered.sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id)
  );
  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const page = Math.min(query.page, pages);
  return {
    rows: filtered.slice((page - 1) * size, page * size),
    total: filtered.length,
    page,
    pages,
    counts,
  };
}

/** `/admin` with the given query; defaults are left out so the plain URL stays plain. */
export function orgHref(query: { q: string; filter: OrgFilter; page: number }): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.filter !== "all") params.set("filter", query.filter);
  if (query.page > 1) params.set("page", String(query.page));
  const s = params.toString();
  return s ? `/admin?${s}` : "/admin";
}
