# Privacy: what leaves your server, and to whom

Briff runs on your server (or ours, at app.briff.dev). This page lists every outbound
connection the web app and the worker make, and exactly what each one carries. If something
is not listed here, Briff does not send it. Every claim points at the code that does it.

## What Briff holds

- From the scanner (`POST /api/scan`, docs/SCANNER.md): repo names, and per repo the
  `{package, installed version, direct}` rows from lockfiles and the `{runtime, version, file}`
  rows from version files, Dockerfiles and compose files. No source code, no file contents.
- From the GitHub App, when you connect it: the same rows, built on the server from the
  lockfiles, manifests and runtime files it fetches (the exact list: docs/GITHUB-APP.md, "What
  Briff reads"); file contents are not stored. Plus the installation's account login and type.
- From you: account name, email, password hash (Better Auth), org name, streams, the interest
  profile text, feedback on bulletin items.
- Derived: matches, alerts, bulletins, job runs.
- Scan tokens are stored as a sha256 hash plus an 8-character display prefix; the secret is
  shown once and never stored.

## Outbound connections

| Recipient                                                            | When                                      | What it receives                                                                                                                                                                           | Never                                                 |
| -------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Anthropic API (`api.anthropic.com`)                                  | triage, weekly synthesis, profile refresh | Public item text (release notes, advisories, blog posts), package names and installed versions, services, advisory ids and fixed versions, your profile text and weights, **repo aliases** | repo names, org name, emails, user names, tokens, ids |
| OSV (`api.osv.dev`)                                                  | daily security scan                       | `{ecosystem, package name, installed version}` per query, then advisory ids                                                                                                                | repo names, anything about you                        |
| npm registry (`registry.npmjs.org`)                                  | daily package refresh                     | the package name in the URL (`/<name>/latest`)                                                                                                                                             | versions you run, repo names                          |
| GitHub (`github.com`, `api.github.com`, `raw.githubusercontent.com`) | source collection                         | requests for public release feeds (`/<owner>/<repo>/releases.atom`) of packages you depend on, public security advisories of runtimes, public Markdown posts; `GITHUB_TOKEN` when set      | repo names, versions you run                          |
| Source feeds (curated RSS/Atom, docs/SOURCES.md)                     | source collection                         | a plain GET of the feed URL (with `If-None-Match` / `If-Modified-Since`)                                                                                                                   | anything about you                                    |
| GitHub App (`api.github.com`), when connected                        | install, push, scan                       | requests for the installation's repos, default-branch heads, trees and the blobs listed in docs/GITHUB-APP.md; a one-time OAuth check that you can access the installation                 | anything about your other repos or files              |
| SMTP relay (Brevo, `SMTP_HOST`)                                      | bulletins, security alerts, urgent emails | the email itself: recipient address, repo names, packages, versions, actions                                                                                                               | tokens, password hashes                               |

Feed requests identify as `Briff/1.0` (`USER_AGENT`, `src/lib/rss/fetcher.ts`). A
feed URL that came from data goes through `safeFetch` (SSRF guard); fixed API hosts use
`fetchWithRetry`.

Package names and versions go to Anthropic and OSV as they are: they are what Briff reports
on. Which packages you depend on can say something about what you build; if that is too much
for a repo, leave it out of every stream (it is then not scanned for alerts and not
summarised).

## Repo names and the LLM: aliases

Repo names never reach the Anthropic API. Every request that would carry them is rewritten on
the server just before it is sent, and the answer is mapped back before anything is stored
(`src/llm/pseudonym.ts`):

- **Per request.** The request's distinct repo names are sorted (code-point order) and named
  `repo-1`, `repo-2`, ... in that order, skipping any `repo-N` the request already contains (a
  URL in your profile), so only aliases Briff introduced are mapped back. The same set of names gives the same aliases, so an
  unchanged input still hashes the same; nothing about the mapping is stored, and a different
  request (another stream, another week with another repo set) can give the same repo another
  alias.
- **Structured fields** are replaced outright: `stack[].name`, `items[].affected_repos`,
  `security_alerts[].repos` (`src/pipeline/synthesis-privacy.ts`).
- **Which names**: every repo in the request plus every other repo of the org, because the
  profile text is org-wide and can name a repo outside the stream being written.
- **Free text** that can name a repo (the derived `suggested_action`, your profile text) is
  rewritten wherever a name is not part of a longer word: punctuation, `/`, `.`, `-` and `@`
  count as boundaries, so `https://github.com/acme/billing/pulls`, `billing/docs` and
  `billing-staging` lose the name too (`pantheonx` does not contain `pantheon`). The full name
  (`acme/billing`) and, when no other repo shares it, its last path segment (`billing`, also a
  short one such as `ui`, so the word "ui" is then redacted too) are replaced. Package, service, runtime and image names of the request (for the profile: every
  package the org installs and every name in the weights) are never touched, whole or in part
  (a repo called `next` or `web` leaves `npm i next@16` and `@acme/web-sdk` as they are),
  but they never shield a longer repo name (`acme/next-app` is still replaced);
  structured fields are aliased regardless.
- **The answer**: every free-text field (`summary`, `headline`, `line`, `action`,
  `what_to_do.note`, the profile `text`) has `repo-N` (same boundaries) replaced with what it
  stood for: the one spelling it replaced in this request (so text the model repeats comes back
  unchanged, `@acme/web-sdk` included), or the full name when it stood for several (the full
  name in a structured field and the short name in text). An alias inside a public name of the
  request is left alone. Unknown aliases stay as written. The rules that read repo names (an action that names
  only some affected repos falls back to the derived action; a line that names only some
  gets the others appended; the ref guard) run after this step, on the real names.
- Triage requests carry public item text and the match reason (`release:<package>`,
  `service:<key>`) only; they have no repo field.

`src/pipeline/llm-payload.integration.test.ts` builds an org with a distinctive name, member,
email, scan token and repos, runs the preview synthesis, the profile refresh and a triage
request through the real code, and fails if any of those values appears in what would be
sent.

## Your data: export and deletion

Settings → Your data.

- **Export** (`GET /api/export`, `src/lib/org-data.ts`): one JSON file for the signed-in member's
  org, streamed section by section: `org`, `members` (name, email, language, delivery address,
  role), `profile`, `scanTokens` (name, 8-character prefix, dates; never the hash), `repos`,
  `dependencies`, `runtimes`, `streams` (with repo ids), `bulletins`, `bulletinItems`, `alerts`
  (with the advisory id, severity and package), `feedback`, `deadlines`, `githubInstallations`. Sessions, accounts and
  password hashes are not in it, nor anything of another org.
- **Delete organisation**: owners only, after typing the org's name. The instance admin (the
  first account) cannot delete their own account this way while other accounts exist. Deleted at once: the org
  and every row that belongs to it, and its pending jobs. If you belong to no other org, your
  user goes too (sessions, sign-in accounts, your feedback) and you are signed out.
  Shared catalog data stays: packages, sources, collected items, advisories (public data, not
  yours) and finished jobs and run logs (ids and counts only).

