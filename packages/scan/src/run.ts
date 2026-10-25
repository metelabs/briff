import { HELP, parseCliArgs } from "./args";
import { collectRepos, type ScanRepoPayload } from "./collect";
import type { DetectedRuntime } from "./types";
import { uploadRepos, type FetchLike, type RepoResult } from "./upload";
import { SCANNER_VERSION } from "./version";

export interface RunIO {
  out: (line: string) => void;
  err: (line: string) => void;
  cwd: string;
  fetch?: FetchLike;
}

/**
 * `php 8.3 (8.3-fpm-alpine) · Dockerfile`, `node 20 (>=20) [constraint] · package.json
 * engines.node`; the raw text only when it adds something.
 */
export function describeRuntime(r: DetectedRuntime): string {
  const shown = r.normalized ?? r.version;
  const raw = r.normalized && r.version !== r.normalized ? ` (${r.version})` : "";
  const flag = r.unresolved ? " [unresolved]" : r.constraint ? " [constraint]" : "";
  return `${r.name} ${shown}${raw}${flag} · ${r.source}`;
}

function summary(root: string, payloads: ScanRepoPayload[]): string {
  const deps = payloads.reduce((n, r) => n + r.dependencies.length, 0);
  const direct = payloads.reduce((n, r) => n + r.dependencies.filter((d) => d.direct).length, 0);
  const runtimes = payloads.reduce((n, r) => n + r.runtimes.length, 0);
  return `root ${root}: ${payloads.length} repos, ${deps} dependencies (${direct} direct), ${runtimes} runtimes`;
}

function repoLine(r: RepoResult): string {
  const flag = r.created ? " (new)" : "";
  // An older web app returns no runtime count.
  const runtimes =
    typeof r.runtimes === "number" ? ` ${String(r.runtimes).padStart(3)} runtimes` : "";
  return `  ${r.name.padEnd(40)} ${String(r.dependencies).padStart(6)} deps ${String(r.direct).padStart(4)} direct${runtimes}${flag}`;
}

/** The whole CLI; returns the exit code (0 ok, 1 failure, 2 usage). */
export async function run(
  argv: string[],
  env: Record<string, string | undefined>,
  io: RunIO
): Promise<number> {
  const parsed = parseCliArgs(argv, env, io.cwd);
  if (parsed.kind === "help") {
    io.out(HELP);
    return 0;
  }
  if (parsed.kind === "version") {
    io.out(SCANNER_VERSION);
    return 0;
  }
  if (parsed.kind === "error") {
    io.err(`briff-scan: ${parsed.message}`);
    io.err("Run briff-scan --help for the options.");
    return 2;
  }
  const options = parsed.options;
  try {
    const payloads = await collectRepos(options.root, options.mode, {
      maxDepth: options.maxDepth,
      exclude: options.exclude,
      warn: io.err,
    });

    if (options.dryRun) {
      if (options.json) {
        io.out(
          JSON.stringify({ root: options.root, source: options.source, repos: payloads }, null, 2)
        );
        return 0;
      }
      io.out(summary(options.root, payloads));
      for (const r of payloads) {
        const direct = r.dependencies.filter((d) => d.direct).length;
        io.out(
          `  ${r.name.padEnd(40)} ${String(r.dependencies.length).padStart(6)} deps ${String(direct).padStart(4)} direct`
        );
        for (const runtime of r.runtimes) io.out(`      ${describeRuntime(runtime)}`);
      }
      io.out("dry run: nothing was sent");
      return 0;
    }

    if (!options.json) io.out(summary(options.root, payloads));
    if (payloads.length === 0) {
      if (options.json) io.out(JSON.stringify({ root: options.root, uploaded: [] }, null, 2));
      else if (options.mode.kind === "single" && options.exclude.includes(options.mode.repoName))
        io.out("nothing to upload");
      else io.out("no lockfile or runtime file found; nothing to upload");
      return 0;
    }
    const results = await uploadRepos(payloads, {
      apiUrl: options.apiUrl,
      // parseCliArgs refuses a run without a token unless it is a dry run.
      token: options.token ?? "",
      source: options.source,
      chunk: options.mode.kind === "single" ? payloads.length : options.chunk,
      fetch: io.fetch,
    });
    if (options.json) {
      io.out(JSON.stringify({ root: options.root, uploaded: results }, null, 2));
      return 0;
    }
    for (const r of results) io.out(repoLine(r));
    io.out(`uploaded ${results.length} repos, ${results.filter((r) => r.created).length} new`);
    return 0;
  } catch (err) {
    io.err(`briff-scan: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
