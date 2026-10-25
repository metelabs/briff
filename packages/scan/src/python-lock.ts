import { parse as parseToml } from "smol-toml";

import {
  encodeShapes,
  normalizePackageName,
  normalizeVersion,
  type PackageManager,
} from "./ecosystems";
import type { LockedDependency } from "./types";

// Python lockfiles and requirements files. Every row is PyPI, names normalised per PEP 503,
// versions in the form normalizeVersion gives; `manager` says which tool's file listed it.

type TomlTable = Record<string, unknown>;

function table(value: unknown): TomlTable {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as TomlTable) : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const pypiName = (name: string) => normalizePackageName("PyPI", name);

/** The project name at the start of a PEP 508 requirement (`Flask[async]>=3 ; python_version>"3.8"`). */
export function requirementName(requirement: string): string | null {
  const m = /^\s*([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)/.exec(requirement);
  return m ? pypiName(m[1]) : null;
}

function row(
  name: string,
  version: string,
  how: Declaration,
  manager: PackageManager
): LockedDependency {
  return {
    name: pypiName(name),
    version: normalizeVersion("PyPI", version),
    direct: how.direct,
    ecosystem: "PyPI",
    ...(how.dev ? { dev: true as const } : {}),
    ...(how.group ? { group: how.group } : {}),
    ...(how.requirement ? { requirement: how.requirement } : {}),
    ...(how.project ? { project: how.project } : {}),
    manager,
  };
}

/** How a project declares a package: direct or not, and where when not in its main list. */
interface Declaration {
  direct: boolean;
  dev?: boolean;
  /** A dependency group (`test`, with dev) or an optional extra (`extra:http`). */
  group?: string;
  /** The declaration's extras and marker (requirementShape). */
  requirement?: string;
  /** The uv workspace member that declares it, when not the root. */
  project?: string;
}

/** What a project declares, PEP 503 names: for production, and only for development. */
export interface PythonDeclared {
  prod: string[];
  /** Production declarations only in an optional extra (`[project.optional-dependencies]`). */
  extras: { name: string; extra: string }[];
  /** Development-only declarations with the dependency group that holds them (`dev`, `test`). */
  dev: { name: string; group: string }[];
  /**
   * Declarations that carry extras or markers, as PEP 508 requirements without a version
   * (`acme-http[socks]; python_version >= "3.9"`), by name and section (`.`, a group,
   * `extra:<name>`), each with the version it pins: each fix command keeps its own.
   */
  requirements: Shapes;
}

const NONE: PythonDeclared = { prod: [], extras: [], dev: [], requirements: {} };

/** A PEP 508 requirement's extras and marker, without its version; null when it has neither. */
export function requirementShape(requirement: string): string | null {
  const m = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?[^;]*(?:;\s*(.+))?$/.exec(requirement);
  if (!m || (!m[2] && !m[3])) return null;
  return `${pypiName(m[1])}${m[2] ? m[2].replace(/\s+/g, "") : ""}${m[3] ? `; ${m[3].trim()}` : ""}`;
}

/** A marker without its `extra == "..."` terms (joined by `and`); null when nothing is left. */
export function withoutExtra(marker: string): string | null {
  // Tokens: parentheses, `and` / `or`, and comparisons (quoted strings kept whole).
  const tokens = marker.match(/\(|\)|"[^"]*"|'[^']*'|[^\s()"']+/g) ?? [];
  let at = 0;
  type Node = { op: "and" | "or"; parts: Node[] } | { atom: string } | null;
  const parseOr = (): Node => {
    const parts = [parseAnd()];
    while (tokens[at] === "or") {
      at++;
      parts.push(parseAnd());
    }
    return parts.length === 1 ? parts[0] : { op: "or", parts };
  };
  const parseAnd = (): Node => {
    const parts = [parseFactor()];
    while (tokens[at] === "and") {
      at++;
      parts.push(parseFactor());
    }
    return parts.length === 1 ? parts[0] : { op: "and", parts };
  };
  const parseFactor = (): Node => {
    if (tokens[at] === "(") {
      at++;
      const inner = parseOr();
      if (tokens[at] === ")") at++;
      return inner;
    }
    const words: string[] = [];
    while (at < tokens.length && !["and", "or", "(", ")"].includes(tokens[at])) {
      words.push(tokens[at++]);
    }
    const atom = words.join(" ");
    // `extra == 'http'` is membership, not a condition: it always holds here.
    return /^extra\s*==/.test(atom) ? null : { atom };
  };
  // null means "always true" after the extra terms are gone.
  const simplify = (node: Node): Node => {
    if (node === null || "atom" in node) return node;
    const parts = node.parts.map(simplify);
    if (node.op === "or" && parts.some((p) => p === null)) return null;
    const kept = parts.filter((p): p is NonNullable<Node> => p !== null);
    if (kept.length === 0) return null;
    return kept.length === 1 ? kept[0] : { op: node.op, parts: kept };
  };
  const render = (node: NonNullable<Node>, parent?: "and" | "or"): string => {
    if ("atom" in node) return node.atom;
    const text = node.parts.flatMap((p) => (p ? [render(p, node.op)] : [])).join(` ${node.op} `);
    return parent && parent !== node.op ? `(${text})` : text;
  };
  const tree = simplify(parseOr());
  return tree === null ? null : render(tree);
}

/** One Poetry version clause as PEP 508 marker comparisons on `python_version`. */
function pythonClause(clause: string): string[] | null {
  const m = /^(\^|~=|~|>=|<=|>|<|==|!=|=)?\s*(\d+(?:\.\d+){0,2})(\.\*)?$/.exec(clause.trim());
  if (!m) return clause.trim() === "*" ? [] : null;
  const [, rawOp = "==", version, wildcard] = m;
  const op = rawOp === "=" ? "==" : rawOp;
  const parts = version.split(".").map(Number);
  // Every comparison on the full version, padded to three components, so it means what
  // Poetry means: `>3.10` admits 3.10.1, `==3.10` is 3.10.0 only. A wildcard is the range of
  // its prefix (`3.*` → >=3.0.0,<4.0.0; `3.10.*` → >=3.10.0,<3.11.0).
  const full = (v: number[]) => [...v, 0, 0].slice(0, 3).join(".");
  if (wildcard && (op === "==" || op === "!=")) {
    const upper = [...parts.slice(0, -1), parts[parts.length - 1] + 1];
    const low = `python_full_version >= "${full(parts)}"`;
    const high = `python_full_version < "${full(upper)}"`;
    return op === "=="
      ? [low, high]
      : [`(python_full_version < "${full(parts)}" or python_full_version >= "${full(upper)}")`];
  }
  if (op === "^" || op === "~" || op === "~=") {
    // Poetry's caret ^3.10 → <4.0 and tilde ~3.10 → <3.11 (~3 → <4); PEP 440's compatible
    // release drops the last component: ~=3.10 → <4.0, ~=3.10.2 → <3.11.
    let upper: number[];
    if (op === "^") upper = [parts[0] + 1];
    else if (op === "~") upper = parts.length === 1 ? [parts[0] + 1] : [parts[0], parts[1] + 1];
    else if (parts.length < 2) return null;
    else upper = parts.length === 2 ? [parts[0] + 1] : [parts[0], parts[1] + 1];
    return [`python_full_version >= "${full(parts)}"`, `python_full_version < "${full(upper)}"`];
  }
  return [`python_full_version ${op} "${full(parts)}"`];
}

/** Poetry's `python = "^3.10"` constraint as a PEP 508 marker; null when it cannot be read. */
export function pythonMarker(constraint: string): string | null {
  const alternatives = constraint.split("||").map((alt) => {
    const clauses = alt.split(/,|\s+(?=[<>=!~^])/).filter((c) => c.trim());
    const parts = clauses.map(pythonClause);
    return parts.some((p) => p === null) ? null : (parts as string[][]).flat();
  });
  if (alternatives.some((a) => a === null)) return null;
  const terms = (alternatives as string[][])
    .filter((a) => a.length > 0)
    .map((a) => a.join(" and "));
  if (terms.length === 0) return null;
  return terms.length === 1 ? terms[0] : terms.map((t) => `(${t})`).join(" or ");
}

/**
 * The same shape from a Poetry or Pipfile table (`{ version = "^2", extras = ["socks"] }`).
 * Poetry's `python` and `platform` conditions become markers (`python_version >= "3.10"`,
 * `sys_platform == "linux"`), so the re-added declaration keeps them.
 */
function tableShape(name: string, spec: unknown): string | null {
  const t = table(spec);
  const extras = list(t.extras).filter((e): e is string => typeof e === "string");
  const python = str(t.python);
  const platform = str(t.platform);
  const conditions = [
    str(t.markers),
    python ? pythonMarker(python) : null,
    platform ? `sys_platform == "${platform}"` : null,
  ].filter((c): c is string => c !== null);
  const marker =
    conditions.length === 0
      ? null
      : conditions.length === 1
        ? conditions[0]
        : conditions.map((c) => `(${c})`).join(" and ");
  if (extras.length === 0 && !marker) return null;
  return `${pypiName(name)}${extras.length > 0 ? `[${extras.join(",")}]` : ""}${marker ? `; ${marker}` : ""}`;
}

/**
 * One declaration's shape, the version it pins exactly (null when it pins none) and its
 * version constraint as written (`>=1,<2`, `^1.2`; null when it has none).
 */
interface ShapeEntry {
  shape: string;
  pin: string | null;
  constraint: string | null;
}

/** `[major, minor, patch, pre]` of a version in normalizeVersion's form; null otherwise. */
function versionParts(version: string): [number, number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(-.+)?$/.exec(normalizeVersion("PyPI", version));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ? 0 : 1] : null;
}

