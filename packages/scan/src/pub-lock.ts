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
  project = "pubspec.yaml"
): LockedDependency[] {
  const spec = table(manifest === null ? {} : parse(manifest));
  const main = table(spec.dependencies);
  const dev = table(spec.dev_dependencies);
  const tool = "flutter" in main ? "flutter" : "dart";
  const owner = `${project}:${tool}`;
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
      const direct = entry.dependency === "direct main" || entry.dependency === "direct dev";
      return [
        {
          name,
          version,
          direct,
          ecosystem: "Pub" as const,
          ...(entry.dependency === "direct dev" ? { dev: true as const } : {}),
          ...(direct ? { project: owner } : {}),
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
