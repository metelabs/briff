import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

export const DEFAULT_API_URL = "https://app.briff.dev";
export type RepoSource = "local" | "github";

export interface ScanOptions {
  apiUrl: string;
  /** Required unless `dryRun`. */
  token: string | undefined;
  root: string;
  /** One repo named `repoName` (default), or every git repo under `root` (`--all-repos`). */
  mode: { kind: "single"; repoName: string } | { kind: "all"; includeWorktrees: boolean };
  /** Repo names (as Briff would receive them) that are skipped before anything is read. */
  exclude: string[];
  /** `github` inside GitHub Actions, so the repo shows as a GitHub repo in Briff. */
  source: RepoSource;
  dryRun: boolean;
  json: boolean;
  maxDepth: number | undefined;
  chunk: number;
}

export type ParsedArgs =
  | { kind: "run"; options: ScanOptions }
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "error"; message: string };

export const HELP = `Usage: briff-scan [options]

Reads lockfiles (package-lock.json, pnpm-lock.yaml, yarn.lock, composer.lock, poetry.lock,
uv.lock, Pipfile.lock, requirements.txt, go.mod) and runtime files
(.nvmrc, Dockerfile, composer.json, pyproject.toml, ...) and sends package names, installed
versions and runtimes to Briff. No source code and no file contents leave the machine.

Options:
  --api <url>           Briff URL (env BRIFF_API_URL, default ${DEFAULT_API_URL})
  --token <token>       Scan token from Briff Settings (env BRIFF_TOKEN)
  --root <dir>          Directory to scan (default: the current directory)
  --repo-name <name>    Repo name in Briff (default: GITHUB_REPOSITORY in GitHub
                        Actions, else the directory name)
  --all-repos           Scan every git repo under --root as its own repo, named by
                        its path relative to the root (a folder like ~/code)
  --include-worktrees   With --all-repos: also scan linked git worktrees
  --exclude <name>      Skip the repo with this name, exactly as Briff would get it
                        (the path under --root with --all-repos, else --repo-name);
                        repeatable, or comma-separated: --exclude a,b
  --max-depth <n>       How deep to look for files (default 6)
  --chunk <n>           With --all-repos: repos per upload (default 10)
  --dry-run             Print what would be sent; send nothing
  --json                Machine-readable output on stdout
  -h, --help            Show this help
  -v, --version         Show the version
`;

function expandHome(p: string): string {
  return p === "~" || p.startsWith("~/") ? path.join(homedir(), p.slice(1)) : p;
}

function positiveInt(value: string | undefined, flag: string, min: number): number | string {
  if (value === undefined) return Number.NaN;
  const n = Number(value);
  return Number.isInteger(n) && n >= min ? n : `${flag} must be an integer >= ${min}`;
}

/** `--exclude a,b --exclude c/` → `["a", "b", "c"]`. */
export function parseExclude(values: readonly string[] | undefined): string[] {
  const names = (values ?? [])
    .flatMap((v) => v.split(","))
    .map((v) => v.trim().replace(/\/+$/, ""))
    .filter((v) => v.length > 0);
  return [...new Set(names)];
}

/** Repo name for single-repo mode: the flag, then `owner/repo` in Actions, then the folder. */
export function resolveRepoName(
  flag: string | undefined,
  env: Record<string, string | undefined>,
  root: string
): string {
  const explicit = flag?.trim();
  if (explicit) return explicit;
  const fromActions = env.GITHUB_ACTIONS === "true" ? env.GITHUB_REPOSITORY?.trim() : undefined;
  if (fromActions) return fromActions;
  return path.basename(path.resolve(root));
}

export function parseCliArgs(
  argv: string[],
  env: Record<string, string | undefined>,
  cwd: string
): ParsedArgs {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        api: { type: "string" },
        token: { type: "string" },
        root: { type: "string" },
        "repo-name": { type: "string" },
        "all-repos": { type: "boolean", default: false },
        "include-worktrees": { type: "boolean", default: false },
        exclude: { type: "string", multiple: true },
        "max-depth": { type: "string" },
        chunk: { type: "string" },
        "dry-run": { type: "boolean", default: false },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
      },
    }));
  } catch (err) {
    return { kind: "error", message: (err as Error).message };
  }
  if (values.help) return { kind: "help" };
  if (values.version) return { kind: "version" };

  const apiUrl = (values.api ?? env.BRIFF_API_URL ?? "").trim() || DEFAULT_API_URL;
  try {
    const url = new URL(apiUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("protocol");
  } catch {
    return { kind: "error", message: `--api must be an http(s) URL, got "${apiUrl}"` };
  }
  const token = (values.token ?? env.BRIFF_TOKEN ?? "").trim() || undefined;
  if (!token && !values["dry-run"]) {
    return {
      kind: "error",
      message:
        "No token: set BRIFF_TOKEN or pass --token (create one in Briff → Settings → Scan tokens), or use --dry-run",
    };
  }

  const root = path.resolve(cwd, expandHome(values.root ?? "."));
  const allRepos = values["all-repos"];
  if (allRepos && values["repo-name"] !== undefined) {
    return {
      kind: "error",
      message: "--repo-name names one repo; it cannot be used with --all-repos",
    };
  }
  if (!allRepos && values["include-worktrees"]) {
    return { kind: "error", message: "--include-worktrees only applies with --all-repos" };
  }

  const maxDepth = positiveInt(values["max-depth"], "--max-depth", 0);
  if (typeof maxDepth === "string") return { kind: "error", message: maxDepth };
  const chunk = positiveInt(values.chunk, "--chunk", 1);
  if (typeof chunk === "string") return { kind: "error", message: chunk };

  return {
    kind: "run",
    options: {
      apiUrl: apiUrl.replace(/\/+$/, ""),
      token,
      root,
      mode: allRepos
        ? { kind: "all", includeWorktrees: values["include-worktrees"] }
        : { kind: "single", repoName: resolveRepoName(values["repo-name"], env, root) },
      exclude: parseExclude(values.exclude),
      source: env.GITHUB_ACTIONS === "true" ? "github" : "local",
      dryRun: values["dry-run"],
      json: values.json,
      maxDepth: Number.isNaN(maxDepth) ? undefined : maxDepth,
      chunk: Number.isNaN(chunk) ? 10 : chunk,
    },
  };
}
