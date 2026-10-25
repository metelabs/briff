import { parse as parseYaml } from "yaml";

import type { DetectedRuntime } from "./types";

// Runtime detection: which language runtimes, databases and web servers a repo
// declares, from version files, manifests, Dockerfiles and compose files. Pure:
// callers pass file contents and the path relative to the repo root.

/** Canonical runtime ids. Security sources declare one of these (`Source.runtime`). */
export const RUNTIME_IDS = [
  "node",
  "php",
  "python",
  "go",
  "ruby",
  "java",
  "dotnet",
  "rust",
  "postgres",
  "mysql",
  "mariadb",
  "redis",
  "valkey",
  "nginx",
  "deno",
  "bun",
] as const;

export type RuntimeId = (typeof RUNTIME_IDS)[number];

/** Container images whose repository is not in IMAGE_RUNTIMES are reported under this name. */
export const UNKNOWN_IMAGE = "image";

/**
 * Image repository (Docker Hub `library/` and registry prefixes removed) -> runtime.
 * Extend here; unknown images are uploaded as `image` entries so they show up first.
 */
export const IMAGE_RUNTIMES: Readonly<Record<string, RuntimeId>> = {
  node: "node",
  php: "php",
  python: "python",
  golang: "go",
  ruby: "ruby",
  "eclipse-temurin": "java",
  openjdk: "java",
  amazoncorretto: "java",
  rust: "rust",
  postgres: "postgres",
  "postgis/postgis": "postgres",
  mysql: "mysql",
  mariadb: "mariadb",
  redis: "redis",
  "valkey/valkey": "valkey",
  nginx: "nginx",
  "nginxinc/nginx-unprivileged": "nginx",
  "denoland/deno": "deno",
  "oven/bun": "bun",
};

/** Image repository prefixes that map to one runtime whatever the rest (sdk, aspnet, runtime). */
const IMAGE_PREFIX_RUNTIMES: readonly (readonly [string, RuntimeId])[] = [
  ["mcr.microsoft.com/dotnet/", "dotnet"],
];

/** Tool names in `.tool-versions` (asdf) and `mise.toml` -> runtime. */
const TOOL_RUNTIMES: Readonly<Record<string, RuntimeId>> = {
  node: "node",
  nodejs: "node",
  php: "php",
  python: "python",
  go: "go",
  golang: "go",
  ruby: "ruby",
  java: "java",
  dotnet: "dotnet",
  "dotnet-core": "dotnet",
  rust: "rust",
  postgres: "postgres",
  postgresql: "postgres",
  mysql: "mysql",
  mariadb: "mariadb",
  redis: "redis",
  valkey: "valkey",
  nginx: "nginx",
  deno: "deno",
  bun: "bun",
};

/** Node LTS codenames as used by `.nvmrc` (`lts/iron`). */
const NODE_LTS: Readonly<Record<string, string>> = {
  argon: "4",
  boron: "6",
  carbon: "8",
  dubnium: "10",
  erbium: "12",
  fermium: "14",
  gallium: "16",
  hydrogen: "18",
  iron: "20",
  jod: "22",
  krypton: "24",
};

export type RuntimeFileKind =
  | "nvmrc"
  | "node-version"
  | "package-json"
  | "tool-versions"
  | "mise"
  | "composer-json"
  | "composer-lock"
  | "python-version"
  | "pyproject"
  | "runtime-txt"
  | "pipfile"
  | "go-mod"
  | "ruby-version"
  | "gemfile-lock"
  | "pom"
  | "gradle"
  | "sdkmanrc"
  | "global-json"
  | "csproj"
  | "rust-toolchain"
  | "rust-toolchain-toml"
  | "cargo-toml"
  | "dockerfile"
  | "compose";

const FILE_KINDS: Readonly<Record<string, RuntimeFileKind>> = {
  ".nvmrc": "nvmrc",
  ".node-version": "node-version",
  "package.json": "package-json",
  ".tool-versions": "tool-versions",
  "mise.toml": "mise",
  ".mise.toml": "mise",
  "composer.json": "composer-json",
  "composer.lock": "composer-lock",
  ".python-version": "python-version",
  "pyproject.toml": "pyproject",
  "runtime.txt": "runtime-txt",
  Pipfile: "pipfile",
  "go.mod": "go-mod",
  ".ruby-version": "ruby-version",
  "Gemfile.lock": "gemfile-lock",
  "pom.xml": "pom",
  "build.gradle": "gradle",
  "build.gradle.kts": "gradle",
  ".sdkmanrc": "sdkmanrc",
  "global.json": "global-json",
  "rust-toolchain": "rust-toolchain",
  "rust-toolchain.toml": "rust-toolchain-toml",
  "Cargo.toml": "cargo-toml",
  Dockerfile: "dockerfile",
  Containerfile: "dockerfile",
};

