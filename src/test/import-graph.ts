import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";

// The runtime import graph of a module, read from the source with the TypeScript parser:
// `import type`, imports whose every name is `type X`, and `export type ... from` are erased
// at compile time and are not edges. Resolves the tsconfig aliases `@/` and `@scan/`.

const ROOT = path.resolve(__dirname, "../..");
const ALIASES: [string, string][] = [
  ["@/", path.join(ROOT, "src/")],
  ["@scan/", path.join(ROOT, "packages/scan/src/")],
];
const EXTENSIONS = [".ts", ".tsx", "/index.ts", "/index.tsx"];

function resolveFile(base: string): string | null {
  if (/\.tsx?$/.test(base) && existsSync(base)) return base;
  for (const ext of EXTENSIONS) if (existsSync(base + ext)) return base + ext;
  return null;
}

/** A project file for a specifier, or the bare specifier itself for a package (`next/headers`). */
export function resolveImport(from: string, specifier: string): string {
  for (const [alias, dir] of ALIASES) {
    if (specifier.startsWith(alias)) {
      return resolveFile(path.join(dir, specifier.slice(alias.length))) ?? specifier;
    }
  }
  if (specifier.startsWith(".")) {
    return resolveFile(path.resolve(path.dirname(from), specifier)) ?? specifier;
  }
  return specifier;
}

function isTypeOnly(node: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isExportDeclaration(node)) {
    if (node.isTypeOnly) return true;
    const clause = node.exportClause;
    return (
      clause !== undefined &&
      ts.isNamedExports(clause) &&
      clause.elements.length > 0 &&
      clause.elements.every((e) => e.isTypeOnly)
    );
  }
  const clause = node.importClause;
  if (!clause) return false; // `import "x"` runs x
  if (clause.isTypeOnly) return true;
  if (clause.name) return false;
  const bindings = clause.namedBindings;
  return (
    bindings !== undefined &&
    ts.isNamedImports(bindings) &&
    bindings.elements.length > 0 &&
    bindings.elements.every((e) => e.isTypeOnly)
  );
}

/** Specifiers a file imports or re-exports at runtime (static and `import()`). */
export function runtimeImports(fileName: string, text: string): string[] {
  const file = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      !isTypeOnly(node)
    ) {
      out.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      out.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

/**
 * Every module reachable from `entries` at runtime, each with the chain that reaches it
 * (`entry -> a -> b`), as paths relative to the repo root (packages stay bare).
 */
export function importGraph(entries: readonly string[]): Map<string, string[]> {
  const rel = (f: string) => (path.isAbsolute(f) ? path.relative(ROOT, f) : f);
  const seen = new Map<string, string[]>();
  const queue: { file: string; chain: string[] }[] = entries.map((e) => {
    const file = path.resolve(ROOT, e);
    return { file, chain: [rel(file)] };
  });
  while (queue.length > 0) {
    const { file, chain } = queue.shift() as { file: string; chain: string[] };
    const key = rel(file);
    if (seen.has(key)) continue;
    seen.set(key, chain);
    if (!path.isAbsolute(file)) continue;
    for (const spec of runtimeImports(file, readFileSync(file, "utf8"))) {
      const next = resolveImport(file, spec);
      if (!seen.has(rel(next))) queue.push({ file: next, chain: [...chain, rel(next)] });
    }
  }
  return seen;
}