function compareVersions(a: [number, number, number, number], b: [number, number, number, number]) {
  for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/**
 * Whether a declared constraint (PEP 440 `>=1,<2`, `~=1.4`, `==1.*`; Poetry `^1.2`, `~1.2`,
 * `1.2.3`, `||`) admits a locked version. Null when it cannot be read.
 */
export function admits(constraint: string, version: string): boolean | null {
  const v = versionParts(version);
  if (!v) return null;
  let unreadable = false;
  const clause = (raw: string): boolean => {
    const c = raw.trim();
    if (c === "" || c === "*") return true;
    const m = /^(\^|~=|~|>=|<=|>|<|===|==|!=|=)?\s*v?(\d+(?:\.\d+){0,2})(\.\*)?$/.exec(c);
    if (!m) {
      unreadable = true;
      return true;
    }
    const [, rawOp = "==", text, wildcard] = m;
    const op = rawOp === "=" || rawOp === "===" ? "==" : rawOp;
    const nums = text.split(".").map(Number);
    const at = (n: number[]): [number, number, number, number] => [n[0], n[1] ?? 0, n[2] ?? 0, 1];
    const cmp = compareVersions(v, at(nums));
    const below = (upper: number[]) => compareVersions(v, at(upper)) < 0;
    if (wildcard) {
      const upper = [...nums.slice(0, -1), nums[nums.length - 1] + 1];
      const inside = cmp >= 0 && below(upper);
      return op === "!=" ? !inside : inside;
    }
    switch (op) {
      case "^": {
        const i = nums.findIndex((n) => n !== 0);
        const k = i === -1 ? nums.length - 1 : i;
        return cmp >= 0 && below([...nums.slice(0, k), nums[k] + 1]);
      }
      case "~":
        return cmp >= 0 && below(nums.length === 1 ? [nums[0] + 1] : [nums[0], nums[1] + 1]);
      case "~=":
        return (
          nums.length >= 2 && cmp >= 0 && below([...nums.slice(0, -2), nums[nums.length - 2] + 1])
        );
      case ">=":
        return cmp >= 0;
      case "<=":
        return cmp <= 0;
      case ">":
        return cmp > 0;
      case "<":
        return cmp < 0;
      case "!=":
        return cmp !== 0;
      default:
        return cmp === 0;
    }
  };
  const result = constraint
    .replace(/[()]/g, "")
    .split("||")
    .some((alt) => alt.split(/,|\s+(?=[<>=!~^])/).every((c) => clause(c)));
  return unreadable ? null : result;
}

type Shapes = Record<string, Record<string, ShapeEntry[]>>;

/**
 * The declarations a locked version comes from: those pinning exactly that version (one
 * package can be pinned differently per section or platform), else those pinning none
 * (ranges that admit it, then unconstrained ones); never one that pins or ranges over
 * other versions only. Each is `[target, entry]`.
 */
function applicable(
  bySection: Record<string, ShapeEntry[]>,
  version: string
): [string, ShapeEntry][] {
  const all = Object.entries(bySection).flatMap(([target, entries]) =>
    entries.map((e): [string, ShapeEntry] => [target, e])
  );
  const same = (pin: string) => normalizeVersion("PyPI", pin) === normalizeVersion("PyPI", version);
  // The exact pins of this version and the ranges that admit it (`>=2,<3` for 2.0.0, not
  // `>=1,<2`), together: a fix must move every one of them. Exact pins of other versions
  // belong to other locked rows and never apply.
  const matching = all.filter(([, e]) =>
    e.pin !== null ? same(e.pin) : e.constraint !== null && admits(e.constraint, version) !== false
  );
  if (matching.length > 0) return matching;
  const open = all.filter(([, e]) => e.pin === null && e.constraint === null);
  if (open.length > 0) return open;
  // Otherwise only declarations whose constraint cannot be read: a range that rejects this
  // version belongs to another locked row (a transitive copy pulled in elsewhere).
  return all.filter(
    ([, e]) => e.pin === null && e.constraint !== null && admits(e.constraint, version) === null
  );
}

/** The version an exact `==` specifier pins (`==2.31.0`, `== 2.31`); null otherwise. */
function exactPin(specifier: string | null): string | null {
  // A union (`==1.0.0 || ==2.0.0`) pins no single version.
  if (specifier?.includes("|")) return null;
  const m = /(?<![=<>!~])==(?!=)\s*([A-Za-z0-9.+!_-]+)\s*(?:[,;)]|$)/.exec(specifier ?? "");
  return m && !m[1].includes("*") ? m[1] : null;
}

