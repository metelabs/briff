import { z } from "zod";

import { fetchWithRetry } from "@/lib/platforms/fetch-with-retry";
import { normalizeVersion } from "@scan/ecosystems";

import { githubRepoUrl, parseGithubRepo } from "./github-releases";
import type { RegistryInfo } from "./registries";

// Go module proxy (proxy.golang.org): `<module>/@latest` is the newest release (retracted
// versions excluded) with the VCS origin when the proxy knows it; `<module>/@v/<v>.mod` is
// that release's go.mod, where a `// Deprecated:` comment on the module directive marks the
// module deprecated. The module's page on pkg.go.dev is the repository link when the module
// is not on GitHub.

const PROXY = "https://proxy.golang.org";

// Module path characters (golang.org/x/mod/module CheckPath), without `..` or empty elements.
const PATH_RE = /^[A-Za-z0-9][A-Za-z0-9._~+-]*(?:\/[A-Za-z0-9._~+-]+)*$/;

export const goLatestSchema = z
  .object({
    Version: z.string(),
    Origin: z.object({ URL: z.string().optional() }).loose().optional(),
  })
  .loose();

/** The proxy's case encoding: every upper-case letter becomes `!` + its lower case. */
export function escapeModulePath(path: string): string {
  return path.replace(/[A-Z]/g, (c) => `!${c.toLowerCase()}`);
}

export function goProxyUrl(module: string, suffix: string): string | null {
  if (!PATH_RE.test(module) || module.split("/").some((part) => part === "..")) return null;
  return `${PROXY}/${escapeModulePath(module)}/${suffix}`;
}

/** The `Deprecated:` paragraph of the comment on (or right above) the module directive. */
export function goModDeprecation(goMod: string): string | null {
  const lines = goMod.split(/\r?\n/);
  const moduleAt = lines.findIndex((l) => /^\s*module\s/.test(l));
  if (moduleAt === -1) return null;
  const comment: string[] = [];
  for (let i = moduleAt - 1; i >= 0 && /^\s*\/\//.test(lines[i]); i--) {
    comment.unshift(lines[i].replace(/^\s*\/\/\s?/, ""));
  }
  const trailing = /\/\/\s?(.*)$/.exec(lines[moduleAt]);
  if (trailing) comment.push(trailing[1]);
  const at = comment.findIndex((l) => l.startsWith("Deprecated:"));
  if (at === -1) return null;
  const paragraph = comment.slice(at);
  const end = paragraph.findIndex((l, i) => i > 0 && l.trim() === "");
  const text = (end === -1 ? paragraph : paragraph.slice(0, end))
    .join(" ")
    .replace(/^Deprecated:\s*/, "")
    .trim();
  return text || "Deprecated.";
}

/** GitHub when the proxy or the module path names it, else the module's pkg.go.dev page. */
export function goRepositoryUrl(module: string, originUrl: string | undefined): string {
  const repo =
    parseGithubRepo(originUrl) ??
    (module.startsWith("github.com/") ? parseGithubRepo(`https://${module}`) : null);
  return repo ? githubRepoUrl(repo) : `https://pkg.go.dev/${module}`;
}

export type GoLookup = { status: "ok"; info: RegistryInfo } | { status: "not_found" };

async function get(url: string): Promise<Response> {
  return fetchWithRetry(url, { timeoutMs: 10_000, retries: 2 });
}

/** Newest release, deprecation and repository link; `not_found` for unknown or private modules. */
export async function fetchGoModule(module: string): Promise<GoLookup> {
  const latestUrl = goProxyUrl(module, "@latest");
  if (!latestUrl) return { status: "not_found" };
  const res = await get(latestUrl);
  // The proxy answers 404 or 410 (gone) for modules it cannot or may not serve.
  if (res.status === 404 || res.status === 410) return { status: "not_found" };
  if (!res.ok) throw new Error(`go:${module}: HTTP ${res.status}`);
  const parsed = goLatestSchema.safeParse(await res.json());
  if (!parsed.success) throw new Error(`go:${module}: invalid @latest`);
  const { Version, Origin } = parsed.data;
  const modUrl = goProxyUrl(module, `@v/${encodeURIComponent(Version)}.mod`);
  const mod = modUrl ? await get(modUrl) : null;
  const deprecated = mod?.ok ? goModDeprecation(await mod.text()) : null;
  return {
    status: "ok",
    info: {
      latestVersion: normalizeVersion("Go", Version),
      deprecated,
      repositoryUrl: goRepositoryUrl(module, Origin?.URL),
      homepage: `https://pkg.go.dev/${module}`,
    },
  };
}
