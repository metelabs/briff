import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

// Every export of a "use server" module is a public HTTP endpoint (a Server Action anyone can
// call with any arguments). Only async functions may be exported there; constants, helpers
// and loaders belong in a `server-only` module. Type exports are erased and allowed.

const SRC = path.resolve(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "generated" ? [] : sourceFiles(full);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : [];
  });
}

function isUseServer(file: ts.SourceFile): boolean {
  const first = file.statements[0];
  return (
    first !== undefined &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === "use server"
  );
}

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind) =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);

/** Runtime exports that are not `export async function`, as "file: description". */
export function nonActionExports(fileName: string, text: string): string[] {
  const file = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  if (!isUseServer(file)) return [];
  const bad: string[] = [];
  for (const node of file.statements) {
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) continue;
    if (ts.isExportDeclaration(node)) {
      if (!node.isTypeOnly) bad.push(`re-export ${node.getText().slice(0, 60)}`);
      continue;
    }
    if (ts.isExportAssignment(node)) {
      bad.push("export default");
      continue;
    }
    if (!hasModifier(node, ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isFunctionDeclaration(node)) {
      if (hasModifier(node, ts.SyntaxKind.DefaultKeyword)) bad.push("export default function");
      else if (!hasModifier(node, ts.SyntaxKind.AsyncKeyword))
        bad.push(`non-async function ${node.name?.text}`);
      continue;
    }
    bad.push(`${ts.SyntaxKind[node.kind]} ${node.getText().slice(0, 60)}`);
  }
  return bad;
}

describe('"use server" modules', () => {
  const files = sourceFiles(SRC)
    .map((f) => ({ f, text: readFileSync(f, "utf8") }))
    .filter(({ text }) => /^\s*["']use server["']/.test(text));

  it("are found", () => {
    expect(files.length).toBeGreaterThanOrEqual(7);
  });

  it("export only async functions (Server Actions)", () => {
    const bad = files.flatMap(({ f, text }) =>
      nonActionExports(f, text).map((b) => `${path.relative(SRC, f)}: ${b}`)
    );
    expect(bad).toEqual([]);
  });

  it("each action authenticates before anything else, or is listed as public", () => {
    // Public on purpose: sign-in/up/out, password reset (its token, rate limited per IP), the
    // theme cookie, feedback (bulletin token or session).
    const PUBLIC = new Set([
      "signInAction",
      "signUpAction",
      "requestPasswordResetAction",
      "resetPasswordAction",
      "signOutAction",
      "setThemeAction",
      "giveFeedbackAction",
    ]);
    const AUTH =
      /^(await )?(requireOrgContext|requireAdminContext)\(\)|^const ctx = await (requireOrgContext|requireAdminContext)\(\)/;
    const missing: string[] = [];
    for (const { f, text } of files) {
      const file = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true);
      for (const node of file.statements) {
        if (!ts.isFunctionDeclaration(node) || !hasModifier(node, ts.SyntaxKind.ExportKeyword))
          continue;
        const name = node.name?.text ?? "";
        if (PUBLIC.has(name)) continue;
        const first = node.body?.statements[0]?.getText() ?? "";
        if (!AUTH.test(first)) missing.push(`${path.relative(SRC, f)}: ${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("the checker catches constants, helpers and re-exports", () => {
    const text = [
      '"use server";',
      "export interface A { a: string }",
      "export type B = string;",
      "export async function ok() {}",
      "export function helper() {}",
      "export const LIMIT = 3;",
      'export { x } from "./x";',
      'export type { Y } from "./y";',
    ].join("\n");
    expect(nonActionExports("x.ts", text)).toEqual([
      "non-async function helper",
      "FirstStatement export const LIMIT = 3;",
      'export { x } from "./x";'.replace(/^/, "re-export "),
    ]);
    expect(nonActionExports("y.ts", "export const X = 1;")).toEqual([]);
  });
});
