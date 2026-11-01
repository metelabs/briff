<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Briff

Weekly briefing built from the user's own stack, plus same-day security alerts.
Delivery is **email only** (Brevo SMTP); there is no Telegram (founder decision, 15 Oct 2026).
The product plan and founder decisions live in the maintainer's notes outside this repository. Next.js 16
differs from older versions (see the block above); check `node_modules/next/dist/docs/` before guessing APIs.
This file is the project guide for every coding agent and for people; `CLAUDE.md` only imports it.

## Stack

- Next.js 16 (App Router, Turbopack), React 19, TypeScript strict (no `any`).
- Tailwind v4 + Base UI primitives (shadcn `base-nova` setup), restyled with the design tokens in
  `src/app/globals.css`. The design system is **`docs/DESIGN.md`** (mocks: `docs/design/`); never
  shadcn's default zinc look. Theme: System / Light / Dark from the account menu, stored in the
  `briff-theme` cookie and rendered by the root layout as `<html data-theme>` (System = no
  attribute, CSS follows `prefers-color-scheme`). Fonts are self-hosted with `next/font/local`
  (`src/app/fonts.ts`, files + OFL licences in `src/app/fonts/`). Logo: final assets in `public/brand/`
  (README rules in `docs/DESIGN.md` §12); `<Logo />` is `src/components/logo/Logo.tsx` (lockup | mark |
  wordmark; `tone="auto"` takes the disc from `--brand`). Favicon `src/app/icon.svg` + `icon1.png`,
  `apple-icon.png`, `opengraph-image.png` are the brand files. Never coral in the logo.
- Postgres + Prisma 7 (`prisma-client` generator → `src/generated/prisma`, pg driver adapter).
- Better Auth, email + password. Worker: plain Node process, `node-cron` (UTC), queue in Postgres.
- Vitest, ESLint (next config), Prettier. npm (lockfile v3). Node 22.

## Layout

