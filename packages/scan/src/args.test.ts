import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_API_URL,
  parseCliArgs,
  parseExclude,
  resolveRepoName,
  type ScanOptions,
} from "./args";

const CWD = "/work/acme-site";
const TOKEN = { BRIFF_TOKEN: "brf_secret" };

function options(argv: string[], env: Record<string, string | undefined> = TOKEN): ScanOptions {
  const parsed = parseCliArgs(argv, env, CWD);
  if (parsed.kind !== "run") throw new Error(`expected options, got ${JSON.stringify(parsed)}`);
  return parsed.options;
}

function error(argv: string[], env: Record<string, string | undefined> = TOKEN): string {
  const parsed = parseCliArgs(argv, env, CWD);
  if (parsed.kind !== "error") throw new Error(`expected an error, got ${parsed.kind}`);
  return parsed.message;
}

describe("parseCliArgs", () => {
  it("defaults to one repo in the current directory, named after it", () => {
    expect(options([])).toEqual({
      apiUrl: DEFAULT_API_URL,
      token: "brf_secret",
      root: CWD,
      mode: { kind: "single", repoName: "acme-site" },
      exclude: [],
      source: "local",
      dryRun: false,
      json: false,
      maxDepth: undefined,
      chunk: 10,
    });
  });

  it("takes the API URL and token from flags before the environment", () => {
    const env = { BRIFF_API_URL: "https://env.example", BRIFF_TOKEN: "brf_env" };
    expect(options([], env)).toMatchObject({ apiUrl: "https://env.example", token: "brf_env" });
    expect(options(["--api", "http://localhost:3000/", "--token", "brf_flag"], env)).toMatchObject({
      apiUrl: "http://localhost:3000",
      token: "brf_flag",
    });
  });

  it("resolves --root against the working directory and expands ~", () => {
    expect(options(["--root", "../other"]).root).toBe("/work/other");
    expect(options(["--root=~/code"]).root).toMatch(/\/code$/);
    expect(path.isAbsolute(options(["--root=~/code"]).root)).toBe(true);
  });

  it("scans every repo under the root with --all-repos", () => {
    expect(
      options(["--all-repos", "--include-worktrees", "--chunk", "5", "--max-depth=3"])
    ).toMatchObject({
      mode: { kind: "all", includeWorktrees: true },
      chunk: 5,
      maxDepth: 3,
    });
  });

  it("takes --exclude repeated or comma-separated", () => {
    expect(
      options(["--all-repos", "--exclude", "briff, grove", "--exclude=sigma/forms-web/"]).exclude
    ).toEqual(["briff", "grove", "sigma/forms-web"]);
    expect(parseExclude(["a,,a", " ", "b"])).toEqual(["a", "b"]);
    expect(parseExclude(undefined)).toEqual([]);
    expect(error(["--exclude"])).toMatch(/exclude/);
  });

  it("needs a token unless it is a dry run", () => {
    expect(error([], {})).toMatch(/BRIFF_TOKEN/);
    expect(options(["--dry-run", "--json"], {})).toMatchObject({
      token: undefined,
      dryRun: true,
      json: true,
    });
  });

  it("refuses contradictory or malformed options", () => {
    expect(error(["--all-repos", "--repo-name", "x"])).toMatch(/--repo-name/);
    expect(error(["--include-worktrees"])).toMatch(/--all-repos/);
    expect(error(["--chunk", "0"])).toMatch(/--chunk/);
    expect(error(["--max-depth", "two"])).toMatch(/--max-depth/);
    expect(error(["--api", "ftp://x"])).toMatch(/--api/);
    expect(error(["--nope"])).toMatch(/nope/);
    expect(error(["stray"])).toMatch(/stray/);
  });

  it("answers --help and --version", () => {
    expect(parseCliArgs(["--help"], {}, CWD)).toEqual({ kind: "help" });
    expect(parseCliArgs(["-v"], {}, CWD)).toEqual({ kind: "version" });
  });
});

describe("repo naming", () => {
  const actions = { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "acme/site", ...TOKEN };

  it("uses owner/repo and the github source inside GitHub Actions", () => {
    expect(options([], actions)).toMatchObject({
      mode: { kind: "single", repoName: "acme/site" },
      source: "github",
    });
  });

  it("prefers --repo-name, then GITHUB_REPOSITORY, then the directory name", () => {
    expect(resolveRepoName("custom", actions, "/x/y")).toBe("custom");
    expect(resolveRepoName(undefined, actions, "/x/y")).toBe("acme/site");
    expect(resolveRepoName("  ", actions, "/x/y")).toBe("acme/site");
    expect(resolveRepoName(undefined, {}, "/x/y")).toBe("y");
    expect(resolveRepoName(undefined, {}, "/x/y/")).toBe("y");
  });

  it("ignores GITHUB_REPOSITORY outside Actions", () => {
    expect(resolveRepoName(undefined, { GITHUB_REPOSITORY: "acme/site" }, "/x/y")).toBe("y");
    expect(options([], { GITHUB_REPOSITORY: "acme/site", ...TOKEN }).source).toBe("local");
  });
});
