// Repo names never leave the server: every LLM request that carries them is rewritten
// with per-request aliases (`repo-1`, `repo-2`, ...) and the response is mapped back.
// Aliases follow the code-point order of the request's distinct repo names, so the same
// set of names gives the same aliases; nothing about them is stored (docs/PRIVACY.md).

export const REPO_ALIAS_PREFIX = "repo-";

// A name counts wherever it is not part of a longer word: punctuation, `/`, `.`, `-` and
// `@` are boundaries, so URLs (`github.com/acme/ledger`), paths (`garden.example/docs`) and
// compounds (`ledger-staging`) lose the name too. Private text is over-redacted rather
// than leaked; restoring uses the same boundaries.
//
// Restoring gives back the form the request used: an alias that only ever replaced one
// spelling (`web`, from `@acme/web-sdk` or a sentence) returns as that spelling, so text the
// model repeats comes back unchanged; an alias used for several spellings (the full name in
// a structured field and the short name in text) returns as the full name.
const BEFORE = "(?<![\\p{L}\\p{N}])";
const AFTER = "(?![\\p{L}\\p{N}])";
const ALIAS_IN_TEXT = new RegExp(`${BEFORE}repo-(\\d+)${AFTER}`, "giu");

export interface RepoAliases {
  /** Number of distinct repo names aliased in this request. */
  readonly size: number;
  /** Alias of a known repo name (structured fields); unknown names are returned as is. */
  alias(name: string): string;
  /** Replaces repo names (full name or unambiguous last path segment) in text. */
  aliasText(text: string): string;
  /** Replaces aliases with the repo names they stood for; unknown aliases stay as written. */
  restoreText(text: string): string;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lastSegment(name: string): string {
  return name.split("/").pop() ?? name;
}

function insideAny(spans: readonly (readonly [number, number])[], start: number, end: number) {
  return spans.some(([s, e]) => s <= start && end <= e);
}

function alternation(tokens: Iterable<string>): RegExp | null {
  const list = [...tokens].sort((a, b) => b.length - a.length).map(escapeRegExp);
  return list.length === 0 ? null : new RegExp(`${BEFORE}(${list.join("|")})${AFTER}`, "giu");
}

/**
 * Aliases for one request. `keep` lists public names (packages, services) that are never
 * rewritten in text, neither as a whole nor in part: a repo called `next` or `web` must not
 * turn `npm i next@16` or `npm i @acme/web-sdk` into something else. Structured fields are
 * aliased regardless. `avoidIn` is the request text as it would go out without aliases;
 * numbers already used there as `repo-N` are skipped.
 */
export function repoAliases(
  names: Iterable<string>,
  keep: Iterable<string> = [],
  options: { avoidIn?: string; privateNames?: readonly string[] } = {}
): RepoAliases {
  const sorted = [
    ...new Set([...names, ...(options.privateNames ?? [])].filter((n) => n.length > 0)),
  ].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  // A `repo-N` the request already contains (a URL, a package) is never handed out, so
  // restoring only touches aliases this request introduced.
  const taken = new Set(
    [...(options.avoidIn ?? "").matchAll(ALIAS_IN_TEXT)].map((m) => Number(m[1]))
  );
  const byName = new Map<string, string>();
  const byAlias = new Map<number, string>();
  let next = 1;
  for (const name of sorted) {
    while (taken.has(next)) next++;
    byName.set(name, `${REPO_ALIAS_PREFIX}${next}`);
    byAlias.set(next, name);
    next++;
  }
  const privateNames = new Set((options.privateNames ?? []).map((name) => name.toLowerCase()));
  const kept = new Set(
    [...keep].map((k) => k.toLowerCase()).filter((k) => k.length > 0 && !privateNames.has(k))
  );
  // Alias -> spellings it replaced in this request (lower-cased -> first original).
  const used = new Map<string, Map<string, string>>();
  const record = (alias: string, surface: string) => {
    const forms = used.get(alias) ?? new Map<string, string>();
    if (!forms.has(surface.toLowerCase())) forms.set(surface.toLowerCase(), surface);
    used.set(alias, forms);
  };
  const restored = (n: number): string | undefined => {
    const name = byAlias.get(n);
    const forms = used.get(`${REPO_ALIAS_PREFIX}${n}`);
    return forms?.size === 1 ? [...forms.values()][0] : name;
  };

  // Text tokens: every full name, plus a last path segment (`pantheon` of `sigma/pantheon`)
  // when no other repo shares it, because people and derived sentences use the short form.
  // Short ones (`ui` of `acme/ui`) too: the word "ui" in text is over-redacted, never leaked.
  const tokens = new Map<string, string>();
  const segments = new Map<string, string[]>();
  for (const name of sorted) {
    const seg = lastSegment(name).toLowerCase();
    segments.set(seg, [...(segments.get(seg) ?? []), name]);
  }
  for (const name of sorted) {
    if (!kept.has(name.toLowerCase())) tokens.set(name.toLowerCase(), byName.get(name) as string);
  }
  for (const [seg, owners] of segments) {
    if (owners.length !== 1 || tokens.has(seg) || kept.has(seg)) continue;
    tokens.set(seg, byName.get(owners[0]) as string);
  }
  const namePattern = alternation(tokens.keys());
  const keptPattern = alternation(kept);

  const keptSpans = (text: string): (readonly [number, number])[] =>
    keptPattern
      ? [...text.matchAll(keptPattern)].map((m) => [m.index, m.index + m[0].length] as const)
      : [];

  return {
    size: sorted.length,
    alias: (name) => {
      const alias = byName.get(name);
      if (!alias) return name;
      record(alias, name);
      return alias;
    },
    aliasText: (text) => {
      if (!namePattern) return text;
      // A repo name is kept only when it lies wholly inside a public name (`web` in
      // `@acme/web-sdk`); a public name inside a repo name (`next` in `acme/next-app`) or
      // overlapping one does not protect it.
      const kept = keptSpans(text);
      return text.replace(namePattern, (m: string, _g: string, at: number) => {
        const alias = tokens.get(m.toLowerCase());
        if (!alias || insideAny(kept, at, at + m.length)) return m;
        record(alias, m);
        return alias;
      });
    },
    // A public name that happens to contain an alias (`@acme/repo-1`) is left as it is.
    restoreText: (text) => {
      const kept = keptSpans(text);
      return text.replace(ALIAS_IN_TEXT, (m: string, n: string, at: number) =>
        insideAny(kept, at, at + m.length) ? m : (restored(Number(n)) ?? m)
      );
    },
  };
}
