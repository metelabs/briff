import type { LockedDependency } from "./types";

/** Gemfile is Ruby code; inspect literal gem declarations without evaluating it. */
export function rubyDevGems(manifest: string | null): Set<string> {
  const declarations = new Map<string, boolean>();
  const groups: boolean[] = [];
  for (const raw of (manifest ?? "").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (/\bdo\s*$/.test(line)) {
      const names = [...line.matchAll(/:(\w+)/g)].map((m) => m[1]);
      groups.push(
        /^group\b/.test(line) &&
          names.length > 0 &&
          names.every((n) => n === "development" || n === "test")
      );
    }
    if (/^end\b/.test(line)) groups.pop();
    const gem = /^gem\s*[ (]\s*["']([\w.-]+)["'](.*)$/.exec(line);
    if (!gem) continue;
    const inline = /groups?:\s*(\[[^\]]*\]|:\w+)/.exec(gem[2]);
    const names = inline ? [...inline[1].matchAll(/:(\w+)/g)].map((m) => m[1]) : [];
    const dev =
      groups.some(Boolean) ||
      (names.length > 0 && names.every((n) => n === "development" || n === "test"));
    declarations.set(gem[1], (declarations.get(gem[1]) ?? true) && dev);
  }
  return new Set([...declarations].filter(([, dev]) => dev).map(([name]) => name));
}

/** Only registry GEM specs are OSV RubyGems packages; Git and path pins are excluded. */
export function parseRubyLock(content: string, manifest: string | null = null): LockedDependency[] {
  const direct = new Set<string>();
  const specs: { name: string; version: string }[] = [];
  let section = "";
  let inSpecs = false;
  for (const line of content.split(/\r?\n/)) {
    if (/^\S/.test(line)) {
      section = line.trim();
      inSpecs = false;
    }
    if (section === "DEPENDENCIES") {
      const dep = /^  ([\w.-]+)(?:\s|!|$)/.exec(line);
      if (dep) direct.add(dep[1]);
    }
    if (section !== "GEM") continue;
    if (line === "  specs:") {
      inSpecs = true;
      continue;
    }
    if (!inSpecs) continue;
    const spec = /^    ([\w.-]+) \((\d[\w.+-]*)\)$/.exec(line);
    if (!spec) continue;
    // Gem::Version canonicalizes prerelease hyphens to `.pre.`; a lock's hyphen starts its platform.
    const version = spec[2].split("-")[0];
    specs.push({ name: spec[1], version });
  }
  const dev = rubyDevGems(manifest);
  return [
    ...new Map(
      specs.map(({ name, version }) => [
        `${name}@${version}`,
        {
          name,
          version,
          direct: direct.has(name),
          ecosystem: "RubyGems" as const,
          ...(direct.has(name) && dev.has(name) ? { dev: true as const } : {}),
        },
      ])
    ).values(),
  ];
}
