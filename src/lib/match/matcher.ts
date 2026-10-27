// Deterministic item -> org matcher (plan §7.3). No LLM: a release feed of a
// package the org uses, a source about a runtime its repos declare, an
// announcement of a service it uses, a platform feed matching its traits, or a
// mention of one of its direct packages/services.
// Triage (next PR) refines what reaches the bulletin.

import { UNKNOWN_IMAGE } from "@scan/runtimes";

export interface StackPackage {
  packageId: string;
  /** `Package.ecosystem`; absent in older test stacks, which are npm. */
  ecosystem?: string;
  name: string;
  direct: boolean;
  repoIds: Set<string>;
  serviceKey: string | null;
}

export interface StackService {
  key: string;
  name: string;
  repoIds: Set<string>;
}

export interface StackRuntime {
  /** Canonical runtime id (`php`, `node`), see packages/scan/src/runtimes.ts. */
  name: string;
  /** Normalised versions (or raw ones when none was derivable) across the org's repos. */
  versions: Set<string>;
  repoIds: Set<string>;
}

/** A repo's declared runtime as stored (`RepoRuntime`). */
export interface RuntimeStackRow {
  repoId: string;
  name: string;
  version: string;
  normalized: string | null;
}

/** Groups runtime rows by runtime id; unmapped `image` rows are not runtimes. */
export function runtimesOf(rows: readonly RuntimeStackRow[]): Map<string, StackRuntime> {
  const runtimes = new Map<string, StackRuntime>();
  for (const row of rows) {
    if (row.name === UNKNOWN_IMAGE) continue;
    const runtime = runtimes.get(row.name) ?? {
      name: row.name,
      versions: new Set<string>(),
      repoIds: new Set<string>(),
    };
    runtime.versions.add(row.normalized ?? row.version);
    runtime.repoIds.add(row.repoId);
    runtimes.set(row.name, runtime);
  }
  return runtimes;
}

/**
 * Key of `OrgStack.packages`: the Package is (ecosystem, name), so an npm and a PyPI package
 * of the same name stay two entries. npm keeps the bare name.
 */
export function stackPackageKey(ecosystem: string | undefined, name: string): string {
  return !ecosystem || ecosystem === "npm" ? name : `${ecosystem}:${name}`;
}

export interface OrgStack {
  orgId: string;
  /** stackPackageKey -> package. */
  packages: Map<string, StackPackage>;
  /** releaseFeedUrl -> keys (stackPackageKey) of the packages that publish there (monorepos share one feed). */
  packagesByFeed: Map<string, string[]>;
  services: Map<string, StackService>;
  /** Runtime id -> repos that declare it (version files, manifests, images). */
  runtimes: Map<string, StackRuntime>;
  traits: Set<string>;
  scopedRepos?: Map<string, Set<string>>;
}

export interface MatchSource {
  kind: string;
  url: string;
  serviceKey: string | null;
  traits: string[];
  /** Runtime the source is about (`Source.runtime`), e.g. `php` for PHP security releases. */
  runtime: string | null;
}

export interface MatchItem {
  title: string;
  rawText: string;
}

export interface MatchResult {
  score: number;
  reason: string;
  packageId: string | null;
  serviceKey: string | null;
  repoIds: string[];
}

export const SCORES = {
  directRelease: 1,
  runtime: 1,
  transitiveRelease: 0.6,
  service: 0.7,
  mention: 0.5,
  trait: 0.4,
  mentionBoost: 0.1,
} as const;

const MENTION_SCAN_CHARS = 5000;

/** Lower-cased tokens that keep package-name punctuation (@scope/name-x.y). */
export function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9@/._-]+/)) {
    const token = raw.replace(/^[._-]+|[._-]+$/g, "");
    if (token) tokens.add(token);
  }
  return tokens;
}

// Bare names like "react" or "next" appear in ordinary prose; only names with
// punctuation are distinctive enough to count as a mention on their own.
function isDistinctiveName(name: string): boolean {
  return /[@/.-]/.test(name) && name.length >= 4;
}

function best(a: MatchResult | null, b: MatchResult | null): MatchResult | null {
  if (!a) return b;
  if (!b) return a;
  return b.score > a.score ? b : a;
}

function fromPackage(pkg: StackPackage, score: number, reason: string): MatchResult {
  return {
    score,
    reason,
    packageId: pkg.packageId,
    serviceKey: pkg.serviceKey,
    repoIds: [...pkg.repoIds],
  };
}

function fromService(service: StackService, score: number, reason: string): MatchResult {
  return { score, reason, packageId: null, serviceKey: service.key, repoIds: [...service.repoIds] };
}

/** `https://github.com/payloadcms/payload/releases.atom` -> `payload`. */
function feedRepoName(url: string): string | null {
  return /github\.com\/[^/]+\/([^/]+)\/releases\.atom$/.exec(url)?.[1]?.toLowerCase() ?? null;
}