/** Adds one declaration's shape under its section; the first one of a (name, section) wins. */
function addShape(
  out: Shapes,
  name: string | null,
  section: string,
  shape: string | null,
  pin: string | null = null,
  constraint: string | null = null
): void {
  if (!name || !shape || name === "python") return;
  const entries = ((out[name] ??= {})[section] ??= []);
  if (!entries.some((e) => e.shape === shape && e.pin === pin && e.constraint === constraint)) {
    entries.push({ shape, pin, constraint });
  }
}

/** The version part of a PEP 508 requirement (`>=1,<2` of `acme[x] (>=1,<2); marker`). */
function specifierOf(requirement: string): string | null {
  const spec = requirement
    .split(";")[0]
    .replace(/^\s*[A-Za-z0-9][A-Za-z0-9._-]*\s*(\[[^\]]*\])?/, "")
    .replace(/[()\s]/g, "");
  return spec && spec !== "*" ? spec : null;
}

/** Shapes of PEP 508 strings, all in one section. */
function stringShapes(out: Shapes, section: string, values: unknown[]): void {
  for (const r of values) {
    if (typeof r !== "string") continue;
    const name = requirementName(r);
    addShape(
      out,
      name,
      section,
      requirementShape(r) ?? name,
      exactPin(r.split(";")[0]),
      specifierOf(r)
    );
  }
}

