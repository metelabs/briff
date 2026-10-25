import { isNonRegistryVersion } from "./package-name";
import type { LockedDependency } from "./types";

function unquote(spec: string): string {
  return spec.trim().replace(/^"|"$/g, "");
}

function nameFromSpec(spec: string): string | null {
  const at = spec.indexOf("@", 1);
  return at > 0 ? spec.slice(0, at) : null;
}

/**
 * Parses yarn.lock v1 and Berry (v2+) entries. An entry is direct when one of
 * its header specs is exactly a range declared in package.json, which picks the
 * right version when several are installed.
 */
export function parseYarnLock(
  content: string,
  declaredRanges: Record<string, string>
): LockedDependency[] {
  const out: LockedDependency[] = [];
  const seen = new Map<string, LockedDependency>();
  let current: { name: string; direct: boolean } | null = null;

  for (const line of content.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    if (!line.startsWith(" ")) {
      current = null;
      if (!line.endsWith(":") || line.startsWith("__metadata")) continue;
      const specs = line.slice(0, -1).split(",").map(unquote);
      const name = nameFromSpec(specs[0]);
      if (!name) continue;
      const range = declaredRanges[name];
      const direct =
        range !== undefined &&
        specs.some((s) => s === `${name}@${range}` || s === `${name}@npm:${range}`);
      current = { name, direct };
      continue;
    }
    if (!current) continue;
    const match = /^\s{2}version:?\s+"?([^"\s]+)"?\s*$/.exec(line);
    if (!match) continue;
    const version = match[1];
    if (!isNonRegistryVersion(version)) {
      const id = `${current.name}@${version}`;
      const prev = seen.get(id);
      if (prev) prev.direct ||= current.direct;
      else {
        const dep = { name: current.name, version, direct: current.direct };
        seen.set(id, dep);
        out.push(dep);
      }
    }
    current = null;
  }
  return out;
}
