import { posix } from "node:path";
import type { LockedDependency } from "./types";

type Value = string | Value[] | { [key: string]: Value };
interface Token {
  kind: "string" | "atom" | "word" | "symbol";
  text: string;
}
const table = (value: Value | undefined): Record<string, Value> =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const text = (value: Value | undefined): string => (typeof value === "string" ? value : "");
const packageName = (value: string) => /^[a-z][a-z0-9_]*$/.test(value);

function tokens(content: string): Token[] {
  return [
    ...content.matchAll(
      /"""(?:\\[\s\S]|(?!""")[\s\S])*"""|'''(?:\\[\s\S]|(?!''')[\s\S])*'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#[^\n]*|:[a-zA-Z_][\w!?]*|[a-zA-Z_][\w!?]*|-?\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d[\d_]*)?|%\{|=>|[^\s]/g
    ),
  ]
    .filter(([raw]) => !raw.startsWith("#"))
    .map<Token>(([raw]) => {
      if (raw.startsWith('"""') || raw.startsWith("'")) return { kind: "string", text: "" };
      if (raw.startsWith('"')) {
        try {
          return { kind: "string", text: JSON.parse(raw) as string };
        } catch {
          return { kind: "string", text: "" };
        }
      }
      if (raw.startsWith(":") && raw.length > 1) return { kind: "atom", text: raw.slice(1) };
      return { kind: /^[a-zA-Z_]/.test(raw) ? "word" : "symbol", text: raw };
    });
}

function manifestTokens(content: string): Token[] {
  try {
    return tokens(content);
  } catch {
    return [];
  }
}

/** Reads literal Elixir terms only; never evaluates a manifest or lockfile. */
function literal(input: Token[], start: number): { value: Value; next: number } {
  const token = input[start];
  if (!token) throw new Error("incomplete Mix literal");
  if (input[start + 1]?.text === ":") {
    const result = literal(input, start + 2);
    return { value: { [token.text]: result.value }, next: result.next };
  }
  const close =
    token.kind !== "symbol"
      ? null
      : token.text === "%{" || token.text === "{"
        ? "}"
        : token.text === "["
          ? "]"
          : null;
  if (!close) return { value: token.text, next: start + 1 };
  const entries: Value[] = [];
  let at = start + 1;
  while (input[at]?.text !== close) {
    if (!input[at]) throw new Error("unclosed Mix literal");
    const entry = literal(input, at);
    entries.push(entry.value);
    at = entry.next;
    if (input[at]?.text === ",") at++;
    else if (input[at]?.text !== close) throw new Error("nonliteral Mix expression");
  }
  return {
    value:
      token.text === "%{"
        ? (Object.assign({}, ...entries.map(table)) as Record<string, Value>)
        : entries,
    next: at + 1,
  };
}

interface Declaration {
  name: string;
  app: string;
  file: string;
  dev: boolean;
}

function declarations(input: Token[], file: string): Declaration[] {
  const lists: Value[][] = [];
  for (let at = 0; at < input.length; at++) {
    if (input[at].text !== "deps" || input[at].kind !== "word") continue;
    let start = at + 1;
    if (input[start]?.text === ":") start++;
    else if (["def", "defp"].includes(input[at - 1]?.text)) {
      if (input[start]?.text === "(") start += 2;
      if (input[start]?.text === ",") start++;
      if (input[start]?.text !== "do") continue;
      start++;
      if (input[start]?.text === ":") start++;
    } else continue;
    if (input[start]?.text !== "[") continue;
    try {
      const value = literal(input, start).value;
      if (Array.isArray(value)) lists.push(value);
    } catch {
      // Computed declarations cannot establish ownership, but locked pins still scan.
    }
  }
  return lists.flatMap((list) =>
    list.flatMap((entry) => {
      if (!Array.isArray(entry)) return [];
      const app = text(entry[0]);
      const options = Object.assign(
        {},
        ...entry
          .slice(1)
          .flatMap((value) => (Array.isArray(value) ? value.map(table) : [table(value)]))
      ) as Record<string, Value>;
      if (["git", "github", "path", "in_umbrella", "organization"].some((key) => key in options))
        return [];
      if (options.repo && options.repo !== "hexpm") return [];
      const name = text(options.hex) || app;
      if (!packageName(app) || !packageName(name)) return [];
      const only = Array.isArray(options.only) ? options.only.map(text) : [text(options.only)];
      return [
        {
          name,
          app,
          file,
          dev: only.length > 0 && only.every((env) => ["dev", "test"].includes(env)),
        },
      ];
    })
  );
}

export function parseHexLock(
  content: string,
  manifests: Readonly<Record<string, string>>,
  project = "mix.exs"
): LockedDependency[] {
  const root = manifestTokens(manifests[project] ?? "");
  const appsAt = root.findIndex(
    (token, at) => token.text === "apps_path" && root[at + 1]?.text === ":"
  );
  const apps = appsAt >= 0 && root[appsAt + 2]?.kind === "string" ? root[appsAt + 2].text : null;
  const members = apps ? posix.join(posix.dirname(project), apps) : null;
  const declared = Object.entries(manifests).flatMap(([file, manifest]) => {
    const relative = members ? posix.relative(members, file) : "";
    return file === project || (members && /^[^/]+\/mix\.exs$/.test(relative))
      ? declarations(manifestTokens(manifest), file)
      : [];
  });
  const lock = table(literal(tokens(content), 0).value);
  return Object.entries(lock).flatMap(([app, value]) => {
    if (!Array.isArray(value) || value[0] !== "hex" || !packageName(text(value[1]))) return [];
    const name = text(value[1]);
    const version = text(value[2]);
    // Modern locks identify the repository; old six-field Hex tuples predate that field.
    if (value.length >= 7 && value[6] !== "hexpm") return [];
    if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/.test(version)) return [];
    const owners = declared.filter((entry) => entry.app === app && entry.name === name);
    return [
      {
        name,
        version,
        direct: owners.length > 0,
        ecosystem: "Hex" as const,
        ...(owners.length && owners.every((entry) => entry.dev) ? { dev: true as const } : {}),
        ...(owners.length
          ? { project: owners.map(({ file, app }) => `${file}:${app}`).join(",") }
          : {}),
      },
    ];
  });
}