/** Shapes of a Poetry or Pipfile dependency table, all in one section. */
function tableShapes(out: Shapes, section: string, deps: unknown): void {
  for (const [name, value] of Object.entries(table(deps))) {
    // Poetry's multiple-constraint form: one table per alternative (`python`, `markers`).
    // `poetry add` replaces the whole list, so such shapes carry MULTI and get no command.
    const alternatives = Array.isArray(value) ? value : [value];
    const multi = Array.isArray(value) && value.length > 1;
    for (const spec of alternatives) tableShapeOf(out, section, name, spec, multi);
  }
}

/** Marks a shape from a Poetry multiple-constraint list (install-commands reads it). */
export const MULTI = "!";

function tableShapeOf(
  out: Shapes,
  section: string,
  name: string,
  spec: unknown,
  multi: boolean
): void {
  // Poetry and Pipfile pin with a bare version (`"2.31.0"`) or `==2.31.0`.
  const version = typeof spec === "string" ? spec : str(table(spec).version);
  // Only a single bare version is an exact pin (`"2.31.0"`); a wildcard (`"1.*"`) or a union
  // (`"1.0.0 || 2.0.0"`) is a constraint for admits().
  const pin =
    version && /^\d[A-Za-z0-9.+!_-]*$/.test(version.trim()) ? version.trim() : exactPin(version);
  const constraint = version && version.trim() !== "*" ? version.trim() : null;
  const shape = tableShape(name, spec) ?? pypiName(name);
  addShape(out, pypiName(name), section, multi ? `${MULTI}${shape}` : shape, pin, constraint);
}

type DevEntry = { name: string | null; group: string };

function declared(
  prod: (string | null)[],
  dev: DevEntry[],
  extras: DevEntry[] = [],
  requirements: Shapes = {}
): PythonDeclared {
  const keep = (n: string | null): n is string => n !== null && n !== "python";
  // Every (name, section) pair once: one package can sit in several groups or extras.
  const firstOf = (entries: DevEntry[]) => {
    const seen = new Set<string>();
    return entries.flatMap((d) => {
      if (!keep(d.name) || seen.has(`${d.name}\0${d.group}`)) return [];
      seen.add(`${d.name}\0${d.group}`);
      return [{ name: d.name, group: d.group }];
    });
  };
  return {
    prod: [...new Set(prod.filter(keep))],
    extras: firstOf(extras).map((e) => ({ name: e.name, extra: e.group })),
    dev: firstOf(dev),
    requirements,
  };
}

/** Each named group's entries (`{ test = [...] }`) as dev entries of that group. */
function groupEntries(groups: unknown, namesOf: (value: unknown) => (string | null)[]): DevEntry[] {
  return Object.entries(table(groups)).flatMap(([group, value]) =>
    namesOf(value).map((name) => ({ name, group }))
  );
}

