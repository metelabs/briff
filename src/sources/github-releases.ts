// GitHub Releases as a source: each package with a GitHub repository gets one
// Atom feed (`/releases.atom`). Only github.com URLs are ever turned into feed
// URLs, so registry metadata cannot point the fetcher somewhere else.

export interface GithubRepoRef {
  owner: string;
  repo: string;
}

const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);
const NAME_RE = /^[A-Za-z0-9_.-]+$/;

/** Accepts npm `repository` forms: git+https, git://, ssh, `github:owner/repo`, `owner/repo`. */
export function parseGithubRepo(raw: string | null | undefined): GithubRepoRef | null {
  if (!raw) return null;
  let value = raw.trim();
  const shorthand = /^(?:github:)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(value);
  if (shorthand) return clean(shorthand[1], shorthand[2]);
  value = value
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/^ssh:\/\/git@/, "https://")
    .replace(/^git@github\.com:/, "https://github.com/");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!GITHUB_HOSTS.has(url.hostname.toLowerCase())) return null;
  const [owner, repo] = url.pathname.replace(/^\/+/, "").split("/");
  return clean(owner, repo);
}

function clean(owner: string | undefined, repo: string | undefined): GithubRepoRef | null {
  if (!owner || !repo) return null;
  const name = repo.replace(/\.git$/, "").replace(/#.*$/, "");
  if (!NAME_RE.test(owner) || !NAME_RE.test(name)) return null;
  return { owner, repo: name };
}

export function githubRepoUrl(ref: GithubRepoRef): string {
  return `https://github.com/${ref.owner}/${ref.repo}`;
}

export function githubReleasesFeedUrl(ref: GithubRepoRef): string {
  return `${githubRepoUrl(ref)}/releases.atom`;
}

/** "https://github.com/vercel/next.js/releases.atom" -> "vercel/next.js". */
export function repoSlugFromFeedUrl(feedUrl: string): string | null {
  const ref = parseGithubRepo(feedUrl.replace(/\/releases\.atom$/, ""));
  return ref ? `${ref.owner}/${ref.repo}` : null;
}
