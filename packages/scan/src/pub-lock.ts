import { posix } from "node:path";
import { parse } from "yaml";
import type { LockedDependency } from "./types";

type Table = Record<string, unknown>;
const table = (value: unknown): Table =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Table) : {};
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const publicHost = (value: string) =>
  ["", "https://pub.dev", "https://pub.dev/", "https://pub.dartlang.org"].includes(value);

export function parsePubLock(
  lock: string | null,
  manifest: string | null,
  project = "pubspec.yaml",
  manifests: Readonly<Record<string, string>> = {}
): LockedDependency[] {
  const spec = table(manifest === null ? {} : parse(manifest));
  const main = table(spec.dependencies);
  const dev = table(spec.dev_dependencies);
  const toolOf = (spec: Table) =>
    [
      ...Object.values(table(spec.dependencies)),
      ...Object.values(table(spec.dev_dependencies)),
    ].some((entry) => table(entry).sdk === "flutter")
      ? "flutter"
      : "dart";
  const owner = `${project}:${toolOf(spec)}`;
  const workspace = Array.isArray(spec.workspace)
    ? spec.workspace.filter((entry): entry is string => typeof entry === "string")
    : [];
  const declarations = [{ spec, file: project }];
  for (const [file, content] of Object.entries(manifests)) {
    const relative = posix.relative(posix.dirname(project), posix.dirname(file));
    if (!relative || relative.split("/").includes("..")) continue;
    const matches = workspace.some((pattern) => {
      const regex = pattern
        .split("/")
        .map((part) =>
          part === "**"
            ? ".*"
            : part
                .split("*")
                .map((value) => value.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
                .join("[^/]*")
        )
        .join("/");
      return new RegExp(`^${regex}/?$`).test(relative);
    });
    if (matches) declarations.push({ spec: table(parse(content)), file });
  }
  if (lock !== null) {
    const packages = table(table(parse(lock)).packages);
    return Object.entries(packages).flatMap(([name, value]) => {
      const entry = table(value);
      const description = entry.description;
      const host = typeof description === "string" ? "" : text(table(description).url);
      const version = text(entry.version);
      if (
        !/^[a-z][a-z0-9_]*$/.test(name) ||
        entry.source !== "hosted" ||
        !publicHost(host) ||
        !version
      )
        return [];
      const owners = declarations.filter(
        ({ spec }) => name in table(spec.dependencies) || name in table(spec.dev_dependencies)
      );
      const direct =
        owners.length > 0 ||
        entry.dependency === "direct main" ||
        entry.dependency === "direct dev";
      const devOnly = owners.length
        ? owners.every(({ spec }) => !(name in table(spec.dependencies)))
        : entry.dependency === "direct dev";
      const projects = owners.length
        ? owners.map(({ spec, file }) => `${file}:${toolOf(spec)}`).join(",")
        : owner;
      return [
        {
          name,
          version,
          direct,
          ecosystem: "Pub" as const,
          ...(devOnly ? { dev: true as const } : {}),
          ...(direct ? { project: projects } : {}),
        },
      ];
    });
  }
  return [...new Set([...Object.keys(main), ...Object.keys(dev)])].flatMap((name) => {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) return [];
    const value = table(spec.dependency_overrides)[name] ?? main[name] ?? dev[name];
    const entry = table(value);
    if (["git", "path", "sdk"].some((key) => key in entry)) return [];
    const hosted = typeof entry.hosted === "string" ? entry.hosted : text(table(entry.hosted).url);
    if (!publicHost(hosted)) return [];
    const version = text(value) || text(entry.version) || "any";
    return [
      {
        name,
        version,
        direct: true,
        ecosystem: "Pub" as const,
        unresolved: true,
        ...(!(name in main) ? { dev: true as const } : {}),
        project: owner,
      },
    ];
  });
}
