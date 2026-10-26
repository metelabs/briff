import { posix } from "node:path";
import { parse } from "smol-toml";

import type { LockedDependency } from "./types";

type Table = Record<string, unknown>;
function table(value: unknown): Table {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Table) : {};
}

function matches(pattern: string, name: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}/Cargo\\.toml$`).test(name);
}

/** Registry pins only; workspace declarations select direct pins, including renamed crates. */
export function parseCargoLock(
  content: string,
  manifests: Readonly<Record<string, string>>
): LockedDependency[] {
  const lock = parse(content);
  if (lock.version !== 3 && lock.version !== 4) throw new Error("unsupported Cargo.lock version");
  const root = table(parse(manifests["Cargo.toml"] ?? ""));
  const workspace = table(root.workspace);
  const patterns = (value: unknown) =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  const members = patterns(workspace.members);
  const excludes = patterns(workspace.exclude);
  const inherited = table(workspace.dependencies);
  const selected = new Set([
    "Cargo.toml",
    ...Object.keys(manifests).filter(
      (file) => members.some((p) => matches(p, file)) && !excludes.some((p) => matches(p, file))
    ),
  ]);
  // Cargo includes in-tree path dependencies as members, including their path dependencies.
  if (root.workspace) {
    for (const file of selected) {
      const manifest = table(parse(manifests[file] ?? ""));
      for (const section of [manifest, ...Object.values(table(manifest.target)).map(table)]) {
        for (const key of ["dependencies", "dev-dependencies", "build-dependencies"]) {
          for (const [alias, value] of Object.entries(table(section[key]))) {
            const declared = table(value);
            const inheritedSpec = declared.workspace === true;
            const spec = inheritedSpec ? table(inherited[alias]) : declared;
            if (typeof spec.path !== "string") continue;
            const member = posix.join(
              inheritedSpec ? "." : posix.dirname(file),
              spec.path,
              "Cargo.toml"
            );
            if (
              !member.startsWith("../") &&
              manifests[member] !== undefined &&
              !excludes.some((p) => matches(p, member))
            )
              selected.add(member);
          }
        }
      }
    }
  }
  const direct = new Map<string, boolean>();
  const projects = new Set<string>();
  for (const [file, text] of Object.entries(manifests)) {
    if (!selected.has(file)) continue;
    const manifest = table(parse(text));
    const projectName = table(manifest.package).name;
    if (typeof projectName === "string") projects.add(projectName);
    const sections = [manifest, ...Object.values(table(manifest.target)).map(table)];
    for (const section of sections) {
      for (const key of ["dependencies", "dev-dependencies", "build-dependencies"]) {
        for (const [alias, value] of Object.entries(table(section[key]))) {
          const declared = table(value);
          const spec = declared.workspace === true ? table(inherited[alias]) : declared;
          if (spec.path || spec.git || spec.registry) continue;
          const name = typeof spec.package === "string" ? spec.package : alias;
          direct.set(name, (direct.get(name) ?? true) && key === "dev-dependencies");
        }
      }
    }
  }
  const packages = (Array.isArray(lock.package) ? lock.package : []).map(table);
  const references = new Set(
    packages
      .filter((p) => !p.source && typeof p.name === "string" && projects.has(p.name))
      .flatMap((p) => patterns(p.dependencies))
      .map((ref) => ref.split(" ").slice(0, 2).join(" "))
  );
  return packages.flatMap((pkg) => {
    if (
      typeof pkg.name !== "string" ||
      typeof pkg.version !== "string" ||
      pkg.source !== "registry+https://github.com/rust-lang/crates.io-index"
    )
      return [];
    const isDirect =
      direct.has(pkg.name) &&
      (references.has(pkg.name) || references.has(`${pkg.name} ${pkg.version}`));
    return [
      {
        name: pkg.name,
        version: pkg.version,
        direct: isDirect,
        ecosystem: "crates.io" as const,
        requirement: pkg.version,
        ...(isDirect && direct.get(pkg.name) ? { dev: true as const } : {}),
      },
    ];
  });
}