/**
 * Projects a pyproject.toml declares. Production: PEP 621 `[project]` dependencies and
 * optional dependencies, Poetry's `[tool.poetry.dependencies]`. Development: PEP 735
 * `[dependency-groups]`, uv's `[tool.uv] dev-dependencies`, Poetry's dev-dependencies and
 * groups. `python` is not a package. Empty when absent or unreadable.
 */
function pyprojectShapes(doc: TomlTable): Shapes {
  const project = table(doc.project);
  const tool = table(doc.tool);
  const poetry = table(tool.poetry);
  const out: Shapes = {};
  stringShapes(out, ".", list(project.dependencies));
  for (const [extra, values] of Object.entries(table(project["optional-dependencies"])))
    stringShapes(out, `extra:${extra}`, list(values));
  for (const [group, values] of Object.entries(table(doc["dependency-groups"])))
    stringShapes(out, group, list(values));
  stringShapes(out, "dev", list(table(tool.uv)["dev-dependencies"]));
  tableShapes(out, ".", poetry.dependencies);
  // A Poetry 1 extra's members are optional main dependencies: the same table entry.
  for (const [extra, names] of Object.entries(table(poetry.extras))) {
    for (const n of list(names)) {
      if (typeof n !== "string") continue;
      for (const e of out[pypiName(n)]?.["."] ?? []) {
        addShape(out, pypiName(n), `extra:${extra}`, e.shape, e.pin, e.constraint);
      }
    }
  }
  tableShapes(out, "dev", poetry["dev-dependencies"]);
  for (const [group, g] of Object.entries(table(poetry.group)))
    tableShapes(out, group, table(g).dependencies);
  return out;
}

export function pyprojectDeclared(manifest: string | null): PythonDeclared {
  if (manifest === null) return NONE;
  let doc: TomlTable;
  try {
    doc = parseToml(manifest);
  } catch {
    return NONE;
  }
  const project = table(doc.project);
  const tool = table(doc.tool);
  const poetry = table(tool.poetry);
  const requirements = (values: unknown[]) =>
    values.flatMap((r) => (typeof r === "string" ? [requirementName(r)] : []));
  return declared(
    [
      ...requirements(list(project.dependencies)),
      // Poetry 1 extras: optional main dependencies named in [tool.poetry.extras].
      ...Object.entries(table(poetry.dependencies))
        .filter(([, spec]) => table(spec).optional !== true)
        .map(([name]) => pypiName(name)),
    ],
    [
      ...groupEntries(doc["dependency-groups"], (v) => requirements(list(v))),
      // uv's legacy dev-dependencies and Poetry's are the `dev` group.
      ...requirements(list(table(tool.uv)["dev-dependencies"])).map((name) => ({
        name,
        group: "dev",
      })),
      ...Object.keys(table(poetry["dev-dependencies"])).map((n) => ({
        name: pypiName(n),
        group: "dev",
      })),
      ...groupEntries(poetry.group, (g) => Object.keys(table(table(g).dependencies)).map(pypiName)),
    ],
    [
      ...groupEntries(project["optional-dependencies"], (v) => requirements(list(v))),
      ...groupEntries(poetry.extras, (v) =>
        list(v).flatMap((n) => (typeof n === "string" ? [pypiName(n)] : []))
      ),
    ],
    pyprojectShapes(doc)
  );
}

/** Projects a Pipfile declares: `[packages]` for production, `[dev-packages]` for development. */
function pipfileShapes(doc: TomlTable): Shapes {
  const out: Shapes = {};
  tableShapes(out, ".", doc.packages);
  tableShapes(out, "dev", doc["dev-packages"]);
  return out;
}

export function pipfileDeclared(manifest: string | null): PythonDeclared {
  if (manifest === null) return NONE;
  try {
    const doc = parseToml(manifest);
    return declared(
      Object.keys(table(doc.packages)).map(pypiName),
      Object.keys(table(doc["dev-packages"])).map((n) => ({ name: pypiName(n), group: "dev" })),
      [],
      pipfileShapes(doc)
    );
  } catch {
    return NONE;
  }
}

/**
 * How the project declares a name: in its main list, else in an optional extra (production),
 * else in a development group, else not at all (transitive).
 */
/** A declaration from the declarations that apply to a locked version (`[section, entry]`). */
function flagsFrom(name: string, app: [string, ShapeEntry][]): Declaration {
  const sections = [...new Set(app.map(([section]) => section))];
  if (sections.length === 0) return { direct: false };
  return {
    direct: true,
    ...(sections.every(isDevSection) ? { dev: true } : {}),
    ...(sections.length === 1 && sections[0] === "." ? {} : { group: sections.join(",") }),
    ...requirementOf(name, app),
  };
}