```
src/app/                 pages (/ home overview, /bulletins, /b/[id], /alerts, /stack, /repos, /streams, /settings, /onboarding, /admin, /login) + route
                         handlers (/api/health, /api/scan, /api/export, /api/auth/[...all])
src/proxy.ts             `/` without a session cookie -> rewrite to /landing (docs/LANDING.md)
src/app/landing, replay/ public pages (no session, no tenant imports: src/test/public-routes.test.ts),
                         robots.ts / sitemap.ts; parts in src/components/landing, src/components/replay
src/components/bulletin/ the bulletin page body (BulletinContent, pivot), shared by /b/<id> and the landing sample
src/components/shell/    app shell: top bar, pill nav, Connect repos sheet, stream picker (scope cookie,
                         src/lib/stream-scope.ts), account menu, footer
src/components/ui/       restyled primitives (button, input, card, toast, ...)
src/lib/db/              getDb() (lazy Prisma client), withOrg() tenant layer
src/lib/auth/            Better Auth config (lazy getAuth()), session helpers
src/lib/jobs/            queue: enqueue (idempotent), claim (SKIP LOCKED), backoff
src/lib/scan/            /api/scan schema + ingest, scan tokens (tokens.ts pure, token-store.ts DB)
src/lib/rss/, platforms/ ported from an earlier feed aggregator (SSRF-safe fetch, RSS/Atom parser, HN/GH/PH)
src/lib/match/           deterministic item -> org matcher + stack loader
src/lib/streams.ts       bulletin streams: slugs, membership writes, Repo.included sync
src/lib/services.ts      package -> service mapping table (extend here)
src/sources/             adapters (curated + runtime feeds, GitHub releases, GitHub security advisories, npm, OSV,
                         changelog.md) and job handlers
src/lib/runtime-security.ts  runtime security items: pattern, Item.metadata shape, fix status per release line
src/security/            security-scan: OSV query plan, alert dedupe (plan.ts, pure) and the job (scan.ts)
src/pipeline/            triage-items, weekly-bulletin (selection, synthesis, assembly), delivery,
                         feedback -> weights, profile refresh, bulletin view model
src/llm/                 Anthropic client (structured output + zod), fake client, prompt loader
src/llm/prompts/*.md     versioned prompts (`<!-- version: x-vN -->` first line); bump the version on edit
                         (synthesis is at `synthesis-v8`: text describes its own ref; action is a command or covers every affected repo; a security headline names `fix_versions`;
                         repo names are aliases, see `src/llm/pseudonym.ts`)
src/lib/email/           mailer (nodemailer, Brevo), templates (bulletin, alerts, urgent, test), layout
src/worker/              worker entry, runner, scheduler, handler registry
src/replay/              replay harness: scenarios of real incidents (items + sample repos + world
                         events), engine running the pure pipeline on a fake hourly clock, timeline page
packages/scan/           npm package `briff-scan` (MIT): CLI + lockfile/runtime parsers, no server imports;
                         the app imports the parsers as `@scan/*` (tsconfig path), never copies them
scripts/                 scan-local.ts (tsx; thin wrapper: briff-scan --all-repos over ~/code for the systemd unit),
                         build-worker.mjs (esbuild), replay.ts
deploy/systemd/          systemd user units for the scanner
docs/                    SCANNER.md (runbook), SOURCES.md (feeds and matching), DESIGN.md (UI system), design/ (mocks),
                         OPERATIONS.md (health, job alerts, run history, Sentry)
compose.yaml             self-hosting stack (web, worker, postgres; .env.selfhost.example, docs/SELF-HOSTING.md,
                         docs/UPGRADING.md, smoke test scripts/smoke.sh); docker-compose.dev.yml = dev Postgres only
```

## Conventions

- **Tenant data only through `withOrg(getDb(), orgId)`.** It pins `orgId` into every
  where/data clause and throws on conflicts. Tenant models: OrgMember, Repo, Dependency,
  RepoRuntime, ItemMatch, Alert, Bulletin, BulletinItem, Feedback, InterestProfile, Deadline,
  BulletinStream, StreamRepo, ScanToken, GithubInstallation. Creates
  still pass `orgId` explicitly (Prisma types require it; the layer verifies it). Nested
  relation writes and raw SQL bypass the layer, so do not use them for tenant tables.
  Global catalog tables (Package, Service, Source, Item, Advisory, Job, Run, OpsAlert) use `getDb()`.
  Two reads run before the org is known and are the only tenant reads outside the layer:
  the session's membership (`getOrgContext`) and the scan token lookup by hash
  (`findScanTokenByHash`, `src/lib/scan/token-store.ts`), and the GitHub App's installation
  lookup by GitHub id from webhooks and scan jobs (`findInstallation`, `src/lib/github/installations.ts`). Deleting an org (`deleteOrg`,
  `src/lib/org-data.ts`) also counts the user's remaining memberships through `user._count` to
  decide whether the user goes too.
  These rules cover the application (`src/`, `packages/`). `scripts/smoke.sh` is an external
  black-box check of a throw-away compose stack: it cannot reach `withOrg` from a shell, so it
  inserts its scan token and reads its assertions with `psql` (scan tokens are only created
  by a Server Action). It never runs against a database it did not create.
- Your data (Settings): `GET /api/export` streams the session's org as JSON section by section
  (`orgExportSections`, no token hashes, no auth rows); `deleteOrgAction` deletes the org after the
  typed name matches (owners only), its pending jobs, and the user when it has no other org, then
  drops the session cookies. Every tenant table cascades from `Org`; a new tenant table must too
  (`org-data.integration.test.ts` checks every one).
- Account emails (`src/lib/auth/auth.ts`, `auth-email.ts`, templates `src/lib/email/account-email.ts`
  built from the reusable pieces in `src/lib/email/components.ts`): password reset (`/forgot-password`
  → Better Auth link, 1 h → `/reset-password`; all sessions revoked), email verification on sign-up
  (24 h, never required to sign in; banner with resend in the shell and onboarding), Settings →
  Account change email (link to the new address) and change password (other sessions revoked).
  Endpoints that send email or check a password are limited per IP in `AUTH_LIMITS`
  (`signup-limit.ts`), both as Better Auth `customRules` and in the before-hook, because Server
  Actions call `auth.api.*` directly and skip Better Auth's limiter. `orgRecipients` drops members
  unverified 7 days after sign-up (`receivesDelivery`).
- Scan auth (`/api/scan`, `src/lib/scan/tokens.ts`): `Authorization: Bearer brf_<40 url-safe>`
  is a per-org `ScanToken` (created in Settings → Scan tokens, secret shown once, only its
  sha256 `tokenHash` and an 8-char `prefix` stored); the token decides the org and gets
  `lastUsedAt`, a revoked one is 401. Anything else is compared with the deprecated
  instance-wide `SCANNER_TOKEN` (org from `SCANNER_ORG_ID` or the only org), which logs a
  warning per upload.
- Mutations from the UI are Server Actions; route handlers only for external callers
  (`/api/scan`, `/api/health`, auth) and the export download (`/api/export`).
- Page shell: `page.tsx` is a server component; interactive parts live in a `_client.tsx` sibling.
- Every external fetch of a URL that came from data (feeds, release URLs) goes through
  `safeFetch` / `fetchRssFeed`. Fixed API hosts (npm, OSV) may use `fetchWithRetry`.
- Logging: `log` from `src/lib/log.ts` (JSON lines, keys matching token/secret/password redacted).
- Env: read via `getEnv()` (zod) at request/job time, never at module top level.
- Code, comments, commits, PR text in English. Conventional commits.
- LLM calls go through `getLlm()` (`src/llm/client.ts`): JSON-schema structured output, then zod
  validation, then a pure "interpret/assemble" step that only keeps refs present in the input.
  Every LLM-produced row stores `model` and `promptVersion`; usage goes to `Run.tokens`.
  Latency-tolerant jobs use `jsonMany(...)`: one Message Batch via `llm.jsonBatch` when
  `BRIFF_LLM_BATCH` (default true), else one call per request; failures come back per entry.
  The fake runs the same batch code (custom_id mapping, decoding) in memory.
- Fix commands (`src/pipeline/fixes.ts`): per installed release line (major, or `0.minor`), install
  the highest of the OSV fixes resolved for that line and the item's newest release version on
  that line (a folded item passes all its releases). A release on a higher line never forces a major upgrade. One line →
  `npm i pkg@X` (only when it covers every affected repo, else `npm i pkg@X (repos)`; each ecosystem's own
  command, `src/pipeline/install-commands.ts`: `composer require vendor/pkg:^X` for Packagist); several → one
  command per line with its repos; a line without a safe fix gets no
  command but its repos and "read the advisory" (`9.x has no known fix, read the advisory: a, b`),
  so the other lines keep theirs; no line with a safe fix → the i18n sentence. `lineFixes`
  gives the per-line result (command and `packageUpgrades` targets); `recommendFixes` (alert lines)
  still needs a fix on every line.
  The same item therefore gives the same version in every stream for the same installed line.
  Commands are only for **direct** dependencies (`RepoFix.direct`): repos that have the package only
  transitively are appended as `· transitive: a, b`; a package that is transitive everywhere gets
  the `act_transitive` sentence (`npm ls <pkg>` shows what pulls it in; the dependency rows do not
  record the parent). Only installed versions an advisory affects (`isAffected`) feed the command
  (`summariseAlerts`), so a repo already past the fix, or a second installed version, cannot void it.
- Installed → target per repo (`src/pipeline/upgrades.ts`): every recommended upgrade shows what each
  affected repo runs next to the version the action moves it to (`bakery.example: next 15.2.3 → 16.3.8`,
  `garden.example runs node 22.17.0 (Dockerfile) → 22.23.4`), one line per repo and release line; a repo
  without a version on record says "installed version unknown", a matched runtime repo past the fix says
  "not affected". Security items derive it at selection from the same facts as the action
  (`candidateUpgrades`: `recommendFixes` / `affectedRuntimeRepos`); release items after synthesis
  (`itemUpgrades` / `releaseUpgrades`: the install command's version only when it is one of the
  item's own or folded releases, else the newest of those on the repo's installed line; never another
  line by default, and no target when none qualifies). Stored on
  `BulletinItem.upgrades` (bulletins before this column show none); alert lines and Alerts groups
  compute theirs as `installs`. Rendered by `UpgradeList` on the page and as muted lines in the email.
  Runtime lines also store the repo's own derived step (`RepoUpgrade.action`, the `repoAction`
  sentence without the repo: `move Dockerfile to node:22.23.4-alpine`), so a summarised item action
  ("Update Node.js to 22.23.4 in 12 repos") still shows each repo's step: under the By item fix box
  (`repoFixLines`, first 5, "Show all N") and in its By repo card (`upgradeActions`; direct packages
  with a target get `npm i pkg@target`). Bulletins stored before the field show the item action.
- Ref guard (`modelText` in `assembleBulletin`, synthesis-v6): for act/know **release** items the
  model headline or line must name one of the item's `identityTokens` (`release:`/`package:` keys
  with and without `@scope/`, the GitHub `owner/repo` of a "<owner>/<repo> releases" source, the
  title's leading token). Otherwise the item keeps its section and to-do but gets its own title and
  first sentence; `refMismatch` is counted and logged at warn. Non-release items (blog posts) have
  no tokens and are not checked: their leading title word says nothing about the subject.
- Headline guard (`boundHeadline` in `assembleBulletin`, synthesis-v8): a must-act security item
  carries `fixVersions` (`fixVersions()` in fixes.ts: the versions its command installs, newest
  first), sent to the model as `fix_versions`. In every stored headline (act, know and must-act overflow in rest), a version from the item's
  own or folded titles that is not one of them is replaced by them ("Fastify 5.12.6 security
  release" with fix 5.12.7 → "Fastify 5.12.7 security release"); other versions are left alone.
- Act actions (`chooseAction`, synthesis-v5): a security must-act item with a derived action always
  uses it; a model command loses to a derived command; a model sentence that names only some of the
  item's affected repos (`namesRepoSubset`, full name or last path segment) falls back to the
  derived action, else the must-act fallback.
- Repo names never reach the LLM (docs/PRIVACY.md): every request that carries them goes through
  `repoAliases` (`src/llm/pseudonym.ts`): structured repo fields become `repo-N` (code-point order of
  the request's names), free text (`suggested_action`, profile text) is rewritten whole-token, and the
  parsed output is mapped back before assembly (`src/pipeline/synthesis-privacy.ts`, `profileRequest`).
  A new LLM input field that can hold a repo name must be added there;
  `llm-payload.integration.test.ts` fails when an org/user/token/repo value reaches a prompt.
- Only the worker calls the LLM. The web app enqueues jobs (admin buttons) and sends the test email.
- English only (bulletin.md §15): `PRODUCT_LANGUAGE` (`en`) drives synthesis, emails and the
  bulletin page; there is no language picker. The `tr` strings in `src/lib/i18n.ts` stay unused.
- Upper-cased labels go through `caps()` (`toLocaleUpperCase("en-US")`). Never use CSS
  `text-transform: uppercase` / Tailwind `uppercase` or a bare `toLocaleUpperCase()` on copy:
  under a Turkish locale "Security" becomes "SECURİTY".
- Forms with `useActionState`: React resets the form after the action, back to each field's
  default. Return the saved value from the action and use it as the default (see `/settings`,
  `/streams`), or the field can show the value from before the save.
- Public pages (docs/LANDING.md): `/` is the landing page for a request without Better Auth's
  session cookie (`src/proxy.ts`, matcher `/` only), the dashboard otherwise. Public routes never
  import the DB client, auth, `next/headers` or Server Actions (`src/test/public-routes.test.ts`);
  replays shown there come from `publicReplay` (cached per process). Repository links come
  from `SOURCE_URL` (`src/components/landing/links.ts`).
- Home (`/`, the logo's link, for members): bulletins per stream with a 12-week attention sparkline, then
  alerts, stack health and repos for the picked stream, then last scan / last / next bulletin. Its
  pure parts (series, severity split, next slot, sparkline geometry) are `src/pipeline/home.ts`;
  charts are inline SVG with the tokens (`src/components/ui/charts.tsx`), no chart library.
- Onboarding is shown once (`src/lib/member-state.ts`): `/` and `/onboarding` send a member there
  only while the org has no repo in a stream and `OrgMember.onboardedAt` is null (set by Skip or
  Continue). Afterwards the same steps (`src/app/onboarding/connect.tsx`) open in the Connect repos
  sheet (top bar, Settings → Scan tokens, empty states). The Alerts dot means new-kind alerts
  created after `OrgMember.alertsSeenAt`, which opening `/alerts` sets.
- Backlog review (`src/pipeline/alert-review.ts`, actions in `src/app/alerts/actions.ts`): "Mark
  backlog as reviewed" (every unreviewed backlog alert of the org) and "Mark reviewed" per package
  (stream scope) set `Alert.reviewedAt` on `kind = backlog` rows only. Reviewed backlog is hidden
  from the default Alerts view and the home counts; `/alerts?reviewed=1` lists it. `new` alerts
  are never hidden, and delivery (`deliveredAt`, urgent emails, the bulletin's backlog lines)
  does not read `reviewedAt`.
- Alert resolution (`src/security/resolution.ts`, run in `ingestScan`): an upload that no longer
  has an affected version of an alert's package sets `Alert.resolvedAt` (never deletes; a package
  that is gone counts only from a complete snapshot, i.e. the GitHub App (`completeSnapshots`), as
  a briff-scan lockfile can fail to parse; only when
  the previous upload had the package, the new one carries its ecosystem and the OSV record covers no
  other package (`Advisory.packages`; a multi-package record's stored ranges may be another
  package's, so those are never resolved on upload; rows stored before it are refetched by
  security-scan, 500 per run, also when OSV no longer answers with them; withdrawn ones get `[]`); versions the ranges cannot place keep it open), and an affected version coming back clears it, as does a
  security-scan that OSV says is at risk again (no second email). Resolved alerts leave the Alerts
  lists, Home counts, the Alerts dot, Repos counts and the weekly bulletin input; stored bulletin
  pages keep theirs. Alerts shows "Resolved: N this week" and per section "Fixed since your last
  visit" (resolved after the previous `alertsSeenAt`). "Re-check now" (`recheckAction`) queues a
  forced `github-scan` per GitHub App installation (own dedupe key `...:force`), once per 10 minutes per org
  (`Org.recheckRequestedAt`), polls until no scan of the installations (follow-ups included) is pending or running and reloads; briff-scan repos get the
  upload command instead. The sticky section bar (`AlertSectionNav`) is `data-sticky-top`;
  `stickyOffset` counts a stacked bar from its CSS `top`.
- In-page scrolls from buttons and section links go through `scrollToElement`
  (`src/lib/scroll.ts`): smooth unless reduced motion, below the sticky bar (`data-sticky-top`;
  the bar also exposes `--bar-h` for `scroll-margin-top` on anchor targets).
- Stream scope: the top bar's stream picker stores the chosen stream in the `briff-stream` cookie;
  pages showing repo data (Alerts, Stack) filter with `repoScope(await loadStreamScope(orgId))`
  (`src/lib/stream-scope.ts`). Alerts groups per package with `alertGroupsOf`
  (`src/pipeline/alert-groups.ts`, same fix rules as the bulletin's alert lines); Stack uses
  `computeDrift` (`src/pipeline/stack-drift.ts`: runtimes vs the EOL table, packages vs
  `Package.latestVersion`).
- Streams: a `BulletinStream` is a named repo set with its own weekly bulletin and email.
  `Repo.included` means "in at least one stream" and stays the gate for triage and security
  alerts; change membership only through `src/lib/streams.ts`, which writes the membership and
  recounts `included` in one transaction after locking the repo rows. Deleting a
  stream keeps its bulletins (`Bulletin.streamId` is set to null). New orgs get a "Weekly" stream
  (`src/lib/org.ts`, written through `withOrg` in the same transaction as the org).

## Run locally

```bash
docker compose -f docker-compose.dev.yml up -d   # Postgres 16 on 127.0.0.1:55432
cp .env.example .env                  # fill BETTER_AUTH_SECRET; DATABASE_URL is preset
npm ci                                # runs prisma generate
npm run db:migrate                    # prisma migrate dev
npm run dev                           # web on :3000; first sign-up at /login owns the instance
npm run dev:worker                    # worker with watch
npm run worker -- --once collect-sources refresh-packages   # one-off: enqueue, drain, exit
npm run worker -- --once security-scan weekly-bulletin      # (worker scripts load .env themselves)
npm run email:preview -- --out /tmp/briff-mail             # render bulletin/alert/urgent emails to files
npm run replay -- php2shell --out docs/replay/php2shell.html  # replay an incident (no DB/SMTP/LLM)
npm run scan:local -- --dry-run       # what the scanner would upload (~/code, every repo)
(cd packages/scan && npm run build) && node packages/scan/dist/cli.mjs --dry-run   # the npm CLI on this repo
```

Without an Anthropic key, set `BRIFF_LLM_FAKE=true` in `.env`: a deterministic keyword stand-in
(rows get `model = fake:<model>`; refused when `NODE_ENV=production`).

NixOS: the Prisma schema engine has no NixOS binary and the system `PRISMA_*_ENGINE_*`
env vars point at an older engine. Run migrate commands in a container. `migrate dev` refuses to
run without a TTY, so create migrations with `migrate diff` and apply with `migrate deploy`:

```bash
DOCKER_PRISMA="docker run --rm --network host -u $(id -u):$(id -g) -e HOME=/tmp -v $PWD:/app -w /app node:22-bookworm-slim npx prisma"
mkdir -p prisma/migrations/<timestamp>_<name>
$DOCKER_PRISMA migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > prisma/migrations/<timestamp>_<name>/migration.sql
# review the SQL (enum changes are emitted before CREATE TABLE; reorder by hand if needed)
$DOCKER_PRISMA migrate deploy && $DOCKER_PRISMA migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
```

`prisma generate` works on the host.

Checks before a PR: `npm run typecheck && npm run lint && npm test`. DB-backed tests
(`*.integration.test.ts`) run when `TEST_DATABASE_URL` points at a migrated, disposable DB (CI sets it).

## Worker and jobs

- Job types: `security-scan`, `collect-sources`, `triage-items`, `weekly-bulletin`,
  `refresh-packages`, `ops-check`, `bulletin-preview`, `github-scan` (`src/lib/jobs/types.ts`); handlers in `src/worker/handlers.ts`.
- Observability (docs/OPERATIONS.md, `src/lib/ops/`): a job that fails for good (runner) or a
  scheduled type without a success within its cron interval + grace (`ops-check`, every 30 min;
  `jobFreshness`, never alerts on a type never queued) emails `OPS_ALERT_EMAIL` or the instance
  admin (`findInstanceAdmin`, same rule as `/admin`) and POSTs `ALERT_WEBHOOK_URL`, once per
  (job type, kind) per 24h (`OpsAlert`). `/api/health` returns 503 on a stale type or a due job
  older than 1h; the container healthcheck uses `?probe=live` (database only). Admin → Runs is
  `/admin/runs`. Sentry (`src/lib/sentry.ts`) loads only with `SENTRY_DSN`.
- GitHub App (docs/GITHUB-APP.md): `/api/github/install` → GitHub → `/api/github/setup` (signed state)
  → app OAuth → `/api/github/callback` links the installation only when the GitHub user can access
  it; `/api/github/webhook` (5 MB cap, HMAC before parsing) queues `github-scan` jobs. The job reads
  the default branch's tree and fetches only `isScannedPath` blobs (`packages/scan/src/files.ts`),
  builds the payload with `collectFromFiles` (same code as the CLI) and ingests through
  `acceptScan`; an unchanged head (`Repo.githubHeadSha`) is skipped.
- Schedule (UTC, `src/lib/jobs/schedule.ts`, run by `src/worker/scheduler.ts`): refresh-packages 03:00 daily, security-scan
  04:00 daily, weekly-bulletin Monday 04:00, ops-check :10 and :40, collect-sources **hourly** with payload `{ due: true }`
  (it enqueues triage-items when done; triage also runs at :30 every 6h as a catch-up). The systemd
  scanner (`deploy/systemd/`) runs 03:30 UTC and enqueues refresh-packages itself.
- Source classes (`Source.class`): `security` sources are fetched on every hourly run, `releases`
  and `news` once their last fetch is 5h50m old (`isSourceDue`); a manual collect (no `due`
  payload) fetches all. Runtime sources (`RUNTIME_SOURCES` in `src/sources/curated.ts`) carry
  `runtime` and a class; `github_advisories` sources read `GET /repos/{o}/{r}/security-advisories`
  through `fetchWithRetry` (fixed host, `GITHUB_TOKEN` when set, ETag).
- Deterministic runtime urgent path (collect-sources, no LLM, `src/pipeline/runtime-urgent-plan.ts`
  pure planning shared with the replay, `runtime-urgent.ts` the DB/email pass):
  new items of a `security` source with a runtime that are advisories or match the security
  pattern get `Item.metadata` (CVEs, severity, fixed versions, `lineSpecific`, `scheduledAt`) and a
  rule `ItemTriage` (`security`, reason `runtime-security`, model `rule`; only items of the last
  14 days). The same run emails each org's pending `ItemMatch` rows (`urgentAt` null, item < 72h,
  through an included repo) with the urgent template: what each repo runs (`RepoRuntime`), fixed
  versions or the announced release time, the derived action, the link. Critical/high/unknown
  severity only; repos past the fix and other release lines are skipped (`urgentAt` set).
  **Incident fold** (`src/lib/runtime-incident.ts`, used by `planRuntimeUrgent` and
  `oneActPerRuntime`): items of one runtime that share a CVE id (or, for a post without CVE
  ids, a fixed version) within 72h are one incident and one email block: the primary's title
  (notice-to-fix announcement > vendor multi-line advisory post > GHSA by id > release post,
  `contentHash` tie-break), merged CVEs / highest severity / fixed versions per line, one "To do"
  line per repo once fixed versions are known, and a "Sources" line with every folded item. A
  single-line release post is a source only when it affects a repo on its own line; the others are
  handled silently. The weekly act item uses the same primary and merged facts, so the email and
  the bulletin agree. Never fold by copying this logic elsewhere; call the module.
  `urgentAt` is set once a member got the email; no SMTP, the flag off, no members or a total
  failure retries next hour. Once per (item, org). The loop heartbeats before every org and send.
  Matching of runtime security items is **reconciliation, not an event**
  (`reconcileRuntimeMatches`, `src/lib/match/rematch.ts`): before every urgent pass (hourly: every
  org; scan-triggered: the scanned org), each open item (published or `fixAddedAt` < 72h) gets
  the included repos with a row of its runtime appended to `ItemMatch.repoIds`; never removed,
  idempotent, three queries per org. Scan uploads never trigger the pass directly: every scan
  (`scanId`, `final: true` on the last upload; docs/SCANNER.md) schedules one collect-sources job
  per org (`{ due: true, rematchOrgId }`, dedupe `collect-sources:scan:<orgId>`, `scheduleJob`
  moves its `runAfter`), whether or not runtimes changed; uploads without a session are debounced
  (2 min). Follow-ups, once each: repos missing from `ItemMatch.urgentRepoIds` get an "also
  affects" email listing only them (in the fix form, fixed versions + one action per repo, once
  the item has fixed versions); an announcement whose post gained fixed versions in place
  (`metadata.fixAddedAt`, `src/sources/announcement-reconcile.ts`) gets one "fix is out" email
  with one action per repo (`fixNotifiedAt`). After `fixNotifiedAt`, `urgentRepoIds` is the fix
  coverage (every later email carries the fix), so there is no separate fix marker. A matched,
  included repo without an action is named ("Not affected: x (24.22.1 in Dockerfile).", only for
  a repo past the fix or on a supported line the incident does not list; an EOL line gets the EOL
  sentence and an unknown line "check which version runs", even under a single-line post; "no
  Node.js version on record", "node version unknown (the Dockerfile tag uses a build
  argument ...)"), never dropped silently. Node.js posts have no feed
  body; it is read from their Markdown in `nodejs/nodejs.org` (`src/sources/post-body.ts`) and
  re-read while the announcement has no fixed versions. `affectedLines` (lines the post lists)
  drops supported lines it does not list; an end-of-life line (`src/lib/runtime-eol.ts`, static,
  endoflife.date; a line missing below the newest known one is EOL, a line above it is unknown
  and still emailed) gets "node 18 is end-of-life and will not get this fix; move to 22.23.4 or
  later", the only derived sentence that names a newer major (see the fix-version rule below).
  Delivery is serialised: `sendRuntimeUrgent` holds a Postgres advisory lock for the whole pass
  (`urgentAt` is written only after SMTP), a pass that cannot take it sends nothing
  (`runtimeUrgentLocked`); a scan-triggered pass is scoped to its org (`orgIds`).
  Advisory items are reconciled by GHSA id (`reconcileAdvisories`): edits update the item in
  place; only a severity rise across the email threshold reopens handled matches.
- security-scan: OSV querybatch with installed versions of **included** repos (direct + transitive,
  direct first), Advisory upsert (refetch only when OSV `modified` moved), one Alert per
  (advisory × repo) ever, one email per org per run.
  - One Advisory per vulnerability (`src/security/aliases.ts`): OSV returns the GHSA next to the
    GO-_/PYSEC-_ entry; records linked through `aliases` (not `related`) are merged under the
    GHSA id, else the CVE, else the native id, the others kept in `Advisory.aliases` (shown on
    Alerts as "also GO-2023-1737"). A row with `aliases` null (stored before this) is refetched,
    and rows that turn out to be one vulnerability are merged: alerts move to the canonical row,
    the oldest per repo kept, delivered/reviewed if any of them was (`planAlertMerge`), so nothing
    is emailed again.
  - `Advisory.severity` is a level (LOW/MODERATE/HIGH/CRITICAL) or null: GitHub's
    `database_specific.severity`, else the CVSS 4.0 / 3.x base score (`src/security/cvss.ts`,
    FIRST formulas) in GitHub's bands, else an alias's level. Readers go through
    `severityLevel`/`severityLabel` ("UNKNOWN", never empty).
  - Only `ECOSYSTEM`/`SEMVER` ranges place installs and name fixes; `GIT` ranges (commit hashes) are
    dropped in `rangesFor`.
  - `Alert.kind`: `backlog` when the repo had no security scan since it was (re-)added
    (`Repo.securityScannedAt` null or older than `includedChangedAt`; set to the run start for every
    repo whose dependencies the run checked), else `new` (by construction the advisory or the installed
    version changed since the previous scan). `alertKindFor` in `src/security/plan.ts`.
  - Same-day email threshold (`emailsImmediately`): new **critical/high** alerts, unknown severity
    (none, or a vector that cannot be scored) counts as high. New moderate/low alerts are not emailed and keep
    `deliveredAt = null` (bulletin only; emailed later if OSV raises them). Backlog alerts are never
    emailed one by one: one first-scan summary (count, critical/high count, repos, link to
    `/bulletins`) in the same run's email, then they are marked delivered (`splitPending`,
    `backlogSummary`).
  - In the email, advisories with a direct repo are one block each with their fix; transitive-only
    ones are grouped per package under "Transitive dependencies", labelled, without a fix.
  - `deliveredAt` is set once an email covered the alert (SMTP missing or failing → retried next run;
    stale ones are dropped). Nothing is sent twice.
- triage-items: matched, untriaged items published in the last 14 days, reached through an
  included repo (or stack-wide), up to 400 per run, 20 per Haiku request, all requests in one
  Message Batch. One `ItemTriage` per
  item (global). Pre-release titles and titles carrying a bare 40-hex commit sha (monorepo CI
  tags, reason `sha-tag`) get a rule-based `minor` row without an LLM call
  (`ruleMinorReason`, `src/pipeline/versions.ts`); the bulletin drops them whatever the stored bucket.
  Runtime security items already carry a rule `security` row (reason `runtime-security`) from
  collect-sources, so triage never sees them.
  Pre-release = a hyphenated tag after a digit (canary, beta, alpha, rc, next, nightly, dev,
  prerelease, preview, experimental, insiders) or a whole-word beta, alpha, `rc\d*`, preview,
  prerelease, canary or nightly in a title that also has an `x.y` version ("TypeScript 7.1 Beta"; "Alpha Vantage SDK 2.0.0" is an
  accepted false positive). Only the title is tested, never the body.
  `deadline` → `Deadline` rows (confirmed = false). Only `security` → immediate email when
  `BRIFF_URGENT_EMAIL` (default true).
- weekly-bulletin, per org: profile refresh (Haiku, only when there is new feedback, org-level),
  then per stream with ≥1 repo: items triaged since that stream's previous bulletin (else 7 days),
  same-package releases folded (the newest non-minor release is the primary; releases triaged
  `minor` fold under it as also-released, never rule-minor rows; `releaseVersionsOf` hands every
  folded version to `recommendFixes`, which installs the newest one per installed line, so 10.1.2
  security + 10.1.3…10.1.7 minor gives `npm i nodemailer@10.1.7`; minors without a non-minor
  release of the package stay minor; `countMinor` runs on the folded list; a non-release `rest` item sharing a matched `service:` /
  release-or-mention `package:` key with a **security** act item is folded under it as "Related",
  see `storyKeys`), stream scope (items reached only through repos outside the stream
  are dropped; platform-wide `trait:<t>` items need the trait among the stream's services,
  `trait:always` reaches every stream) + weights + 30-item input cap (must-act items are kept beyond
  it), item text 700 chars (security/deadline 1200), `stack` and `security_alerts` narrowed to the
  packages the selected items mention (`security_alerts` carries **new** alerts only; backlog alerts
  still make security items must-act through their repo fixes), a stream with only a first-scan
  backlog still gets a bulletin (its page lists the backlog), output capped to act ≤5 /
  know ≤5 / rest (counted), Sonnet synthesis skipped when `inputHash` (keyed by stream) is
  unchanged; the remaining streams of all orgs go out as **one Message Batch**, then each is
  stored and delivered. Counts carry `inputChars` (JSON sent to the model); `Run.tokens` carries
  `batch` / `synthesis:batch` markers (true = billed at the 50% batch rate, false = fake).
  `Bulletin`/`BulletinItem` upserted per (stream, ISO week), subject
  `Briff · <stream> · W43: undici · nodemailer and more` (≤78 chars), email to every member with signed page links (`src/lib/feedback-token.ts`, HMAC
  keyed from `BETTER_AUTH_SECRET`, 90 days). Re-running in the same week regenerates only if
  the input changed, and then re-sends. Feedback buttons live only on the page.
- bulletin-preview (admin "Preview synthesis"): payload `{ orgId, streamId, model }`
  (`src/pipeline/preview-payload.ts`), same selection + synthesis + assembly for one stream and
  the current week with the chosen model (direct call, not batched), stored with
  `Bulletin.preview = true` and `previewKey = <model>` (the week's bulletin has `previewKey = ""`;
  the unique key is (org, stream, week, previewKey)). Never emailed (`deliverBulletin` refuses),
  never moves the next period start or the real bulletin's input hash. Listed under "Previews" on
  `/admin` only, deletable there; only a preview's page shows the model / prompt version line.
- `enqueueJob` is idempotent per `dedupeKey` (default: the type) while a job is pending,
  guarded by a Postgres advisory lock. Claim uses `FOR UPDATE SKIP LOCKED`.
- Each attempt writes a `Run` (status, counts, tokens, error). Failures retry with backoff
  (30s doubling, cap 1h) until `maxAttempts`; jobs locked >30 min are released. Long waits
  heartbeat the lock: handlers get `ctx.heartbeat()` (moves `lockedAt` if this worker still holds
  the job, `touchJob`; throws `JobLockLostError` otherwise, which aborts the handler and cancels a
  pending batch), and batch polling calls it after every poll. Completing or failing a job only
  writes while `lockedBy` is still this worker; otherwise the attempt is logged as `lost`.
- Fix versions never cross the installed release line: an OSV fix or release on a higher major is
  ignored, and without an on-line candidate the act item gets the i18n sentence. Single exception:
  An end-of-life line gets the EOL sentence, which names the lowest supported line; that is the only derived action allowed to name a higher major, and it is worded as a migration, not a fix command.
- Runtime security items in the bulletin (`runtimeSignals` / `oneActPerRuntime` in
  `src/pipeline/bulletin.ts`, actions in `src/pipeline/runtime-fixes.ts`): must-act when a stream
  repo runs an affected version; action per repo from its primary `RepoRuntime` row (image row
  first): floating image tag → "rebuild to pick up PHP 8.3.36; the php:8.3-fpm tag already points
  to it", pinned tag → the tag to move to, version file → the version to set, constraint → "run X
  or later". Several items of one runtime keep one act item (newest with fixed versions, fixed
  versions merged per line); the rest fold under it as related. No major upgrade.
  Rows are judged on their evidence (`runtimeEvidence` / `evidenceRows`, docs/SCANNER.md
  "Constraints and evidence"): concrete rows first, an engines range (`RepoRuntime.constraint`)
  only when there are none and never as end-of-life.
- Alert-only streams (no selected items) send the 20 most severe advisories, grouped per package.
- Bulletin alerts come in two groups: `view.alerts` (new advisories of the period; email line
  "N new security advisories this week.") and `view.backlogAlerts` (first-scan backlog; email line
  "M older advisories from the first scan are listed on the bulletin page.", page: a collapsed
  `<details>` below the new ones). Lines whose package no affected repo has directly are
  `transitive`: labelled, no fix, sorted after the direct lines.
- The bulletin page's alert list is one line per package (`alertLinesOf`): highest severity,
  repos merged, advisory count, fix per installed release line (`recommendFixes`); a known
  installed version without an on-line fix shows "no fix on the installed release line" (never a
  higher major). Only when no installed version is on record are the advisories' fixed lists
  merged to the highest per line. Every "N advisories" count (email
  sentence, "N more ... not listed") counts advisories, not lines (`advisoryCount`).
- Handlers return `{ counts, tokens }`; throw only when the whole job failed (e.g. every
  source failed) so it retries. Per-item errors are counted, not thrown.
- Raw SQL compares against `now() AT TIME ZONE 'UTC'` because Prisma columns are UTC `timestamp(3)`.

## Replay harness

- `src/replay/engine.ts` runs a scenario (`src/replay/scenarios/*.ts`) with the real pure
  functions: scanner parsers for the sample repos, `runtimeMetaFor` / advisory adapter for items,
  `ruleTriageRows`, `matchItem`, `updatedAnnouncementMeta` for in-place edits,
  `selectRuntimeWork` + `planRuntimeUrgent` + `handledMatchUpdate` + `renderUrgentEmail` for the
  urgent pass, and `candidateFromMatch` + `selectCandidates` + `assembleBulletin` (empty model
  output) with `renderBulletinEmail` for the weekly act item. DB state lives in maps. Never copy
  pipeline logic into the engine; make the production function pure instead.
- Items are collected by the first hourly tick strictly after `visibleAt` (default
  `publishedAt`); php.net backdates release posts, so scenarios set `visibleAt` from a source.
- Every real incident gets a scenario and a case in `src/replay/replay.test.ts` (email count,
  order, send times, per-repo actions). The committed `docs/replay/*.html` must equal the
  rendered page (the test fails otherwise): rerun `npm run replay` after changing a scenario,
  a template or a pipeline sentence.

## Deploy

- Deploys are gated by release-please (`release-please-config.json`, `.release-please-manifest.json`,
  tags without `v`, e.g. `0.2.0`). Flow:
  1. A feature PR is merged to main; `.github/workflows/docker.yml` runs release-please, which
     opens or updates the release PR (`chore(main): release X.Y.Z`: version bump in
     `package.json` / `package-lock.json` / manifest, `CHANGELOG.md` entry). Nothing is built.
  2. The founder merges the release PR. release-please tags the commit and creates the
     GitHub release; the same run builds one image `ghcr.io/metelabs/briff` with tags
     `latest`, `<version>` and `sha-<commit>`, then calls the `DOKPLOY_WEBHOOK_WEB` /
     `_WORKER` secrets.
- Versioning is pre-1.0 with `bump-minor-pre-major`: `feat` bumps the minor, `fix` the patch,
  other types (`chore`, `docs`, `refactor`, ...) do not release on their own. Commit types
  therefore matter; keep conventional commits.
- Release PRs are changelog-only and exempt from the Codex-review rule; the founder merges them.
  They are opened with `GITHUB_TOKEN`, so `ci.yml` does not run on them (GitHub does not
  trigger workflows from `GITHUB_TOKEN` events). That is
  accepted: main is already green when the release PR is merged, and the PR only touches
  version files and the changelog.
- release-please needs Settings → Actions → General → Workflow permissions → "Allow GitHub
  Actions to create and approve pull requests".
- `workflow_dispatch` on the Docker workflow is the emergency escape hatch only: it builds and
  deploys the current main without a release (tags `latest` + `sha-<commit>`, no version).
  Use it when a release cannot be cut (e.g. release-please is broken); the next release
  catches up.
- Operator notes for the hosted instance (servers, deploy hooks, credentials) live outside this
  repository; keep host names, customer repos and accounts out of code, fixtures and docs
  (`src/test/private-names.test.ts` fails on known ones).
- Dokploy: `web` (default CMD `node server.js`, port 3000, domain app.briff.dev) and
  `worker` (CMD override `node dist/worker.mjs`), plus Postgres. All config is runtime env
  (`.env.example` documents each variable).
- The entrypoint runs `prisma migrate deploy` only for `node server.js` (set
  `MIGRATE_ON_START=false` to skip). The Prisma CLI lives isolated in `/app/migrate`.
- Healthcheck script handles both roles: web → `GET http://127.0.0.1:3000/api/health?probe=live`,
  worker → heartbeat file younger than 180s (refreshed every 30s, before each claim and on job heartbeats).
- Self-hosters run `compose.yaml` (pulls the image, builds nothing); CI validates it with
  `docker compose config` against `.env.selfhost.example`. A new env variable goes into both
  `.env.example` and `.env.selfhost.example`.

## Do not (all hit in production)

- Do not read env, open the DB or build auth at module top level: CI builds without env,
  and a page that does not touch request APIs first gets prerendered at build time.
  Pages call `headers()` (via `getOrgContext`) before anything else; keep every route `ƒ`.
- Do not add `NEXT_PUBLIC_*` variables or pass secrets as build args; nothing secret may
  enter an image layer.
- Do not narrow write permissions to `.next/cache`; the whole `.next` stays owned by the runtime user.
- Do not write `localhost` in healthchecks (busybox wget tries `::1`); use `127.0.0.1`.
- Do not use `next/font/google`; it makes the build depend on Google. System fonts or `next/font/local`.
- Do not expect the migration step to prompt; containers have no TTY (stdin is `/dev/null`).
  Never create a `dev` push baseline in the production DB; only `prisma migrate deploy` runs there.
- Do not call a Dokploy webhook before the image is pushed (it would pull the old `:latest`).
- Do not edit `CHANGELOG.md` or the version in `package.json` by hand; release-please owns them.
- Do not run the app under Alpine without tini; outbound HTTP on a schedule leaves zombies.
- Do not change the container port from 3000.
- Do not add Redis, Supabase or Vercel. Queue and cache live in Postgres / process memory.
- Do not scrape HTML for sources; if a vendor has no feed, document it in `docs/SOURCES.md`.
- Do not let the model add facts: synthesis output is only accepted for refs that exist in its
  input, URLs in model text are stripped, links always come from the stored item.
- Do not run worker code under plain `tsx`: it needs `--conditions=react-server` (modules import
  `server-only`); the npm scripts pass it.

## Code Review Rules

This file is the source of truth for conventions; the rules above define what correct code looks
like, and this section says how a review reports deviations from them.

### How to review

- Report every finding you can identify in this one review, ordered by severity (P0 first). Do not hold findings back for a later round: an issue visible in code this review covers must be reported now, not after the next push.
- On a re-review after fixes, review only the commits added since your previous review and check whether your earlier findings were fixed. Do not re-flag unchanged code, and do not reopen or repeat a thread that was answered with a reason.
- Every finding states a concrete failure scenario: the input or state, what goes wrong, and who is affected. No style-only, naming or formatting comments and no speculative "might be nicer" suggestions; lint, formatting and type checks belong to CI.
- A violation of a repository invariant below is a finding even when the code otherwise works.

### Severity

- P0: data loss or corruption, a security hole (auth or tenant bypass, data leak, secret exposure, injection), or a production outage.
- P1: incorrect behaviour a user hits in a normal flow.
- P2: edge cases and robustness (rare inputs, retries, races, error paths). Report P2 findings in this repository too.
- P3 and nits: do not report.
- A violation of a repository invariant below is at least P1.

### Repository invariants

- Tenant data (OrgMember, Repo, Dependency, RepoRuntime, ItemMatch, Alert, Bulletin, BulletinItem, Feedback, InterestProfile, Deadline, BulletinStream, StreamRepo, ScanToken, GithubInstallation) must be read and written through `withOrg(getDb(), orgId)`. A nested relation write or raw SQL on these tables is a finding. The only reads outside the layer are the ones listed under Conventions (`getOrgContext`, `findScanTokenByHash`, `findInstallation`, the `deleteOrg` membership count). `scripts/smoke.sh` is outside this rule (Conventions: it uses `psql` against its own throw-away stack). A new tenant table that does not cascade from `Org` is a finding (`org-data.integration.test.ts` must cover it).
- Fix commands and derived actions never recommend a higher major than the installed release line. A command or sentence that crosses the line is a finding, with one exception: An end-of-life line gets the EOL sentence, which names the lowest supported line; that is the only derived action allowed to name a higher major, and it is worded as a migration, not a fix command. (`src/pipeline/runtime-fixes.ts`, "node 18 is end-of-life and will not get this fix; move to 22.23.4 or later"; an EOL line has no fix on its own major, so naming the supported line is the only truthful action.) An EOL sentence in command form (`npm i ...`, a `FROM`/image tag, "set node X") is a finding.
- An item's repos have one source: `BulletinItem.affectedRepos` is the item's `affected_repos` in the synthesis input (match repos in the stream, plus repos with an alert on the item's security package), and `BulletinItem.upgrades` names exactly those repos (`alignUpgrades`; a repo without a version on record reads "installed version unknown"). A path that builds upgrades, actions or lines from another repo list is a finding. A model line or action that names only some of the affected repos is repaired after the alias restore (`completeRepoNames`, `chooseAction`), never stored as written.
- Model output is accepted only for refs present in the synthesis input; any path where model text adds a URL, a version or a package the input did not contain is a finding.
- Repo names, org names, user data and tokens never reach a prompt: a new LLM input field that can hold a repo name and does not go through `repoAliases` (`src/llm/pseudonym.ts`) is a finding. Only the worker calls the LLM.
- A security headline names the fix for the installed lines (`fixVersions` / `fix_versions`), not the feed release's version; a change that lets a headline name a release version outside `fixVersions` when that list is not empty is a finding. A line without a safe fix gets "read the advisory" in the command, never a version from another line.
- Jobs that can run longer than a few minutes must call `ctx.heartbeat()`; a loop that sends email or polls a batch without it is a finding.
- Nothing may be delivered twice: check `deliveredAt`, `urgentAt` and the batch `custom_id` mapping on every change to delivery code.
- Env is read through `getEnv()` at request or job time, never at module top level; the same holds for opening the DB and building auth. No `NEXT_PUBLIC_*`, no secrets in build args or image layers.
- Public routes (`src/app/landing`, `replay/`, `robots.ts`, `sitemap.ts`) never import the DB client, auth, `next/headers` or Server Actions; a page that reads tenant data must call `headers()` (via `getOrgContext`) first so it is never prerendered with another org's data.
- A fetch of a URL that came from data (feeds, release URLs, model text) that does not go through `safeFetch` / `fetchRssFeed` is a finding (SSRF).
- Schema changes ship a migration under `prisma/migrations/`; production only runs `prisma migrate deploy`, so a change that needs `migrate dev`, a prompt or a manual step on deploy is a finding.
- Upper-cased copy goes through `caps()`; CSS or Tailwind `uppercase` or a bare `toLocaleUpperCase()` on user-facing text is a finding (Turkish locale turns "Security" into "SECURİTY").
- Every LLM prompt edit bumps the prompt version; every behaviour change ships a Vitest test. A change to a parser or adapter without a fixture is a finding. A change to a replay scenario, template or pipeline sentence without the regenerated `docs/replay/*.html` is a finding.
- `CHANGELOG.md` and the version in `package.json` are owned by release-please; a hand edit in a feature PR is a finding. Release PRs (`chore(main): release X.Y.Z`) are changelog-only and are not reviewed.
- Host names, customer repos and accounts never appear in code, fixtures or docs (`src/test/private-names.test.ts`).
- Code, comments, commit messages and PR text are English.
