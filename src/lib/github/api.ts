import { createSign } from "node:crypto";

import { z } from "zod";

// The few GitHub REST calls the app makes, on a fixed host with an injectable fetch so tests
// replay recorded responses. Rate limits: a 403/429 with `x-ratelimit-remaining: 0` or a
// `retry-after` becomes GithubRateLimitError (the job fails and the queue retries it with
// backoff); unchanged default-branch heads are not fetched again (Repo.githubHeadSha).

export const GITHUB_API = "https://api.github.com";
const USER_AGENT = "Briff-GitHub-App";

export type Http = (url: string, init?: RequestInit) => Promise<Response>;

export class GithubApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "GithubApiError";
  }
}

export class GithubRateLimitError extends GithubApiError {
  constructor(
    readonly retryAt: Date,
    status: number
  ) {
    super(`GitHub rate limit; retry after ${retryAt.toISOString()}`, status);
    this.name = "GithubRateLimitError";
  }
}

/** Retry time of a rate-limited response, or null when the response is not one. */
export function rateLimitRetryAt(res: Response, now: Date = new Date()): Date | null {
  if (res.status !== 403 && res.status !== 429) return null;
  const retryAfter = Number(res.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0)
    return new Date(now.getTime() + retryAfter * 1000);
  if (res.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    return Number.isFinite(reset) && reset > 0
      ? new Date(reset * 1000)
      : new Date(now.getTime() + 60_000);
  }
  return res.status === 429 ? new Date(now.getTime() + 60_000) : null;
}

async function call(http: Http, url: string, init: RequestInit): Promise<Response> {
  const res = await http(url, {
    ...init,
    headers: {
      "User-Agent": USER_AGENT,
      "X-GitHub-Api-Version": "2022-11-28",
      Accept: "application/vnd.github+json",
      ...init.headers,
    },
  });
  if (res.ok) return res;
  const retryAt = rateLimitRetryAt(res);
  if (retryAt) throw new GithubRateLimitError(retryAt, res.status);
  throw new GithubApiError(`GitHub ${init.method ?? "GET"} ${url}: HTTP ${res.status}`, res.status);
}

async function getJson<T>(
  http: Http,
  path: string,
  token: string,
  schema: z.ZodType<T>
): Promise<T> {
  const res = await call(http, `${GITHUB_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return schema.parse(await res.json());
}

/** RS256 JWT the app authenticates as itself with (valid 9 minutes, issued 60 s back). */
export function appJwt(appId: string, privateKey: string, now: Date = new Date()): string {
  const seconds = Math.floor(now.getTime() / 1000);
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iat: seconds - 60,
    exp: seconds + 540,
    iss: appId,
  })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(privateKey, "base64url");
  return `${unsigned}.${signature}`;
}

const installationSchema = z.object({
  id: z.number(),
  account: z.object({ login: z.string(), type: z.string() }).nullable(),
  suspended_at: z.string().nullable().optional(),
});
export type GithubInstallationInfo = z.infer<typeof installationSchema>;

export function getInstallation(
  http: Http,
  jwt: string,
  installationId: string
): Promise<GithubInstallationInfo> {
  return getJson(
    http,
    `/app/installations/${encodeURIComponent(installationId)}`,
    jwt,
    installationSchema
  );
}

const tokenSchema = z.object({ token: z.string(), expires_at: z.string() });

export async function createInstallationToken(
  http: Http,
  jwt: string,
  installationId: string
): Promise<{ token: string; expiresAt: Date }> {
  const res = await call(
    http,
    `${GITHUB_API}/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
    { method: "POST", headers: { Authorization: `Bearer ${jwt}` } }
  );
  const body = tokenSchema.parse(await res.json());
  return { token: body.token, expiresAt: new Date(body.expires_at) };
}

const repoSchema = z.object({
  full_name: z.string(),
  default_branch: z.string(),
  archived: z.boolean().optional(),
});
export type GithubRepo = z.infer<typeof repoSchema>;

const PAGE = 100;
const MAX_PAGES = 50;

/** Every repo the installation can see (paginated, at most 5000). */
export async function listInstallationRepos(http: Http, token: string): Promise<GithubRepo[]> {
  const pageSchema = z.object({ total_count: z.number(), repositories: z.array(repoSchema) });
  const repos: GithubRepo[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await getJson(
      http,
      `/installation/repositories?per_page=${PAGE}&page=${page}`,
      token,
      pageSchema
    );
    repos.push(...body.repositories);
    if (body.repositories.length < PAGE || repos.length >= body.total_count) break;
  }
  return repos;
}

function repoPath(fullName: string): string {
  const [owner, name, extra] = fullName.split("/");
  if (!owner || !name || extra !== undefined) throw new Error(`not owner/repo: ${fullName}`);
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

export function getRepo(http: Http, token: string, fullName: string): Promise<GithubRepo> {
  return getJson(http, repoPath(fullName), token, repoSchema);
}

const branchSchema = z.object({
  commit: z.object({ sha: z.string(), commit: z.object({ tree: z.object({ sha: z.string() }) }) }),
});

export async function getBranchHead(
  http: Http,
  token: string,
  fullName: string,
  branch: string
): Promise<{ commitSha: string; treeSha: string }> {
  const body = await getJson(
    http,
    `${repoPath(fullName)}/branches/${encodeURIComponent(branch)}`,
    token,
    branchSchema
  );
  return { commitSha: body.commit.sha, treeSha: body.commit.commit.tree.sha };
}

const treeSchema = z.object({
  truncated: z.boolean(),
  tree: z.array(
    z.object({
      path: z.string(),
      mode: z.string(),
      type: z.string(),
      sha: z.string(),
      size: z.number().optional(),
    })
  ),
});
export type GithubTree = z.infer<typeof treeSchema>;

/** The whole tree of a commit in one call (`recursive=1`); paths only, no contents. */
export function getTree(
  http: Http,
  token: string,
  fullName: string,
  treeSha: string
): Promise<GithubTree> {
  return getJson(
    http,
    `${repoPath(fullName)}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`,
    token,
    treeSchema
  );
}

/** One file's content by blob sha (raw media type: the bytes, not base64 JSON). */
export async function getBlobText(
  http: Http,
  token: string,
  fullName: string,
  blobSha: string
): Promise<string> {
  const res = await call(
    http,
    `${GITHUB_API}${repoPath(fullName)}/git/blobs/${encodeURIComponent(blobSha)}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.raw+json" } }
  );
  return res.text();
}

/** Exchanges the OAuth `code` for a user token (used once, never stored). */
export async function exchangeOAuthCode(
  http: Http,
  clientId: string,
  clientSecret: string,
  code: string
): Promise<string> {
  const res = await call(http, "https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  const body = z
    .object({ access_token: z.string().optional(), error: z.string().optional() })
    .parse(await res.json());
  if (!body.access_token) throw new GithubApiError(`OAuth: ${body.error ?? "no token"}`, 400);
  return body.access_token;
}

/** Installation ids the signed-in GitHub user can access. */
export async function userInstallationIds(http: Http, userToken: string): Promise<string[]> {
  const pageSchema = z.object({
    total_count: z.number(),
    installations: z.array(z.object({ id: z.number() })),
  });
  const ids: string[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await getJson(
      http,
      `/user/installations?per_page=${PAGE}&page=${page}`,
      userToken,
      pageSchema
    );
    ids.push(...body.installations.map((i) => String(i.id)));
    if (body.installations.length < PAGE || ids.length >= body.total_count) break;
  }
  return ids;
}