function flags(name: string, decl: PythonDeclared, version = ""): Declaration {
  const declarations = decl.requirements[name];
  const listed = [
    ...(decl.prod.includes(name) ? ["."] : []),
    ...decl.extras.filter((e) => e.name === name).map((e) => `extra:${e.extra}`),
    ...decl.dev.filter((d) => d.name === name).map((d) => d.group),
  ];
  // With the declarations on record, only those the locked version comes from count:
  // `==1.0.0` in main and `==2.0.0` in test are two rows, each with its own section.
  const app = declarations ? applicable(declarations, version) : [];
  const sections = declarations ? [...new Set(app.map(([section]) => section))] : listed;
  if (sections.length === 0) return { direct: false };
  return {
    direct: true,
    ...(sections.every(isDevSection) ? { dev: true } : {}),
    ...(sections.length === 1 && sections[0] === "." ? {} : { group: sections.join(",") }),
    ...requirementOf(name, app),
  };
}

/** The row's `requirement`: each declaration's shape by target (encodeShapes), when any. */
function requirementOf(name: string, app: [string, ShapeEntry][]): { requirement?: string } {
  // A bare name says nothing the command does not already write, unless its target also
  // holds a shaped declaration: then each of them is an edit of its own.
  const shapedTargets = new Set(app.filter(([, e]) => e.shape !== name).map(([t]) => t));
  const shaped = app
    .filter(([t]) => shapedTargets.has(t))
    .map(([t, e]): [string, string] => [t, e.shape]);
  return shaped.length > 0 ? { requirement: encodeShapes(shaped) } : {};
}

function mergeShapes(a: Shapes, b: Shapes): Shapes {
  const out: Shapes = {};
  for (const source of [b, a]) {
    for (const [name, sections] of Object.entries(source)) {
      for (const [section, entries] of Object.entries(sections)) {
        for (const e of entries) addShape(out, name, section, e.shape, e.pin, e.constraint);
      }
    }
  }
  return out;
}

/** A dependency group (not the main list `.`, not an extra). */
export function isDevSection(section: string): boolean {
  return section !== "." && !section.startsWith("extra:");
}

/** poetry.lock: every `[[package]]` from PyPI; direct = declared in the sibling pyproject.toml. */
export function parsePoetryLock(content: string, decl: PythonDeclared): LockedDependency[] {
  return list(parseToml(content).package).flatMap((entry) => {
    const pkg = table(entry);
    const name = str(pkg.name);
    const version = str(pkg.version);
    // A git, path or url source is not a PyPI release (Poetry omits `source` for PyPI).
    const source = str(table(pkg.source).type);
    if (!name || !version || (source !== null && source !== "legacy")) return [];
    return [row(name, version, flags(pypiName(name), decl, version), "poetry")];
  });
}

/**
 * uv.lock: every `[[package]]` from a registry. The workspace's own projects
 * (`source = { editable | virtual = "." }`) are not packages; what they depend on, in any
 * group or extra, is direct, as is anything the sibling pyproject.toml declares.
 */
