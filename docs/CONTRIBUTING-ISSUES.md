# Starter issues

Small, self-contained tasks found by reading the code, written as ready-to-paste issue bodies.
The maintainer opens them on GitHub with the `good first issue` label; when one is done, its
section here is removed in the same pull request. Each needs only the setup in
[CONTRIBUTING.md](../CONTRIBUTING.md); none needs an Anthropic key or SMTP.

Before starting, read the parts of [AGENTS.md](../AGENTS.md) the issue names, and follow the
checklist in the pull request template.

---

## 1. `briff-scan --help` lists only some of the lockfiles it reads

**Context.** The help text (`HELP` in `packages/scan/src/args.ts`) names npm, pnpm, yarn,
Composer, Poetry, uv, Pipfile, `requirements.txt` and `go.mod`. The scanner also reads
`Gemfile.lock`, `Cargo.lock`, `mix.lock`, `Package.resolved`, `pubspec.lock`,
`packages.lock.json` / `.csproj`, `pom.xml` / Gradle files and `.github/workflows/*.yml`
(`LOCKFILES` in `packages/scan/src/discover.ts`). A user reading `--help` concludes their
Rust or .NET repo is not supported.

**Files.** `packages/scan/src/args.ts`, `packages/scan/src/discover.ts`,
`packages/scan/src/args.test.ts`.

**Acceptance.**

- `--help` names every ecosystem the scanner reads (grouped per ecosystem, still under 80
  columns), plus GitHub Actions workflows.
- A test fails when a `LOCKFILES` kind is added without a help line (for example, map each
  kind to the label the help text must contain).

## 2. Test the scanner's repo-limit path in `uploadRepos`

**Context.** When the server answers `409` with `{"code":"REPO_LIMIT"}`, `uploadRepos`
(`packages/scan/src/upload.ts`) keeps uploading the remaining chunks and throws only at the
end, so repos within the limit still arrive. Nothing tests this; a refactor could turn it
back into "stop at the first chunk".

**Files.** `packages/scan/src/upload.ts`, `packages/scan/src/run.test.ts` (it already has a
fake `fetch` you can reuse).

**Acceptance.**

- A test with three chunks where the second answers `409 REPO_LIMIT`: all three requests are
  made, the third is `final: true`, and the call rejects with the 409 message.
- A test where a `409` without `REPO_LIMIT` (or a `500`) rejects at once and makes no
  further request.

## 3. Unit tests for `package-name.ts`

**Context.** `splitNameVersion` and `isNonRegistryVersion`
(`packages/scan/src/package-name.ts`) are used by the pnpm and yarn parsers but have no tests
of their own. Scoped names (`@scope/pkg@1.0.0`), a bare `@scope/pkg`, `pkg@` and the
`link:` / `workspace:` / `0.0.0-use.local` versions are easy to break.

**Files.** `packages/scan/src/package-name.ts`; new `packages/scan/src/package-name.test.ts`.

**Acceptance.** A Vitest file covering scoped and unscoped names, missing name or version
(returns `null`), and every prefix `isNonRegistryVersion` accepts, plus one ordinary semver
version it rejects. No change to the functions unless a test shows a bug (then describe it in
the PR).

## 4. The logger redacts only top-level keys

**Context.** `log` (`src/lib/log.ts`) replaces fields whose key matches
`authorization|cookie|password|secret|token` with `[redacted]`, but only at the top level:
`log.warn({ headers: { authorization: "Bearer brf_..." } }, "...")` prints the token. No
caller does that today, which is exactly why a test should hold the line. The module has no
test.

**Files.** `src/lib/log.ts`; new `src/lib/log.test.ts`.

**Acceptance.**

- Redaction applies to nested plain objects and arrays (with a depth cap, so a cycle cannot
  hang the logger); `Error` values keep their name, message and stack.
- Tests for top-level, nested and array cases, and for `LOG_LEVEL` filtering (spy on
  `process.stdout.write` / `process.stderr.write`).

## 5. Decode numeric HTML entities in feed text

**Context.** `htmlToText` (`src/lib/text.ts`) and `decodeEntities` (`src/lib/rss/parser.ts`)
decode a fixed list of named entities. Numeric ones (`&#8217;`, `&#x2019;`, `&#8211;`) stay as
written, so a release title like `Node.js&#8217;s security release` reaches the bulletin
verbatim. Both also decode `&amp;` before `&lt;`, so the literal text `&amp;lt;` becomes `<`
instead of `&lt;`.

