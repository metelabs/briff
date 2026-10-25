import { normalizeVersion } from "./ecosystems";
import type { LockedDependency } from "./types";

// go.mod `require` directives. Since Go 1.17 a module's go.mod lists every module in its
// build list, the indirect ones marked `// indirect`, at the version minimal version
// selection picked, so it is the installed set (go.sum holds hashes of more versions than
// are selected and is not read).

interface Requirement {
  path: string;
  version: string;
  indirect: boolean;
}

interface Replacement {
  /** Absent: every version of the module is replaced. */
  oldVersion: string | null;
  /** Null for a local directory (`=> ../fork`), which is no released version. */
  target: { path: string; version: string } | null;
}

function unquote(token: string): string {
  return token.replace(/^"(.*)"$/, "$1").replace(/^`(.*)`$/, "$1");
}

/** Directive bodies, `require (...)` / `replace (...)` blocks unfolded into single lines. */
function directives(content: string): { verb: string; body: string; comment: string }[] {
  const out: { verb: string; body: string; comment: string }[] = [];
  let block: string | null = null;
  for (const raw of content.split(/\r?\n/)) {
    const commentAt = raw.indexOf("//");
    const comment = commentAt === -1 ? "" : raw.slice(commentAt + 2).trim();
    const line = (commentAt === -1 ? raw : raw.slice(0, commentAt)).trim();
    if (block !== null) {
      if (line === ")") block = null;
      else if (line) out.push({ verb: block, body: line, comment });
      continue;
    }
    const m = /^(\w+)\s*(.*)$/.exec(line);
    if (!m) continue;
    if (m[2] === "(") block = m[1];
    else out.push({ verb: m[1], body: m[2], comment });
  }
  return out;
}

function parseReplace(body: string): [string, Replacement] | null {
  const [left, right] = body.split("=>").map((side) => side.trim().split(/\s+/).map(unquote));
  if (!left?.[0] || !right?.[0]) return null;
  const local = right[0].startsWith(".") || right[0].startsWith("/") || right.length < 2;
  return [
    left[0],
    {
      oldVersion: left[1] ?? null,
      target: local ? null : { path: right[0], version: right[1] },
    },
  ];
}

/**
 * Required modules with their selected versions. Direct unless marked `// indirect`. A
 * `replace` to another module version stands in for the required one (that is what gets
 * built), its `requirement` the replaced `module[@version]`; a replacement by a local
 * directory has no released version and is skipped.
 */
export function parseGoMod(content: string): LockedDependency[] {
  const requires: Requirement[] = [];
  const replaces = new Map<string, Replacement[]>();
  for (const d of directives(content)) {
    if (d.verb === "require") {
      const [path, version] = d.body.split(/\s+/).map(unquote);
      if (path && version) {
        requires.push({ path, version, indirect: /^indirect\b/.test(d.comment) });
      }
    } else if (d.verb === "replace") {
      const parsed = parseReplace(d.body);
      if (parsed) replaces.set(parsed[0], [...(replaces.get(parsed[0]) ?? []), parsed[1]]);
    }
  }
  return requires.flatMap((r) => {
    // Like Go, a replacement of this exact version wins over one of every version.
    const candidates = replaces.get(r.path) ?? [];
    const replacement =
      candidates.find((rep) => rep.oldVersion === r.version) ??
      candidates.find((rep) => rep.oldVersion === null);
    const built = replacement ? replacement.target : { path: r.path, version: r.version };
    if (!built) return [];
    return [
      {
        name: built.path,
        version: normalizeVersion("Go", built.version),
        direct: !r.indirect,
        ecosystem: "Go" as const,
        // `go get` would only change the requirement; the fix edits this replacement.
        ...(replacement
          ? {
              requirement: replacement.oldVersion ? `${r.path}@${replacement.oldVersion}` : r.path,
            }
          : {}),
      },
    ];
  });
}