/** File names `runtimeFileKind` knows exactly; the names it matches by pattern are in files.ts. */
export const RUNTIME_FILE_NAMES: readonly string[] = Object.keys(FILE_KINDS);

/** Which runtime parser reads a file, by its base name; null when none does. */
export function runtimeFileKind(fileName: string): RuntimeFileKind | null {
  const exact = FILE_KINDS[fileName];
  if (exact) return exact;
  if (fileName.endsWith(".csproj")) return "csproj";
  if (
    /^(Dockerfile|Containerfile)\.(?!(md|txt)$)[\w.-]+$/.test(fileName) ||
    /\.[Dd]ockerfile$/.test(fileName)
  ) {
    return "dockerfile";
  }
  if (/^(docker-)?compose(\.[\w-]+)?\.ya?ml$/.test(fileName)) return "compose";
  return null;
}

const VERSION_NUMBER = /(?<![\d.])v?(\d+(?:\.\d+){0,2})/;

/** First `major[.minor[.patch]]` in the text (`>=8.2` -> `8.2`, `go1.23.2` -> `1.23.2`), or null. */
export function normalizeVersion(raw: string): string | null {
  const m = VERSION_NUMBER.exec(raw);
  return m ? m[1] : null;
}

function normalizeFor(name: string, raw: string): string | null {
  if (name === "node") {
    const lts = /^lts\/([a-z]+)$/i.exec(raw.trim());
    if (lts) return NODE_LTS[lts[1].toLowerCase()] ?? null;
  }
  const version = normalizeVersion(raw);
  // Java 8 and older are spelled 1.8 in build files; the release line is the minor.
  if (name === "java" && version && /^1\.\d+/.test(version)) {
    return version.split(".")[1];
  }
  return version;
}

/** A constraint rather than one version: an operator, a wildcard or alternatives. */
export function isVersionConstraint(raw: string): boolean {
  return /[\^~<>=*|]|\.[xX](?:\.|$)/.test(raw);
}

/** Dockerfile and compose rows name the image that runs; their tag is never a constraint. */
export function isImageSource(source: string): boolean {
  const file = source.split(" ")[0];
  const kind = runtimeFileKind(file.split("/").at(-1) ?? file);
  return kind === "dockerfile" || kind === "compose";
}

/** A runtime row as stored: `constraint` is null on rows written before the flag existed. */
type ConstraintInput = Pick<DetectedRuntime, "version" | "source" | "unresolved"> & {
  constraint?: boolean | null;
};

/**
 * Whether a row is a constraint (`engines.node >=20`): the scanner's flag when it sent one,
 * else derived from the text the same way (uploads from older scanners, rows stored before
 * the flag).
 */
export function isConstraintRow(row: ConstraintInput): boolean {
  if (row.constraint !== undefined && row.constraint !== null) return row.constraint;
  return !row.unresolved && !isImageSource(row.source) && isVersionConstraint(row.version);
}

function entry(name: string, version: string, source: string, unresolved = false): DetectedRuntime {
  const trimmed = version.trim();
  return {
    name,
    version: trimmed,
    normalized: unresolved ? null : normalizeFor(name, trimmed),
    source,
    unresolved,
    ...(!unresolved && isVersionConstraint(trimmed) ? { constraint: true } : {}),
  };
}

/** Whether the row's file sits at the repo root (`package.json`), not in a workspace package. */
function atRoot(source: string): boolean {
  return !source.split(" ")[0].includes("/");
}

/**
 * The rows of one repo and runtime that say what it runs, for end-of-life and advisory
 * checks: the concrete ones (image tag, version file, go.mod, composer platform) when there
 * are any; else the constraints at the repo root, so a workspace package's `engines` never
 * outweighs the root's; else every constraint. Display still shows every row.
 */
export function runtimeEvidence<T extends ConstraintInput>(rows: readonly T[]): T[] {
  const concrete = rows.filter((r) => !isConstraintRow(r));
  if (concrete.length > 0) return concrete;
  const root = rows.filter((r) => atRoot(r.source));
  return root.length > 0 ? root : [...rows];
}

