// Human-readable text for runtime versions that come from a constraint (`engines.node`,
// `require.php`, `requires-python`): ">=20" reads "20+", "^22.1.0" "22.x", "18 || 20"
// "18 or 20". Concrete versions (image tags, .nvmrc) are shown as they are. Pure: repo
// chips, upgrade lines and emails share it.

import { lineDepth } from "@/lib/runtime-security";
import { isVersionConstraint } from "@scan/runtimes";

const PLAIN = /^v?(\d+(?:\.\d+){0,2})$/;
const LOWER_BOUND = /^>=\s*v?(\d+(?:\.\d+){0,2})$/;
const CARET = /^\^\s*v?(\d+)(?:\.(\d+))?(?:\.\d+)?$/;
const TILDE = /^~\s*v?(\d+)(?:\.(\d+))?(?:\.\d+)?$/;
const WILDCARD = /^v?(\d+)(?:\.(\d+))?\.[xX*](?:\.[xX*])?$/;

/** `20.0.0` -> `20`, `22.12.0` -> `22.12`: trailing zero parts say nothing in a bound. */
function trimZeros(version: string): string {
  return version.replace(/(?:\.0)+$/, "");
}

/**
 * `depth` is the runtime's release-line depth (lineDepth): 1 for runtimes released per
 * major (node), 2 for per-minor ones (php), where `^8.3` keeps its floor as `8.3+`.
 */
function formatPart(part: string, depth: number): string | null {
  const text = part.trim();
  let m = PLAIN.exec(text);
  if (m) return m[1];
  m = LOWER_BOUND.exec(text);
  if (m) return `${trimZeros(m[1])}+`;
  m = CARET.exec(text);
  if (m) {
    // ^0.5.1 stays on 0.5; ^0 allows any 0.x.
    if (m[1] !== "0") return depth >= 2 && m[2] !== undefined ? `${m[1]}.${m[2]}+` : `${m[1]}.x`;
    return m[2] !== undefined ? `0.${m[2]}.x` : "0.x";
  }
  m = TILDE.exec(text);
  if (m) return m[2] !== undefined ? `${m[1]}.${m[2]}.x` : `${m[1]}.x`;
  m = WILDCARD.exec(text);
  if (m) return m[2] !== undefined ? `${m[1]}.${m[2]}.x` : `${m[1]}.x`;
  return null;
}

/** A constraint rather than one version: an operator, a wildcard or alternatives. */
export const isVersionRange = isVersionConstraint;

/**
 * `>=20` -> `20+`, `^22.1.0` -> `22.x`, `~8.2.0` -> `8.2.x`, `18 || 20` -> `18 or 20`;
 * with `runtime` set to a per-minor runtime, `^8.3` -> `8.3+`. Null for shapes it does not
 * read (`>=18 <21`, `lts/*`); callers show the raw text then.
 */
export function formatVersionRange(raw: string, runtime?: string): string | null {
  const depth = runtime ? lineDepth(runtime) : 1;
  const parts = raw
    .split(/\s*\|\|?\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const formatted: string[] = [];
  for (const part of parts) {
    const text = formatPart(part, depth);
    if (text === null) return null;
    if (!formatted.includes(text)) formatted.push(text);
  }
  if (formatted.length === 1) return formatted[0];
  return `${formatted.slice(0, -1).join(", ")} or ${formatted.at(-1)}`;
}

/**
 * The version to show for a runtime row: a constraint in its readable form (raw text when
 * the formatter does not read it), anything else as normalised (`22` for `22-alpine`).
 */
export function runtimeVersionLabel(row: {
  name: string;
  version: string;
  normalized: string | null;
  unresolved?: boolean;
}): string {
  if (!row.unresolved && isVersionRange(row.version)) {
    return formatVersionRange(row.version, row.name) ?? row.version.trim();
  }
  return row.normalized ?? row.version;
}