### Data model

Every tenant table carries `orgId` and cascades from `Org`; the auth tables cascade from `User`
(`prisma/schema.prisma`):

| Deleted with the org                                                                                                                                                                                            | Deleted with the user                                                          | Kept                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| OrgMember, Repo, Dependency, RepoRuntime, ItemMatch, Alert, Bulletin, BulletinItem, Feedback, InterestProfile, Deadline, BulletinStream, StreamRepo, ScanToken, GithubInstallation, pending jobs naming the org | Session, Account, OrgMember, Feedback (a token they created loses its creator) | Package, Service, Source, Item, ItemTriage, Advisory, finished jobs and run logs (ids and counts only) |

`src/lib/org-data.integration.test.ts` fills every tenant table, deletes the org and checks each
one is empty; a new tenant table must cascade from `Org` too.

## Self-hosting

On your own instance, the recipients above are the only ones; leave `ANTHROPIC_API_KEY` empty
and nothing goes to Anthropic (triage and the bulletin are then skipped), leave the SMTP
variables empty and no email leaves.

## GitHub Actions

Briff reads `.github/workflows/*.yml` and `*.yaml` for literal `uses:` references only.
It extracts action and reusable-workflow package names (`owner/repo`), refs and subpaths;
local actions, `docker://` references and expressions are ignored. Workflow contents are
not stored or uploaded by the CLI. The GitHub App fetches these workflow blobs to run the
same parser and discards their contents; it does not execute workflow steps.

Actions appear under **Actions** with OSV ecosystem `GitHub Actions`. Full tags are exact
versions. A 40-character SHA with a `# vX.Y.Z` annotation uses that version and retains the
SHA as evidence; unannotated SHAs are queried as commits. Floating majors and minors are
constraints, matched only when an advisory covers their entire release interval. Branch
refs have no known release line and receive no versioned fix recommendation.

Public GitHub tags are fetched during package refresh (up to the first 100 tags), alongside
the existing GitHub releases feed. On-line fixes use the tag's original spelling and SHA (`pin owner/repo to vX.Y.Z (sha …)`).
A missing tag mapping directs the reader to the advisory; a fix outside the
installed release line never becomes a command. Public action names and refs are sent to
OSV; action repository names are sent to the public GitHub tags API. No credentials or
workflow `run` values are sent to either API.

Before querying OSV for an Actions reference, Briff checks the repository with an
unauthenticated GitHub API request. Only an explicit public response permits the OSV
query. Private, missing, rate-limited or unavailable repositories are excluded and
checked again after a deferred retry or cache expiry. GitHub receives its own repository
name for this check. Completed visibility checks are cached for 24 hours. Rate limits
persist a retry deadline and schedule a security scan after the budget resets; unknown
repositories are checked first so large stacks make progress.

Actions repository names are treated as private at the model boundary, even when
they are public on GitHub. They are never package-name redaction exemptions. Names
from every Actions dependency in the organisation are aliased in profile text,
weights and synthesis package fields, including references outside the current stream.
