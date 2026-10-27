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

function dependencyConfiguration(name: string): boolean {
  return /^(?:(?:test|androidTest|debug|release|commonMain|commonTest|jvmMain|jvmTest)?(?:implementation|api|compileOnly|runtimeOnly|annotationProcessor)|classpath|kapt|ksp|compile|testCompile|runtime|testRuntime)$/i.test(
    name
  );
}

/** Static manifests only: local parent properties and dependency management, without executing builds. */
export function parseMavenFiles(
  files: Readonly<Record<string, string>>,
  warn: (message: string) => void = () => {}
): LockedDependency[] {
  const rows: LockedDependency[] = [];
  const poms = new Map<string, Table>();
  for (const [file, content] of Object.entries(files)) {
    if (posix.basename(file) !== "pom.xml") continue;
    try {
      poms.set(file, pom(content));
    } catch {
      warn(`skip ${file}: invalid pom.xml`);
    }
  }
  type Model = {
    properties: Record<string, string>;
    expressions: Record<string, string>;
    managed: Map<string, string>;
    dependencies: Map<string, Table>;
  };
  const models = new Map<string, Model>();
  const model = (file: string, visiting = new Set<string>()): Model => {
    const cached = models.get(file);
    if (cached) return cached;
    if (visiting.has(file))
      return { properties: {}, expressions: {}, managed: new Map(), dependencies: new Map() };
    visiting.add(file);
    const project = poms.get(file) ?? {};
    const parent = table(project.parent);
    const relative =
      !project.parent || parent.relativePath === ""
        ? null
        : text(parent.relativePath) || "../pom.xml";
    const parentPath = relative ? posix.normalize(posix.join(posix.dirname(file), relative)) : "";
    const parentFile = poms.has(parentPath) ? parentPath : posix.join(parentPath, "pom.xml");
    const candidate = relative && poms.has(parentFile) ? model(parentFile, visiting) : null;
    const parentMatches =
      candidate &&
      ["groupId", "artifactId", "version"].every((key) => {
        let declared = text(parent[key]);
        for (let i = 0; i < 20 && declared.includes("${"); i++) {
          const next = declared.replace(
            /\$\{([^}]+)\}/g,
            (match: string, property: string) =>
              text(table(project.properties)[property]) ||
              (/^(?:revision|sha1|changelist)$/.test(property)
                ? candidate.properties[property]
                : undefined) ||
              match
          );
          if (next === declared) break;
          declared = next;
        }
        return declared === candidate.properties[`project.${key}`];
      });
    const inherited = parentMatches
      ? candidate
      : {
          properties: {},
          expressions: {},
          managed: new Map<string, string>(),
          dependencies: new Map<string, Table>(),
        };
    const properties = {
      ...inherited.expressions,
      ...Object.fromEntries(
        Object.entries(table(project.properties)).map(([k, v]) => [k, text(v)])
      ),
    };
    properties["project.version"] = text(project.version) || text(parent.version);
    properties["project.groupId"] = text(project.groupId) || text(parent.groupId);
    properties["project.artifactId"] = text(project.artifactId);
    properties["pom.version"] = properties["project.version"];
    properties["pom.groupId"] = properties["project.groupId"];
    properties["pom.artifactId"] = properties["project.artifactId"];
    for (const key of ["groupId", "artifactId", "version"]) {
      const value = text(parent[key]);
      properties[`project.parent.${key}`] = value;
      properties[`pom.parent.${key}`] = value;
      properties[`parent.${key}`] = value;
    }
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
      if (coordinate(name) && version && dep.scope !== "import")
        managed.set(
          `${name}:${resolve(text(dep.type)) || "jar"}:${resolve(text(dep.classifier))}`,
          version
        );
    }
    const dependencies = new Map(inherited.dependencies);
    for (const entry of list(table(project.dependencies).dependency)) {
      const dep = table(entry);
      const key = `${text(dep.groupId)}:${text(dep.artifactId)}:${text(dep.type) || "jar"}:${text(dep.classifier)}`;
      dependencies.set(key, { ...dependencies.get(key), ...dep });
    }
    const result = { properties, expressions, managed, dependencies };
    models.set(file, result);
    return result;
  };
  for (const [file] of poms) {
    const { properties, managed, dependencies } = model(file);
    const resolve = (v: unknown) =>
      text(v).replace(/\$\{([^}]+)\}/g, (match: string, key: string) => properties[key] ?? match);
    for (const dep of dependencies.values()) {
      const name = `${resolve(dep.groupId)}:${resolve(dep.artifactId)}`;
      const key = `${name}:${resolve(dep.type) || "jar"}:${resolve(dep.classifier)}`;
      const version = resolve(dep.version) || resolve(managed.get(key));
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
      /\b(\w+)\s*\(?\s*["']([\w.-]+:[\w.-]+)(?::([^"':@]+)(?::[^"'@]+)?(?:@[^"']+)?)?["']/g
    )) {
      if (!dependencyConfiguration(match[1])) continue;
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
      let catalog: Table;
      try {
        catalog = parseToml(catalogContent);
      } catch {
        warn(`skip ${catalogFile}: invalid version catalog`);
        continue;
      }
      const versions = table(catalog.versions);
      for (const [alias, value] of Object.entries(table(catalog.libraries))) {
        const accessor = alias.replace(/[-_]/g, ".");
        const uses = [...clean.matchAll(/\b(\w+)\s*\(?\s*libs\.([\w.]+)/g)].filter(
          (m) => m[2] === accessor && dependencyConfiguration(m[1])
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
