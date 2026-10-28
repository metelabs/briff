import { posix } from "node:path";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { LockedDependency } from "./types";

type Table = Record<string, unknown>;
const table = (v: unknown): Table =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Table) : {};
const list = (v: unknown): unknown[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const text = (v: unknown): string => (typeof v === "string" ? v : "");
const literals = (value: unknown): { value: string; conditional: boolean; condition: string }[] =>
  list(value).flatMap((entry) => {
    const literal = text(entry) || text(table(entry)["#text"]);
    return literal
      ? [
          {
            value: literal,
            conditional: Boolean(table(entry).Condition),
            condition: text(table(entry).Condition),
          },
        ]
      : [];
  });
const texts = (value: unknown): string[] => literals(value).map((entry) => entry.value);
const id = (v: string) => /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(v);
const pin = (v: string) => /^\d+(?:\.\d+){1,3}(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/.test(v);

export function parseNugetFiles(
  files: Readonly<Record<string, string>>,
  warn: (message: string) => void = () => {}
): LockedDependency[] {
  const rows: LockedDependency[] = [];
  const projects = Object.keys(files).filter((f) => f.endsWith(".csproj"));
  const xml = new Map<string, Table>();
  for (const [file, content] of Object.entries(files)) {
    if (!file.endsWith(".csproj") && posix.basename(file) !== "Directory.Packages.props") continue;
    try {
      if (XMLValidator.validate(content) !== true) throw new Error("invalid XML");
      const parsed: unknown = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "",
        parseTagValue: false,
        processEntities: false,
      }).parse(content);
      xml.set(file, table(table(parsed).Project));
    } catch {
      warn(`skip ${file}: invalid NuGet manifest`);
    }
  }
  const locked = new Set<string>();
  for (const [file, content] of Object.entries(files)) {
    if (posix.basename(file) !== "packages.lock.json") continue;
    locked.add(posix.dirname(file));
    try {
      const parsed: unknown = JSON.parse(content);
      const deps = table(table(parsed).dependencies);
      const owners = projects.filter((p) => posix.dirname(p) === posix.dirname(file));
      for (const framework of Object.values(deps)) {
        for (const [name, value] of Object.entries(table(framework))) {
          const dep = table(value);
          const version = text(dep.resolved);
          if (!id(name) || !pin(version) || !["Direct", "Transitive"].includes(text(dep.type)))
            continue;
          rows.push({
            name: name.toLowerCase(),
            version,
            direct: dep.type === "Direct",
            ecosystem: "NuGet",
            ...(owners.length ? { project: owners.join(",") } : {}),
          });
        }
      }
    } catch {
      warn(`skip ${file}: invalid NuGet lockfile`);
    }
  }
  for (const file of projects) {
    if (locked.has(posix.dirname(file))) continue;
    const project = xml.get(file);
    if (!project) continue;
    const centralFile = Object.keys(files)
      .filter(
        (candidate) =>
          posix.basename(candidate) === "Directory.Packages.props" &&
          !posix.relative(posix.dirname(candidate), file).split("/").includes("..")
      )
      .sort(
        (a, b) =>
          posix.relative(posix.dirname(a), file).split("/").length -
          posix.relative(posix.dirname(b), file).split("/").length
      )[0];
    const central = centralFile ? xml.get(centralFile) : undefined;
    const properties = new Map<string, Set<string>>();
    for (const source of [central, project]) {
      for (const group of list(source?.PropertyGroup)) {
        for (const [key, value] of Object.entries(table(group))) {
          if (key === "Condition") continue;
          for (const literal of literals(value)) {
            const conditional = Boolean(table(group).Condition) || literal.conditional;
            const values = conditional
              ? (properties.get(key) ?? new Set<string>())
              : new Set<string>();
            values.add(literal.value);
            properties.set(key, values);
          }
        }
      }
    }
    const resolve = (input: string): string[] => {
      let values = new Set([input]);
      for (let i = 0; i < 20; i++) {
        const next = new Set<string>();
        let changed = false;
        for (const value of values) {
          const match = /\$\(([^)]+)\)/.exec(value);
          const replacements = match ? properties.get(match[1]) : undefined;
          if (!match || !replacements?.size) {
            next.add(value);
            continue;
          }
          for (const replacement of replacements) {
            const resolved = value.replaceAll(match[0], replacement);
            changed ||= resolved !== value;
            next.add(resolved);
            if (next.size > 256) {
              warn(`skip ${file}: too many NuGet property alternatives`);
              return [];
            }
          }
        }
        values = next;
        if (!changed) break;
      }
      return [...values];
    };
    const frameworks = [
      ...(properties.get("TargetFrameworks") ?? properties.get("TargetFramework") ?? []),
    ]
      .flatMap((value) => resolve(value).flatMap((entry) => entry.split(";")))
      .filter(Boolean);
    const needsFallback = (entries: ReturnType<typeof literals>): boolean => {
      if (entries.some((entry) => !entry.conditional)) return false;
      const covered = new Set(
        entries.flatMap((entry) => {
          const match = /^\s*['"]\$\(TargetFramework\)['"]\s*==\s*['"]([^'"]+)['"]\s*$/.exec(
            entry.condition
          );
          return match ? [match[1]] : [];
        })
      );
      return frameworks.length === 0 || frameworks.some((framework) => !covered.has(framework));
    };
    const enabled = [...(properties.get("ManagePackageVersionsCentrally") ?? [])].some((value) =>
      resolve(value).some((resolved) => resolved.toLowerCase() === "true")
    );
    const versions = new Map<string, Set<string>>();
    if (enabled)
      for (const group of list(central?.ItemGroup)) {
        for (const entry of list(table(group).PackageVersion)) {
          const dep = table(entry);
          const name = text(dep.Include) || text(dep.Update);
          if (name) {
            const key = name.toLowerCase();
            const alternatives = versions.get(key) ?? new Set<string>();
            for (const literal of texts(dep.Version))
              for (const version of resolve(literal)) alternatives.add(version);
            versions.set(key, alternatives);
          }
        }
      }
    for (const group of list(project.ItemGroup)) {
      for (const entry of list(table(group).PackageReference)) {
        const dep = table(entry);
        const name = text(dep.Include);
        if (!id(name)) continue;
        const declared = literals(dep.Version);
        const overrides = literals(dep.VersionOverride);
        const centralVersions = [...(versions.get(name.toLowerCase()) ?? [])];
        const base = [
          ...declared.flatMap((entry) => resolve(entry.value)),
          ...(needsFallback(declared) ? centralVersions : []),
        ];
        const alternatives = new Set([
          ...overrides.flatMap((entry) => resolve(entry.value)),
          ...(needsFallback(overrides) ? base : []),
        ]);
        for (const version of alternatives) {
          const exact = /^\[([^,]+)\]$/.exec(version)?.[1] ?? version;
          if (!pin(exact)) continue;
          rows.push({
            name: name.toLowerCase(),
            version: exact,
            direct: true,
            ecosystem: "NuGet",
            project: file,
          });
        }
      }
    }
  }
  const pins = new Map<string, string>();
  let differingPins = false;
  for (const row of rows) {
    const key = `${row.project ?? ""}\t${row.name}`;
    const previous = pins.get(key);
    if (previous !== undefined && previous !== row.version) differingPins = true;
    pins.set(key, row.version);
  }
  const conditional =
    differingPins ||
    Object.values(files).some((content) => /\bCondition\s*=|<TargetFrameworks[>\s]/.test(content));
  return conditional ? rows.map((row) => ({ ...row, requirement: "nuget-conditional" })) : rows;
}