export function parseUvLock(content: string, decl: PythonDeclared): LockedDependency[] {
  const lock = parseToml(content);
  const packages = list(lock.package).map(table);
  // Workspace members are listed in `[manifest] members`; a lock without one is a single
  // project whose own entry sits at ".". An editable path dependency outside the workspace
  // (`editable = "../lib"`) is a package, not a member.
  const listed = new Set(
    list(table(lock.manifest).members).flatMap((n) => (typeof n === "string" ? [pypiName(n)] : []))
  );
  const isMember = (pkg: TomlTable) => {
    const source = table(pkg.source);
    if (!("editable" in source || "virtual" in source)) return false;
    const name = str(pkg.name);
    return listed.size > 0
      ? name !== null && listed.has(pypiName(name))
      : source.editable === "." || source.virtual === ".";
  };
  const names = (deps: unknown[]) =>
    deps.flatMap((dep) => {
      const name = str(table(dep).name);
      return name ? [pypiName(name)] : [];
    });
  const members = packages.filter(isMember);
  // The workspace root (`source = { editable = "." }`) is the project uv adds to by default;
  // another member's own declarations need `uv add --package <member>`.
  const isRoot = (m: TomlTable) => {
    const source = table(m.source);
    return source.editable === "." || source.virtual === ".";
  };
  // Each member's own declarations as `member:section` (`.` the main list), so every pin
  // in every member is updated (`uv add --package member [--group g]`).
  const memberPairs = new Map<string, string[]>();
  for (const m of members.filter((m) => !isRoot(m))) {
    const member = str(m.name);
    if (!member) continue;
    const add = (name: string, section: string) => {
      const pair = `${pypiName(member)}:${section}`;
      const list = memberPairs.get(name) ?? [];
      if (!list.includes(pair)) memberPairs.set(name, [...list, pair]);
    };
    for (const name of names(list(m.dependencies))) add(name, ".");
    for (const e of groupEntries(m["optional-dependencies"], (v) => names(list(v))))
      if (e.name) add(e.name, `extra:${e.group}`);
    for (const e of groupEntries(m["dev-dependencies"], (v) => names(list(v))))
      if (e.name) add(e.name, e.group);
  }
  // A member's requires-dist and requires-dev keep extras and markers (`{ name, extras, marker }`).
  // Root shapes by section; a member's under `member:section` (as in `project`).
  const metadataShapes: Shapes = {};
  const memberShapes: Shapes = {};
  for (const m of members) {
    const memberName = str(m.name);
    const target = (section: string) =>
      isRoot(m) || !memberName ? section : `${pypiName(memberName)}:${section}`;
    const into = isRoot(m) ? metadataShapes : memberShapes;
    const metadata = table(m.metadata);
    const declarations: [string, unknown][] = [
      ...list(metadata["requires-dist"]).map((r): [string, unknown] => {
        // uv writes the extra a requirement belongs to as `extra == 'http'`: that is its
        // section, not an environment condition, so it never reaches the command.
        const extra = /extra\s*==\s*['"]([^'"]+)['"]/.exec(str(table(r).marker) ?? "");
        return [extra ? `extra:${extra[1]}` : ".", r];
      }),
      // Development groups: `[package.metadata.requires-dev] test = [...]`.
      ...Object.entries(table(metadata["requires-dev"])).flatMap(([group, values]) =>
        list(values).map((r): [string, unknown] => [group, r])
      ),
    ];
    for (const [section, r] of declarations) {
      const t = table(r);
      const name = str(t.name);
      const marker = str(t.marker);
      const shape = name
        ? tableShape(name, { extras: t.extras, markers: marker ? withoutExtra(marker) : null })
        : null;
      addShape(
        into,
        name ? pypiName(name) : null,
        target(section),
        shape ?? (name ? pypiName(name) : null),
        exactPin(str(t.specifier)),
        str(t.specifier)
      );
    }
  }
  // The root project's declarations: its pyproject.toml and its own lock entry.
  const roots = members.filter(isRoot);
  const root = declared(
    [...decl.prod, ...roots.flatMap((m) => names(list(m.dependencies)))],
    [
      ...decl.dev,
      ...roots.flatMap((m) => groupEntries(m["dev-dependencies"], (v) => names(list(v)))),
    ],
    [
      ...decl.extras.map((e) => ({ name: e.name, group: e.extra })),
      ...roots.flatMap((m) => groupEntries(m["optional-dependencies"], (v) => names(list(v)))),
    ],
    mergeShapes(metadataShapes, decl.requirements)
  );
  return packages.flatMap((pkg) => {
    const name = str(pkg.name);
    const version = str(pkg.version);
    if (!name || !version || !("registry" in table(pkg.source))) return [];
    const key = pypiName(name);
    const pairs = memberPairs.get(key) ?? [];
    const own = memberShapes[key] ?? {};
    // Root and member declarations are judged together: an exact pin of this version
    // anywhere means the declarations pinning other versions (root or member) are not this
    // row's.
    const rootDeclarations = root.requirements[key] ?? {};
    const jointly = applicable({ ...rootDeclarations, ...own }, version);
    const rootSections = new Set(Object.keys(rootDeclarations));
    const rootApp = jointly.filter(([target]) => rootSections.has(target));
    const memberApp = jointly.filter(([target]) => !rootSections.has(target));
    const how =
      root.requirements[key] && Object.keys(own).length > 0
        ? flagsFrom(key, rootApp)
        : flags(key, root, version);
    if (pairs.length === 0) return [row(name, version, how, "uv")];
    // Declared by members (and maybe the root, `.`): the declarations this locked version
    // comes from, each its own target (`member:section`).
    const targets =
      Object.keys(own).length > 0 ? [...new Set(memberApp.map(([target]) => target))] : pairs;
    if (targets.length === 0) return [row(name, version, how, "uv")];
    const sections = targets.map((p) => p.slice(p.indexOf(":") + 1));
    const dev = (!how.direct || how.dev === true) && sections.every(isDevSection);
    const rootLines = how.requirement ? how.requirement.split("\n") : [];
    const memberLines = requirementOf(key, memberApp).requirement?.split("\n") ?? [];
    const lines = [...rootLines, ...memberLines];
    return [
      row(
        name,
        version,
        {
          direct: true,
          ...(dev ? { dev: true } : {}),
          ...(how.group ? { group: how.group } : {}),
          ...(lines.length > 0 ? { requirement: lines.join("\n") } : {}),
          project: [...(how.direct ? ["."] : []), ...targets].join(","),
        },
        "uv"
      ),
    ];
  });
}

