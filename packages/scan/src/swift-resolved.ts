import { swiftPackageName } from "./swift-url";
import type { LockedDependency } from "./types";

type Table = Record<string, unknown>;
const table = (value: unknown): Table =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Table) : {};
const text = (value: unknown): string => (typeof value === "string" ? value : "");

export function parseSwiftResolved(
  content: string,
  manifest: string | null,
  project = "Package.swift"
): LockedDependency[] {
  const parsed = table(JSON.parse(content));
  if (![1, 2, 3].includes(Number(parsed.version)))
    throw new Error("unsupported Package.resolved version");
  const pins = parsed.version === 1 ? table(parsed.object).pins : parsed.pins;
  if (!Array.isArray(pins)) throw new Error("invalid Package.resolved pins");
  const source = (manifest ?? "").replace(
    /"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (token) => (token.startsWith('"') ? token : " ")
  );
  const direct = new Set(
    [
      ...source.matchAll(/\.package\s*\(\s*(?:name\s*:\s*"[^"\\]*"\s*,\s*)?url\s*:\s*"([^"\\]+)"/g),
    ].flatMap((match) => swiftPackageName(match[1]) ?? [])
  );
  return pins.flatMap((value) => {
    const pin = table(value);
    if (parsed.version !== 1 && pin.kind !== "remoteSourceControl") return [];
    const name = swiftPackageName(text(pin.repositoryURL) || text(pin.location));
    const version = text(table(pin.state).version);
    if (!name || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/.test(version))
      return [];
    const isDirect = direct.has(name);
    return [
      {
        name,
        version,
        direct: isDirect,
        ecosystem: "SwiftURL" as const,
        ...(isDirect ? { project } : {}),
      },
    ];
  });
}