function firstLine(content: string): string | null {
  for (const line of content.split(/\r?\n/)) {
    const text = line.replace(/#.*$/, "").trim();
    if (text) return text;
  }
  return null;
}

function versionFile(name: string, content: string, source: string, strip?: RegExp) {
  const line = firstLine(content);
  if (!line) return [];
  const version = strip ? line.replace(strip, "") : line;
  return version ? [entry(name, version, source)] : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringAt(value: unknown, ...keys: string[]): string | null {
  let current = value;
  for (const key of keys) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return typeof current === "string" && current.trim() ? current : null;
}

function jsonFields(
  content: string,
  source: string,
  fields: readonly { name: RuntimeId; path: string[] }[]
): DetectedRuntime[] {
  const data: unknown = JSON.parse(content);
  return fields.flatMap(({ name, path }) => {
    const value = stringAt(data, ...path);
    return value ? [entry(name, value, `${source} ${path.join(".")}`)] : [];
  });
}

type TomlSections = Map<string, Map<string, string>>;

function unquote(text: string): string | null {
  const m = /^"((?:[^"\\]|\\.)*)"|^'([^']*)'/.exec(text.trim());
  return m ? (m[1] ?? m[2]) : null;
}

/**
 * Just enough TOML for version fields: `[section]` headers and single-line
 * `key = "value"`, `key = ["first", ...]` or `key = { version = "x" }`.
 */
