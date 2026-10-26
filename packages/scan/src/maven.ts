import { posix } from "node:path";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { parse as parseToml } from "smol-toml";
import type { LockedDependency } from "./types";

type Table = Record<string, unknown>;
const table = (value: unknown): Table =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Table) : {};
const list = (value: unknown): unknown[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const literal = (value: string) => /^[0-9][A-Za-z0-9_.-]*$/.test(value);
const coordinate = (value: string) => /^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/.test(value);

function pom(content: string): Table {
  if (XMLValidator.validate(content) !== true) throw new Error("invalid pom.xml");
  const parsed: unknown = new XMLParser({
    parseTagValue: false,
    removeNSPrefix: true,
    processEntities: false,
  }).parse(content);
  return table(table(parsed).project);
}

// Constraints affect resolution but do not install a package by themselves.
function gradleDependencies(content: string): string {
  let clean = content.replace(
    /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (token) => (token.startsWith("/") ? " " : token)
  );
  for (const match of [...clean.matchAll(/\bconstraints\s*\{/g)].reverse()) {
    const start = match.index;
    const tail = clean.slice(start + match[0].length);
    let depth = 1;
    for (const token of tail.matchAll(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[{}]/g)) {
      if (token[0] === "{") depth++;
      if (token[0] === "}") depth--;
      if (depth === 0) {
        clean = clean.slice(0, start) + " " + tail.slice(token.index + 1);
        break;
      }
    }
  }
  return clean;
}

/** Static manifests only: local parent properties and dependency management, without executing builds. */
export function parseMavenFiles(files: Readonly<Record<string, string>>): LockedDependency[] {
  const rows: LockedDependency[] = [];
  const poms = new Map(
    Object.entries(files)
      .filter(([f]) => posix.basename(f) === "pom.xml")
      .map(([f, c]) => [f, pom(c)])
  );
  type Model = {
    properties: Record<string, string>;
    expressions: Record<string, string>;
    managed: Map<string, string>;
  };
  const models = new Map<string, Model>();
  const model = (file: string, visiting = new Set<string>()): Model => {
    const cached = models.get(file);
    if (cached) return cached;
    if (visiting.has(file)) return { properties: {}, expressions: {}, managed: new Map() };
    visiting.add(file);
    const project = poms.get(file) ?? {};
    const parent = table(project.parent);
    const relative =
      !project.parent || parent.relativePath === ""
        ? null
        : text(parent.relativePath) || "../pom.xml";
    const parentFile = relative ? posix.normalize(posix.join(posix.dirname(file), relative)) : "";
    const inherited = poms.has(parentFile)
      ? model(parentFile, visiting)
      : { properties: {}, expressions: {}, managed: new Map<string, string>() };
    const properties = {
      ...inherited.expressions,
      ...Object.fromEntries(
        Object.entries(table(project.properties)).map(([k, v]) => [k, text(v)])
      ),
    };
    properties["project.version"] = text(project.version) || text(parent.version);
    properties["project.groupId"] = text(project.groupId) || text(parent.groupId);
    properties["pom.version"] = properties["project.version"];
    const expressions = { ...properties };
    const resolve = (value: string): string => {
      for (let i = 0; i < 20 && value.includes("${"); i++) {
        const next = value.replace(
          /\$\{([^}]+)\}/g,
          (match: string, key: string) => properties[key] ?? match
        );
        if (next === value) break;
        value = next;
      }
      return value;
    };
    for (const key of Object.keys(properties)) properties[key] = resolve(properties[key]);
    const managed = new Map(inherited.managed);
    for (const entry of list(table(table(project.dependencyManagement).dependencies).dependency)) {
      const dep = table(entry);
      const name = `${resolve(text(dep.groupId))}:${resolve(text(dep.artifactId))}`;
      const version = text(dep.version);
      if (coordinate(name) && version && dep.scope !== "import") managed.set(name, version);
    }
    const result = { properties, expressions, managed };
    models.set(file, result);
    return result;
  };
  for (const [file, project] of poms) {
    const { properties, managed } = model(file);
    const resolve = (v: unknown) =>
      text(v).replace(/\$\{([^}]+)\}/g, (match: string, key: string) => properties[key] ?? match);
    for (const entry of list(table(project.dependencies).dependency)) {
      const dep = table(entry);
      const name = `${resolve(dep.groupId)}:${resolve(dep.artifactId)}`;
      const version = resolve(dep.version) || resolve(managed.get(name));
      if (!coordinate(name) || !literal(version) || dep.scope === "import") continue;
      rows.push({
        name,
        version,
        direct: true,
        ecosystem: "Maven",
        manager: "maven",
        project: file,
        ...(dep.scope === "test" ? { dev: true as const } : {}),
      });
    }
  }
  type Declaration = {
    name: string;
    version: string;
    project: string;
    owner: string;
    dev: boolean;
  };
  const declarations: Declaration[] = [];
  const builds = Object.entries(files).filter(([file]) =>
    /(?:^|\/)build\.gradle(?:\.kts)?$/.test(file)
  );
  for (const [file, content] of builds) {
    const clean = gradleDependencies(content);
    for (const match of clean.matchAll(
      /\b(\w+)\s*\(?\s*["']([\w.-]+:[\w.-]+)(?::([^"']+))?["']/g
    )) {
      declarations.push({
        name: match[2],
        version: match[3] ?? "",
        project: file,
        owner: posix.dirname(file),
        dev: /^(?:test|androidTest)/i.test(match[1]),
      });
    }
    for (const [catalogFile, catalogContent] of Object.entries(files)) {
      if (posix.basename(catalogFile) !== "libs.versions.toml") continue;
      const root = posix.dirname(catalogFile).endsWith("gradle")
        ? posix.dirname(posix.dirname(catalogFile))
        : posix.dirname(catalogFile);
      if (posix.relative(root, file).startsWith("../")) continue;
      const catalog = parseToml(catalogContent);
      const versions = table(catalog.versions);
      for (const [alias, value] of Object.entries(table(catalog.libraries))) {
        const accessor = alias.replace(/[-_]/g, ".");
        const uses = [...clean.matchAll(/\b(\w+)\s*\(?\s*libs\.([\w.]+)/g)].filter(
          (m) => m[2] === accessor
        );
        if (uses.length === 0) continue;
        const entry = table(value);
        const parts = text(value).split(":");
        const name =
          text(entry.module) ||
          (entry.group && entry.name
            ? `${text(entry.group)}:${text(entry.name)}`
            : parts.slice(0, 2).join(":"));
        const version =
          text(entry.version) || text(versions[text(table(entry.version).ref)]) || parts[2] || "";
        if (coordinate(name))
          declarations.push({
            name,
            version,
            project: catalogFile,
            owner: posix.dirname(file),
            dev: uses.every((m) => /^(?:test|androidTest)/i.test(m[1])),
          });
      }
    }
  }
  const locks = Object.entries(files).filter(
    ([file]) => posix.basename(file) === "gradle.lockfile"
  );
  for (const [file, content] of locks) {
    for (const line of content.split(/\r?\n/)) {
      const match = /^([\w.-]+:[\w.-]+):([^=]+)=(.+)$/.exec(line);
      if (!match || !literal(match[2])) continue;
      const declared = declarations.filter(
        (d) => d.name === match[1] && d.owner === posix.dirname(file)
      );
      rows.push({
        name: match[1],
        version: match[2],
        direct: declared.length > 0,
        ecosystem: "Maven",
        manager: "gradle",
        project: declared.length ? [...new Set(declared.map((d) => d.project))].join(",") : file,
        ...(declared.length > 0 && declared.every((d) => d.dev) ? { dev: true as const } : {}),
      });
    }
  }
  for (const dep of declarations) {
    if (!literal(dep.version)) continue;
    if (
      locks.some(
        ([file, content]) =>
          posix.dirname(file) === dep.owner &&
          content.split(/\r?\n/).some((line) => line.startsWith(`${dep.name}:`))
      )
    )
      continue;
    rows.push({
      name: dep.name,
      version: dep.version,
      direct: true,
      ecosystem: "Maven",
      manager: "gradle",
      project: dep.project,
      ...(dep.dev ? { dev: true as const } : {}),
    });
  }
  return rows;
}