/**
 * A release feed match. A monorepo feed (payloadcms/payload) is shared by every package it
 * publishes (`payload`, `@payloadcms/db-postgres`, ...): the match carries the repos of all
 * of them, so a repo is not left out because it installs a different package of the same
 * release train. The reason names one package: a direct one first, then the one named like
 * the feed's repo (`payload`), then the one most repos install.
 */
function feedRelease(url: string, stack: OrgStack): MatchResult | null {
  const pkgs = (stack.packagesByFeed.get(url) ?? []).flatMap((n) => stack.packages.get(n) ?? []);
  if (pkgs.length === 0) return null;
  const repoName = feedRepoName(url);
  // `@payloadcms/db-postgres` -> `db-postgres`; Go `github.com/acme/kit/v2` -> `kit`.
  const bareName = (name: string) =>
    name
      .replace(/\/v\d+$/, "")
      .split("/")
      .pop()
      ?.toLowerCase();
  const lead = [...pkgs].sort(
    (a, b) =>
      Number(b.direct) - Number(a.direct) ||
      Number(bareName(b.name) === repoName) - Number(bareName(a.name) === repoName) ||
      b.repoIds.size - a.repoIds.size
  )[0];
  return {
    ...fromPackage(
      lead,
      lead.direct ? SCORES.directRelease : SCORES.transitiveRelease,
      `release:${lead.name}`
    ),
    repoIds: [...new Set(pkgs.flatMap((p) => [...p.repoIds]))],
  };
}

export function matchItem(
  item: MatchItem,
  source: MatchSource,
  stack: OrgStack
): MatchResult | null {
  const scopes = source.traits.filter((t) => t.startsWith("scope:")).map((t) => t.slice(6));
  if (scopes.length) {
    const ids = new Set<string>();
    for (const scope of scopes) {
      if (scope.startsWith("ecosystem:")) {
        for (const pkg of stack.packages.values()) {
          if ((pkg.ecosystem ?? "npm") === scope.slice(10))
            for (const id of pkg.repoIds) ids.add(id);
        }
      } else if (scope.startsWith("runtime:")) {
        for (const id of stack.runtimes.get(scope.slice(8))?.repoIds ?? []) ids.add(id);
      } else {
        for (const id of stack.scopedRepos?.get(scope) ?? []) ids.add(id);
      }
    }
    const release = feedRelease(source.url, stack);
    if (release) {
      const repoIds = release.repoIds.filter((id) => ids.has(id));
      return repoIds.length ? { ...release, repoIds } : null;
    }
    return ids.size
      ? {
          score: SCORES.trait,
          reason: source.runtime ? `runtime:${source.runtime}` : `scope:${scopes.join("|")}`,
          packageId: null,
          serviceKey: source.serviceKey,
          repoIds: [...ids].sort(),
        }
      : null;
  }
  let result: MatchResult | null = null;

  result = best(result, feedRelease(source.url, stack));

  if (source.runtime) {
    const runtime = stack.runtimes.get(source.runtime);
    if (runtime) {
      result = best(result, {
        score: SCORES.runtime,
        reason: `runtime:${runtime.name}`,
        packageId: null,
        serviceKey: source.serviceKey,
        repoIds: [...runtime.repoIds],
      });
    }
  }

  if (source.serviceKey) {
    const service = stack.services.get(source.serviceKey);
    if (service)
      result = best(result, fromService(service, SCORES.service, `service:${service.key}`));
  }

  const trait = source.traits.find((t) => t === "always" || stack.traits.has(t));
  if (trait) {
    result = best(result, {
      score: SCORES.trait,
      reason: `trait:${trait}`,
      packageId: null,
      serviceKey: source.serviceKey,
      repoIds: [],
    });
  }

  const tokens = tokenize(`${item.title}\n${item.rawText.slice(0, MENTION_SCAN_CHARS)}`);
  let mention: MatchResult | null = null;
  for (const pkg of stack.packages.values()) {
    if (pkg.direct && isDistinctiveName(pkg.name) && tokens.has(pkg.name.toLowerCase())) {
      mention = best(mention, fromPackage(pkg, SCORES.mention, `mention:${pkg.name}`));
    }
  }
  for (const service of stack.services.values()) {
    const words = service.name
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 5);
    if (words.length > 0 && words.every((w) => tokens.has(w))) {
      mention = best(mention, fromService(service, SCORES.mention, `mention:${service.key}`));
    }
  }

  if (result && mention) {
    return {
      ...result,
      score: Math.min(1, result.score + SCORES.mentionBoost),
      reason: `${result.reason}+${mention.reason}`,
      repoIds: [...new Set([...result.repoIds, ...mention.repoIds])],
    };
  }
  return result ?? mention;
}