export function readTomlStrings(content: string): TomlSections {
  const sections: TomlSections = new Map([["", new Map()]]);
  let current = sections.get("")!;
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const header = /^\[\[?\s*([^\]]+?)\s*\]\]?/.exec(line);
    if (header) {
      const name = header[1].replace(/["']/g, "");
      current = sections.get(name) ?? new Map();
      sections.set(name, current);
      continue;
    }
    const kv = /^("[^"]+"|'[^']+'|[\w.-]+)\s*=\s*(.+)$/.exec(line);
    if (!kv) continue;
    const key = kv[1].replace(/^["']|["']$/g, "");
    const rest = kv[2].trim();
    let value: string | null = null;
    if (rest.startsWith("[")) value = unquote(rest.slice(1));
    else if (rest.startsWith("{")) {
      const inner = /\bversion\s*=\s*("[^"]*"|'[^']*')/.exec(rest);
      value = inner ? unquote(inner[1]) : null;
    } else value = unquote(rest);
    if (value !== null && value.trim()) current.set(key, value);
  }
  return sections;
}

function tomlField(
  sections: TomlSections,
  section: string,
  key: string,
  name: RuntimeId,
  source: string
): DetectedRuntime[] {
  const value = sections.get(section)?.get(key);
  return value ? [entry(name, value, `${source} ${key}`)] : [];
}

function parseToolVersions(content: string, source: string): DetectedRuntime[] {
  return content.split(/\r?\n/).flatMap((raw) => {
    const [tool, version] = raw.replace(/#.*$/, "").trim().split(/\s+/);
    const name = tool ? TOOL_RUNTIMES[tool] : undefined;
    return name && version ? [entry(name, version, source)] : [];
  });
}

function parseMise(content: string, source: string): DetectedRuntime[] {
  const tools = readTomlStrings(content).get("tools");
  if (!tools) return [];
  return [...tools].flatMap(([tool, version]) => {
    const name = TOOL_RUNTIMES[tool.replace(/^core:/, "")];
    return name ? [entry(name, version, `${source} tools.${tool}`)] : [];
  });
}

function parseGoMod(content: string, source: string): DetectedRuntime[] {
  const out: DetectedRuntime[] = [];
  const go = /^go\s+(\S+)/m.exec(content);
  if (go) out.push(entry("go", go[1], `${source} go`));
  const toolchain = /^toolchain\s+(\S+)/m.exec(content);
  if (toolchain) out.push(entry("go", toolchain[1].replace(/^go/, ""), `${source} toolchain`));
  return out;
}

function parseGemfileLock(content: string, source: string): DetectedRuntime[] {
  const m = /^RUBY VERSION\r?\n\s+ruby\s+(\S+)/m.exec(content);
  return m ? [entry("ruby", m[1], source)] : [];
}

function xmlTag(content: string, tag: string): string | null {
  const m = new RegExp(`<${tag.replace(/\./g, "\\.")}>\\s*([^<]+?)\\s*</`).exec(content);
  return m ? m[1] : null;
}

function parsePom(content: string, source: string): DetectedRuntime[] {
  // The first that is set wins: release is what javac targets, java.version is Spring Boot's.
  for (const tag of ["maven.compiler.release", "maven.compiler.target", "java.version"]) {
    const value = xmlTag(content, tag);
    if (value) return [entry("java", value, `${source} ${tag}`, value.includes("$"))];
  }
  return [];
}

function parseGradle(content: string, source: string): DetectedRuntime[] {
  const toolchain =
    /JavaLanguageVersion\.of\(\s*["']?(\d+)["']?\s*\)/.exec(content) ??
    /jvmToolchain\(\s*(\d+)\s*\)/.exec(content);
  if (toolchain) return [entry("java", toolchain[1], `${source} toolchain`)];
  const compat =
    /sourceCompatibility\s*=?\s*(?:JavaVersion\.VERSION_([\d_]+)|["']([\d.]+)["']|([\d.]+))/.exec(
      content
    );
  if (!compat) return [];
  const version = compat[1] ? compat[1].replace(/_/g, ".") : (compat[2] ?? compat[3]);
  return [entry("java", version, `${source} sourceCompatibility`)];
}

function parseSdkmanrc(content: string, source: string): DetectedRuntime[] {
  const m = /^\s*java\s*=\s*(\S+)/m.exec(content);
  return m ? [entry("java", m[1], `${source} java`)] : [];
}

function parseCsproj(content: string, source: string): DetectedRuntime[] {
  const value = xmlTag(content, "TargetFrameworks") ?? xmlTag(content, "TargetFramework");
  if (!value) return [];
  return value.split(";").flatMap((tfm) => {
    // net8.0, net8.0-windows, netcoreapp3.1; netstandard and .NET Framework (net48) are not runtimes here.
    const m = /^net(?:coreapp)?(\d+\.\d+)/.exec(tfm.trim());
    return m
      ? [{ ...entry("dotnet", tfm.trim(), `${source} TargetFramework`), normalized: m[1] }]
      : [];
  });
}

/** `docker.io/library/php` -> `php`; registry hosts other than Docker Hub stay. */
export function imageRepository(reference: string): {
  repository: string;
  tag: string | null;
  digest: string | null;
} {
  const [withoutDigest, digest] = reference.split("@");
  const slash = withoutDigest.lastIndexOf("/");
  const colon = withoutDigest.lastIndexOf(":");
  const hasTag = colon > slash;
  const repo = (hasTag ? withoutDigest.slice(0, colon) : withoutDigest).toLowerCase();
  const tag = hasTag ? withoutDigest.slice(colon + 1) : null;
  const repository = repo
    .replace(/^(?:docker\.io|index\.docker\.io|registry-1\.docker\.io)\//, "")
    .replace(/^public\.ecr\.aws\/docker\/library\//, "")
    .replace(/^library\//, "");
  return { repository, tag, digest: digest || null };
}

function runtimeForImage(repository: string): RuntimeId | null {
  const exact = IMAGE_RUNTIMES[repository];
  if (exact) return exact;
  for (const [prefix, id] of IMAGE_PREFIX_RUNTIMES) if (repository.startsWith(prefix)) return id;
  return null;
}

/** Version prefix of an image tag: `8.3-fpm-alpine` -> 8.3, `alpine-2.0.0` -> 2.0.0, `lts` -> null. */
export function tagVersion(tag: string): string | null {
  const lead = /^v?(\d+(?:\.\d+){0,2})/.exec(tag);
  if (lead) return lead[1];
  const variant = /-v?(\d+\.\d+(?:\.\d+)?)(?=$|-)/.exec(tag);
  return variant ? variant[1] : null;
}

/** One image reference (from FROM or compose `image:`) as a runtime entry. */
export function imageRuntime(reference: string, source: string): DetectedRuntime {
  const { repository, tag, digest } = imageRepository(reference);
  const name = repository.includes("$") ? null : runtimeForImage(repository);
  if (!name) {
    return {
      name: UNKNOWN_IMAGE,
      version: reference,
      normalized: null,
      source,
      unresolved: reference.includes("$"),
    };
  }
  // Pinned by digest only: the version is real but unknown here, so keep the
  // reference and flag it like a variable tag rather than claiming `latest`.
  if (!tag && digest) {
    return {
      name,
      version: reference,
      normalized: null,
      source,
      unresolved: true,
      image: repository,
    };
  }
  const version = tag ?? "latest";
  const unresolved = version.includes("$");
  return {
    name,
    version,
    normalized: unresolved ? null : tagVersion(version),
    source,
    unresolved,
    image: repository,
  };
}

/** FROM lines with continuations joined and comments dropped. */
function dockerInstructions(content: string): string[] {
  const out: string[] = [];
  let pending = "";
  for (const raw of content.split(/\r?\n/)) {
    if (/^\s*#/.test(raw)) continue;
    const continued = /\\\s*$/.test(raw);
    pending += `${raw.replace(/\\\s*$/, "")} `;
    if (continued) continue;
    if (pending.trim()) out.push(pending.trim());
    pending = "";
  }
  if (pending.trim()) out.push(pending.trim());
  return out;
}

export function parseDockerfile(content: string, source: string): DetectedRuntime[] {
  const stages = new Set<string>();
  const out: DetectedRuntime[] = [];
  for (const line of dockerInstructions(content)) {
    const m = /^FROM\s+(.+)$/i.exec(line);
    if (!m) continue;
    const words = m[1].split(/\s+/).filter((w) => !w.startsWith("--"));
    const [image, as, alias] = words;
    if (!image) continue;
    // A stage built on an earlier stage, or on nothing, names no runtime.
    const builtOnStage = image.toLowerCase() === "scratch" || stages.has(image.toLowerCase());
    if (as?.toLowerCase() === "as" && alias) stages.add(alias.toLowerCase());
    if (builtOnStage) continue;
    out.push(imageRuntime(image, source));
  }
  return out;
}

export function parseCompose(content: string, source: string): DetectedRuntime[] {
  const data: unknown = parseYaml(content);
  const services = isRecord(data) ? data.services : undefined;
  if (!isRecord(services)) return [];
  return Object.values(services).flatMap((service) => {
    const image = stringAt(service, "image");
    return image ? [imageRuntime(image.trim(), source)] : [];
  });
}

/** Runtimes declared by one file. `source` is its path relative to the repo root. */
export function parseRuntimeFile(
  kind: RuntimeFileKind,
  content: string,
  source: string
): DetectedRuntime[] {
  switch (kind) {
    case "nvmrc":
    case "node-version":
      return versionFile("node", content, source);
    case "package-json":
      return jsonFields(content, source, [
        { name: "node", path: ["engines", "node"] },
        { name: "node", path: ["volta", "node"] },
      ]);
    case "tool-versions":
      return parseToolVersions(content, source);
    case "mise":
      return parseMise(content, source);
    case "composer-json":
      return jsonFields(content, source, [
        { name: "php", path: ["require", "php"] },
        { name: "php", path: ["config", "platform", "php"] },
      ]);
    case "composer-lock":
      return jsonFields(content, source, [
        { name: "php", path: ["platform", "php"] },
        { name: "php", path: ["platform-overrides", "php"] },
      ]);
    case "python-version":
      return versionFile("python", content, source);
    case "pyproject": {
      const toml = readTomlStrings(content);
      return [
        ...tomlField(toml, "project", "requires-python", "python", source),
        ...tomlField(toml, "tool.poetry.dependencies", "python", "python", source),
      ];
    }
    case "runtime-txt":
      return versionFile("python", content, source, /^python-/);
    case "pipfile": {
      const toml = readTomlStrings(content);
      const full = tomlField(toml, "requires", "python_full_version", "python", source);
      return full.length > 0
        ? full
        : tomlField(toml, "requires", "python_version", "python", source);
    }
    case "go-mod":
      return parseGoMod(content, source);
    case "ruby-version":
      return versionFile("ruby", content, source, /^ruby-/);
    case "gemfile-lock":
      return parseGemfileLock(content, source);
    case "pom":
      return parsePom(content, source);
    case "gradle":
      return parseGradle(content, source);
    case "sdkmanrc":
      return parseSdkmanrc(content, source);
    case "global-json":
      return jsonFields(content, source, [{ name: "dotnet", path: ["sdk", "version"] }]);
    case "csproj":
      return parseCsproj(content, source);
    case "rust-toolchain":
      return versionFile("rust", content, source);
    case "rust-toolchain-toml":
      return tomlField(readTomlStrings(content), "toolchain", "channel", "rust", source);
    case "cargo-toml": {
      const toml = readTomlStrings(content);
      const own = tomlField(toml, "package", "rust-version", "rust", source);
      return own.length > 0
        ? own
        : tomlField(toml, "workspace.package", "rust-version", "rust", source);
    }
    case "dockerfile":
      return parseDockerfile(content, source);
    case "compose":
      return parseCompose(content, source);
  }
}

/** One row per (name, source, version) across files, sorted for stable output. */
export function mergeRuntimes(lists: DetectedRuntime[][]): DetectedRuntime[] {
  const merged = new Map<string, DetectedRuntime>();
  for (const list of lists) {
    for (const runtime of list) {
      merged.set(`${runtime.name}\0${runtime.source}\0${runtime.version}`, runtime);
    }
  }
  return [...merged.values()].sort(
    (a, b) =>
      a.name.localeCompare(b.name) ||
      a.source.localeCompare(b.source) ||
      a.version.localeCompare(b.version)
  );
}