/**
 * Pipfile.lock: `default` and `develop` entries pinned with `==`; direct = declared in the
 * Pipfile, development-only = only under `[dev-packages]`.
 */
export function parsePipfileLock(content: string, decl: PythonDeclared): LockedDependency[] {
  const lock = JSON.parse(content) as Record<string, unknown>;
  return ["default", "develop"].flatMap((section) =>
    Object.entries(table(lock[section])).flatMap(([name, entry]) => {
      const pin = /^===?\s*([A-Za-z0-9.+!_-]+)$/.exec(str(table(entry).version) ?? "");
      return pin ? [row(name, pin[1], flags(pypiName(name), decl, pin[1]), "pipenv")] : [];
    })
  );
}

/** Logical lines: comments dropped, `\` continuations joined, `# via` annotations kept apart. */
function requirementLines(content: string): { text: string; via: string[] }[] {
  const out: { text: string; via: string[] }[] = [];
  let pending = "";
  let pendingVia: string[] = [];
  let viaBlock = false;
  for (const raw of content.split(/\r?\n/)) {
    const comment = /^\s*#\s*(via\b)?\s*(.*)$/.exec(raw);
    if (comment) {
      // pip-compile: `# via requests` (or an indented list under a bare `# via`).
      const last = out.at(-1);
      if (comment[1] && last) {
        viaBlock = comment[2] === "";
        if (comment[2]) last.via.push(comment[2].trim());
      } else if (viaBlock && last && /^\s+#\s+\S/.test(raw)) {
        last.via.push(comment[2].trim());
      }
      continue;
    }
    viaBlock = false;
    // `uv pip compile --annotation-style line`: `urllib3==2.0.7  # via requests, acme-http`.
    const inline = /\s#\s*via\s+(.+)$/.exec(raw);
    if (inline)
      pendingVia.push(
        ...inline[1]
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean)
      );
    const line = raw.replace(/\s+#.*$/, "");
    if (line.trimEnd().endsWith("\\")) {
      pending += `${line.trimEnd().slice(0, -1)} `;
      continue;
    }
    const text = (pending + line).trim();
    pending = "";
    if (text) out.push({ text, via: pendingVia });
    pendingVia = [];
  }
  return out;
}

/**
 * A pip-compile `# via` source that is the project itself: a requirements file
 * (`-r requirements.in`) or a project manifest (`acme-service (pyproject.toml)`).
 */
function declaredByProject(via: string): boolean {
  // `-c constraints.txt` only constrains a version; it does not ask for the package.
  return /^-r\s/.test(via) || /\((pyproject\.toml|setup\.py|setup\.cfg)\)$/.test(via);
}

/**
 * requirements.txt: one row per requirement. An exact pin (`==2.31.0`, `===2.31.0`) is the
 * installed version; anything else (`>=2`, `~=1.4`, `==2.*`, no specifier) is kept as an
 * `unresolved` row whose version is the requirement as written. Options (`-r`, `-e`,
 * `--hash`), URLs and local paths are skipped. Requirements are direct, except those that
 * pip-compile annotates as pulled in only by other packages (`# via requests`), not by the
 * project (declaredByProject).
 */
export function parseRequirements(content: string): LockedDependency[] {
  const out: LockedDependency[] = [];
  for (const { text, via } of requirementLines(content)) {
    if (text.startsWith("-")) continue;
    const spec = text
      .replace(/\s--hash[=\s]\S+/g, "")
      .split(";")[0]
      .trim();
    const name = requirementName(spec);
    if (!name || /\s@\s|:\/\//.test(spec)) continue;
    // `Django (==4.2.1)`: pip accepts the specifier in parentheses.
    const specifier = spec.slice(spec.search(/[<>=!~]|$/)).replace(/[\s()]+/g, "");
    const direct = via.length === 0 || via.some(declaredByProject);
    // An exact pin of a version (PEP 440 characters only); anything else is a requirement.
    const pin = /^===?([A-Za-z0-9.+!_-]+)$/.exec(specifier);
    if (pin) {
      const shape = requirementShape(spec);
      out.push(row(name, pin[1], { direct, ...(shape ? { requirement: shape } : {}) }, "pip"));
    } else {
      out.push({
        name,
        version: specifier || "*",
        direct,
        ecosystem: "PyPI",
        manager: "pip",
        unresolved: true,
      });
    }
  }
  return out;
}