**Files.** `src/lib/text.ts`, `src/lib/rss/parser.ts`, their tests
(`src/lib/rss/parser.test.ts` exists; add `src/lib/text.test.ts`).

**Acceptance.**

- One shared decoder used by both, handling decimal and hex numeric entities (invalid code
  points left as written) and decoding `&amp;` last.
- Tests for `&#8217;`, `&#x2019;`, `&amp;lt;` and an invalid `&#xFFFFFFFF;`.
- If a replay page changes, regenerate it (`npm run replay`, see AGENTS.md "Replay harness").

## 6. Read `BRIFF_RSS_USER_AGENT` and the Product Hunt keys through `getEnv()`

**Context.** AGENTS.md: env is read through `getEnv()` (`src/lib/env.ts`, zod) at request or
job time, never at module top level. `USER_AGENT` in `src/lib/rss/fetcher.ts` reads
`process.env.BRIFF_RSS_USER_AGENT` when the module loads, and
`src/lib/platforms/producthunt.ts` reads `PRODUCTHUNT_API_KEY` / `PRODUCTHUNT_API_SECRET`
from `process.env` directly. All three are documented in `.env.example` but missing from the
schema.

**Files.** `src/lib/env.ts`, `src/lib/rss/fetcher.ts` (and its importers
`src/sources/fetch-source.ts`, `src/sources/github-advisories.ts`, `src/sources/post-body.ts`),
`src/lib/platforms/producthunt.ts`.

**Acceptance.**

- The three variables are optional fields of the env schema; `USER_AGENT` becomes a function
  (or is resolved per request) so nothing reads env at import time.
- A test shows a configured `BRIFF_RSS_USER_AGENT` reaches the request headers, and the
  default is used when it is empty.

## 7. Correct the User-Agent line in `docs/PRIVACY.md`

**Context.** PRIVACY.md says feed requests "identify as `Briff/1.0`". The default is
`Mozilla/5.0 (compatible; Briff/1.0; +https://briff.dev)` and can be changed with
`BRIFF_RSS_USER_AGENT`; GitHub App calls send `Briff-GitHub-App`
(`src/lib/github/api.ts`). Operators who allow-list or block by User-Agent need the real
strings.

**Files.** `docs/PRIVACY.md`, `src/lib/rss/fetcher.ts`, `src/lib/github/api.ts`.

**Acceptance.** PRIVACY.md gives the exact default string, the variable that overrides it,
and the GitHub App's User-Agent, each with the file it comes from. Docs only.

## 8. Warn when `briff-scan` would send a token over plain HTTP

**Context.** `--api` accepts `http:` URLs (`parseCliArgs`, `packages/scan/src/args.ts`) so
`http://localhost:3000` works in development. Pointed at `http://briff.internal.example`, the
scanner sends the scan token in clear text without a word.

**Files.** `packages/scan/src/args.ts`, `packages/scan/src/run.ts`,
`packages/scan/src/args.test.ts`, `packages/scan/README.md`.

**Acceptance.**

- An `http:` URL whose host is not `localhost`, `127.0.0.1` or `::1` prints one warning on
  stderr (not in `--json` stdout) unless `--dry-run`; the upload still runs.
- Tests for localhost (no warning), a remote `http:` host (warning) and `https:` (no warning).
- The README options table mentions it.

## 9. A Settings switch for base image alerts

**Context.** Every org has `Org.baseImageAlerts` (default `true`); turning it off stops the
base image scan, its emails and its presentation. Today the only way is the database
(`docs/PRIVACY.md`, "Base image advisories": "There is no settings control yet").

**Files.** `src/app/settings/page.tsx`, `src/app/settings/_client.tsx`,
`src/app/settings/actions.ts`, `prisma/schema.prisma` (`Org`), `docs/PRIVACY.md`.

**Acceptance.**

- A switch under Settings, for owners only, written through a Server Action. `Org` is not a
  tenant table, so update it by the session's `orgId`, never by an id from the form.
- The form keeps the saved value after submit (AGENTS.md, "Forms with `useActionState`").
- A test for the action (owner can change it, member cannot) and the PRIVACY.md sentence
  updated. A screenshot of the setting in light and dark in the PR.
