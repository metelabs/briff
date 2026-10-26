# Sources

Phase 1 collects only sources tied to the stack. Every fetch of a feed goes
through the SSRF-guarded `safeFetch` (DNS-pinned, redirects re-checked).
npm registry and OSV calls go to fixed hosts through `fetchWithRetry`.
No HTML is scraped: a vendor without a feed is listed below instead.

## Kinds

| Kind                | What                                                                                                                                                                 | Created by                        | Conditional requests                         |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------- |
| `github_releases`   | `https://github.com/<owner>/<repo>/releases.atom` for each GitHub repo that a **direct** dependency publishes from (one source per repo; monorepo packages share it) | `refresh-packages`                | ETag / Last-Modified stored on `Source`      |
| `rss`               | Curated official RSS/Atom feeds (`src/sources/curated.ts`)                                                                                                           | `collect-sources` (upsert by URL) | yes, when the server sends validators        |
| `changelog_md`      | Raw Markdown changelog, one item per `## <version>` heading                                                                                                          | curated                           | yes                                          |
| `npm`               | `registry.npmjs.org/<name>/latest`: latest version, deprecation, repository                                                                                          | used by `refresh-packages`        | —                                            |
| `osv`               | `api.osv.dev/v1/querybatch` + `/v1/vulns/<id>`                                                                                                                       | `security-scan` (daily 04:00 UTC) | records refetched only when `modified` moved |
| `github_advisories` | `api.github.com/repos/<owner>/<repo>/security-advisories` (published, newest 30): one item per GHSA, facts in `Item.metadata`                                        | curated (`RUNTIME_SOURCES`)       | ETag (`If-None-Match`)                       |

Items are deduplicated by `sha256(url + "\n" + title)` (`Item.contentHash`).
GitHub release titles are prefixed with the repo slug (`vercel/next.js v16.4.1`).

## Curated feeds (verified 15 Oct 2026: HTTP 200 and parsed)

| Source                        | URL                                                                        | Relevant to                                  | Items on first fetch    |
| ----------------------------- | -------------------------------------------------------------------------- | -------------------------------------------- | ----------------------- |
| Claude Platform release notes | https://platform.claude.com/docs/en/release-notes/feed.xml                 | everyone (`always`), service Anthropic       | 153                     |
| Claude Code CHANGELOG         | https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md | everyone (`always`)                          | 30 (latest 30 versions) |
| Expo blog                     | https://expo.dev/blog/rss.xml                                              | trait `expo`, service Expo                   | 50                      |
| Expo changelog                | https://expo.dev/changelog/rss.xml                                         | trait `expo`, service Expo                   | 50                      |
| Next.js blog                  | https://nextjs.org/feed.xml                                                | trait `nextjs`, service Next.js              | 84                      |
| Vercel blog                   | https://vercel.com/atom                                                    | service Vercel only (`@vercel/*` packages)   | 639                     |
| RevenueCat blog               | https://www.revenuecat.com/blog/rss.xml                                    | trait `in-app-purchases`, service RevenueCat | 50                      |
| Sentry changelog              | https://sentry.io/changelog/feed.xml                                       | service Sentry                               | 331                     |
| Dokploy releases              | https://github.com/Dokploy/dokploy/releases.atom                           | everyone (`always`)                          | 10                      |
| Apple Developer News          | https://developer.apple.com/news/rss/news.rss                              | trait `ios`                                  | 148                     |
| Android Developers Blog       | https://android-developers.googleblog.com/feeds/posts/default              | trait `android`                              | 25                      |

Traits come from the services an org uses directly (`src/lib/services.ts`):
Expo/React Native imply `ios`, `android`, `mobile`; RevenueCat implies
`in-app-purchases`; Next.js (`next`, `@next/*`) implies `nextjs`. Vercel (`@vercel/*`) is a
separate service with no traits: using `next` does not make an org a Vercel customer, so the
Vercel blog (AI Gateway model launches, hosting news) stays silent unless a repo uses a
`@vercel/*` package. Next.js releases still come from the `next` GitHub release feed.

## Source classes and cadence

`Source.class` is `security`, `releases` or `news` (default). collect-sources runs **every hour**
(`0 * * * *`, payload `{ due: true }`): `security` sources are fetched on every run, the others
once their last fetch is 5h50m old (`isSourceDue`, so effectively every 6 hours). A manual run
(admin button, `--once`) has no `due` payload and fetches everything. triage-items follows every
collect.

## Runtime sources (verified 22 Oct 2026: HTTP 200 through `fetchRssFeed` and parsed)

Each has `runtime: <id>` (ids from `packages/scan/src/runtimes.ts`) and reaches orgs whose repos declare
that runtime (`runtime:<id>` match, score 1.0). GitHub advisory repos were checked with
`GET /repos/{owner}/{repo}/security-advisories`; only repos that publish advisories are listed.

| Runtime  | Class    | Source                                                                   | Items on check   |
| -------- | -------- | ------------------------------------------------------------------------ | ---------------- |
| php      | security | https://www.php.net/feed.atom (news, release and advisory posts)         | 889              |
| php      | security | GitHub advisories `php/php-src`                                          | 66 published     |
| node     | security | https://nodejs.org/en/feed/vulnerability.xml (titles only; body below)   | 77               |
| node     | releases | https://nodejs.org/en/feed/releases.xml                                  | 819              |
| python   | security | https://mail.python.org/archives/list/security-announce@python.org/feed/ | 30               |
| python   | releases | https://www.python.org/downloads/feed.rss                                | 10               |
| go       | releases | https://github.com/golang/go/tags.atom                                   | 10               |
| ruby     | security | https://www.ruby-lang.org/en/feeds/news.rss                              | 10               |
| dotnet   | security | GitHub advisories `dotnet/runtime`, `dotnet/aspnetcore`                  | 86, 42 published |
| dotnet   | releases | https://github.com/dotnet/core/releases.atom                             | 10               |
| rust     | security | https://blog.rust-lang.org/feed.xml                                      | 10               |
| rust     | security | GitHub advisories `rust-lang/rust`                                       | 6 published      |
| postgres | security | https://www.postgresql.org/news.rss (also community news)                | 10               |
| postgres | releases | https://www.postgresql.org/versions.rss                                  | 29               |
| mariadb  | security | GitHub advisories `MariaDB/server`                                       | 27 published     |
| mariadb  | releases | https://github.com/MariaDB/server/releases.atom                          | 10               |
| redis    | security | GitHub advisories `redis/redis`                                          | 47 published     |
| redis    | releases | https://github.com/redis/redis/releases.atom                             | 10               |
| valkey   | security | GitHub advisories `valkey-io/valkey`                                     | 12 published     |
| valkey   | releases | https://github.com/valkey-io/valkey/releases.atom                        | 10               |
| nginx    | security | https://nginx.org/index.rss (CVE ids in the post titles)                 | 10               |
| deno     | security | GitHub advisories `denoland/deno`                                        | 40 published     |
| deno     | releases | https://github.com/denoland/deno/releases.atom                           | 10               |
| bun      | releases | https://github.com/oven-sh/bun/releases.atom                             | 10               |

### Runtime gaps (checked 22 Oct 2026)

| Wanted                                   | Finding                                                                                                                                                                                                               | Coverage instead                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Go security (golang-announce)            | Google Groups feeds 404 (`/g/golang-announce/feed/atom_v1_0_msgs.xml`, `rss_v2_0_msgs.xml`); `golang/go` publishes no GitHub advisories; go.dev/blog has no security posts                                            | `golang/go` tags (releases, LLM triage). Next: OSV `Go` ecosystem, `stdlib`   |
| Java (Oracle CPU, OpenJDK vuln-announce) | Oracle's `rss-otn-sec.xml` answers 403 to Briff's User-Agent (200 to a browser UA; not spoofed) and covers every Oracle product; OpenJDK `vuln-announce` is a pipermail HTML archive; `openjdk/jdk` has no advisories | none                                                                          |
| MySQL                                    | dev.mysql.com release-notes RSS and blogs.oracle.com/mysql RSS answer 403; `mysql/mysql-server` has no advisories and its tags feed titles are commit subjects                                                        | none                                                                          |
| .NET announcements                       | `dotnet/announcements` issues have no feed (`/issues.atom` 406; its releases feed is empty)                                                                                                                           | GitHub advisories of `dotnet/runtime` and `dotnet/aspnetcore`                 |
| Node.js advisories                       | `nodejs/node` publishes no GitHub advisories; the vulnerability feed has titles only                                                                                                                                  | vulnerability feed + post body from the `nodejs/nodejs.org` Markdown (below)  |
| Python advisories                        | `python/cpython` publishes no GitHub advisories; `python.org/dist/security-announce.rss` 404; the mailing list also carries pip/certifi advisories, which reach every Python org                                      | security-announce list feed                                                   |
| PostgreSQL advisories                    | `postgres/postgres` publishes no GitHub advisories; `/support/security/rss/` 404                                                                                                                                      | news.rss (pattern needs a security word in the title or a CVE id in the body) |
| Ruby, nginx, Bun advisories              | `ruby/ruby`, `nginx/nginx`, `oven-sh/bun` publish no GitHub advisories; Bun has no security channel                                                                                                                   | ruby-lang.org news, nginx.org news; Bun releases only                         |
| php.net releases feed                    | `/releases/feed.php` (`/releases.atom`) parses to 0 entries (no alternate link)                                                                                                                                       | the news feed carries every release post                                      |
| RustSec                                  | `rustsec.org/feed.xml` lists crate advisories, not the toolchain                                                                                                                                                      | crates are an OSV ecosystem; not added here                                   |
| Valkey blog, Deno blog                   | `valkey.io/blog/atom.xml` 404; `deno.com/blog/feed` is HTML (`deno.com/feed` is the blog)                                                                                                                             | GitHub advisories + releases                                                  |

## Runtime security items (deterministic, no LLM)

`src/lib/runtime-security.ts`, `src/pipeline/runtime-urgent-plan.ts` (pure) + `runtime-urgent.ts` (DB, email), `src/pipeline/runtime-fixes.ts`.

- A **runtime security item** is a new item of a `security` source with a `runtime`: every GitHub
  advisory, and a feed post whose title says security / `CVE-` / vulnerab / advisory / out-of-cycle
  or out-of-band, or whose body (first 4000 chars) has a CVE id, "security release/update/fix" or
  an out-of-cycle release. Its facts go to `Item.metadata`: CVE ids, severity (advisory field; for
  posts "critical" when the text says so), fixed versions (a release title's versions, else the
  versions in an "update/upgrade to", "fixed in", "patched in" sentence; calendar versions are
  dropped; a "Downloads and release details" list of `Node.js v22.23.4` bullets), `lineSpecific`
  (a single-release post such as "PHP 8.4.27 Released!"), `scheduledAt` (no fix yet: "scheduled
  for 21 October 2026 at 14:00 UTC", or a Node.js title's release day) and `affectedLines`
  ("The highest severity issue fixed in the 22.x release line is HIGH." → `26, 24, 22`; else
  "new versions of the 26.x, 24.x, 22.x releases lines"). Severity also reads "The highest
  severity issue fixed in this release is HIGH."
- Post bodies outside the feed (`src/sources/post-body.ts`): the Node.js vulnerability feed has no
  body. `nodejs.org/en/blog/vulnerability/<slug>` maps to
  `raw.githubusercontent.com/nodejs/nodejs.org/main/apps/site/pages/en/blog/vulnerability/<slug>.md`
  (the post's own Markdown source, not the rendered page), read through `safeFetch` for new posts
  younger than 14 days and turned into plain text. Fixtures: the real pre-announcement (commit
  98eab92) and release-day post of 21 Oct 2026 in `src/sources/__fixtures__/`.
- In-place updates of announcements (`src/sources/announcement-reconcile.ts`): Node.js turns the
  pre-announcement into the release post on release day (same URL and title; fixed versions and
  per-CVE affected lines added). Items are keyed by URL + title, so the stored item is updated:
  for feeds with a body, when the fetched body differs from `rawText`; for posts with a body URL,
  every open announcement (no fixed versions yet, younger than 14 days) is re-read on every run of
  the source, a 304 included. Text and metadata are re-extracted; id, guid and `contentHash`
  stay. The update that brings the first fixed versions stamps `metadata.fixAddedAt`.
- collect-sources writes an `ItemTriage` row `bucket = security`, `reason = runtime-security`,
  `model = rule` for those published in the last 14 days (triage never sends them to the LLM),
  then emails them in the same run: per org, pending `ItemMatch` rows (`urgentAt` null) of items
  younger than 72 hours that reach an included repo. Critical/high/unknown severity only; repos
  already on a fixed version and posts about another release line are skipped (`urgentAt` set,
  no email). One email per org and run (the urgent template), each item with what every affected
  repo runs ("garden.example runs php 8.3 (Dockerfile)."), the fixed versions or "PHP announced a
  security release for 21 Oct 2026, 14:00 UTC.", the action and the source link. `urgentAt` is set
  once a member got it; SMTP missing, `BRIFF_URGENT_EMAIL=false`, an org without members or a
  total send failure leaves it pending for the next hourly run (bounded by the 72h window). The
  loop calls the job heartbeat before every org and every send; a lost lock stops it.
- Late runtimes: a repo scanned (or given a runtime, or included) after the item arrived.
  Matching is reconciled, not triggered by events (`reconcileRuntimeMatches`,
  `src/lib/match/rematch.ts`): before every urgent pass, for every open runtime security item
  (published, or `fixAddedAt`, less than 72h ago) the included repos with a `RepoRuntime` row of
  the item's runtime are computed and the missing ones appended to `ItemMatch.repoIds` (a match
  is created when the org had none). Repos are never removed. Three queries per org (items,
  runtime rows, matches) plus one update per match that gained repos; a second run writes
  nothing. The hourly collect reconciles every org; a completed scan schedules one
  collect-sources job for its org (`{ due: true, rematchOrgId }`, dedupe key
  `collect-sources:scan:<orgId>`, `src/lib/scan/follow-up.ts`) after its final upload
  (docs/SCANNER.md), whether or not the upload reported new runtimes. Before 23 Oct 2026 the
  rematch ran only when an upload reported changed runtimes and skipped emailed matches, so four
  node repos ingested two seconds after the first Node.js email were never added.
- Delivery lock: every urgent pass (hourly or scan-triggered) runs under one Postgres advisory
  lock, because `urgentAt` is written only after SMTP delivery and two workers could otherwise
  both send a pending match. A pass that cannot take the lock sends nothing; the next hourly run
  picks the matches up. A scan-triggered pass delivers only for the scanned org.
- Follow-ups, once each per match: `ItemMatch.urgentRepoIds` holds the repos an email (or a
  handled skip) covered. Repos a later rematch adds get one "also affects" email (subject
  "urgent · also affects N more repos", body "Also affects a, b (added after the alert of ...)")
  that lists only them, while the item is younger than 72h. An announcement whose post gained
  fixed versions (`fixAddedAt` younger than 72h) gets one "fix is out" email (subject
  "urgent · fix released", "The fixed Node.js releases are out: ...", one "To do" line per repo,
  never shortened) for all of its repos; `ItemMatch.fixNotifiedAt` marks it, and is also set when
  the first email already carried the fixed versions. Repos added after that get the "also
  affects" email in the fix form: "Also affects a, b (added after ...). The fixed Node.js
  releases are out: ...", one "To do" line per repo. No extra marker: once the fixed versions are
  known every email of the match carries them, so after `fixNotifiedAt` the repos in
  `urgentRepoIds` are exactly the repos told about the fix.
- Incident fold (`src/lib/runtime-incident.ts`): the items of one runtime incident (php.net's
  advisory post, one "PHP 8.x.y Released!" post per line, the GitHub advisories) become **one
  block per incident** in an email. Items are the same incident when they share a runtime, were
  published within 72h of each other and share a CVE id (`metadata.cveIds`); a post without CVE
  ids joins by a fixed version the other item lists. The headline is the announcement that went
  from notice to fix (`scheduledAt`/`fixAddedAt` with fixed versions), else the vendor's
  multi-line advisory post, else a GitHub advisory (GHSA id order), else a release post
  (`contentHash` breaks ties). The block carries the merged CVE list, the highest severity, the
  fixed versions merged per line (highest per line; single-line posts alone make their lines the
  `affectedLines`), one "To do" line per repo whenever fixed versions are known, and a "Sources"
  line with every folded item (headline first, then posts by date, then advisories by GHSA id;
  advisories are labelled by GHSA id). A single-line post is a source only when it affects a repo
  on its own line; the others (lines nobody runs, or already on the fix) are handled without a
  word. A block with a "fix is out" item is in the fix form, one with any new item is new, else it
  is an "also affects" follow-up.
- No silent drops: a matched, included repo without an action is named. Every row on a fixed
  version or on a **supported** line the incident does not list: "Not affected:
  sigma/forms-web (24.22.1 in Dockerfile)."; an end-of-life line always gets the EOL
  sentence and a line newer than the EOL table the "check which version runs" action, also under
  a single-line release post, so "Not affected" is never said of them; no row of the runtime any more: "To do: x: no Node.js version on record; check
  which version runs". An unresolved row reads "office-ledger runs node, version unknown
  (Dockerfile: ${NODE_VERSION})." and "office-ledger: node version unknown (the Dockerfile tag uses
  a build argument: ${NODE_VERSION}); check which version runs; fixed in ...". Repos outside every
  stream are never mentioned.
- Actions (`runtimeAction`): a floating image tag gets "rebuild to pick up PHP 8.3.36; the
  php:8.3-fpm tag already points to it", a pinned tag the tag to move to
  (`php:8.3.36-fpm-alpine`; the image is the scanned repository, `RepoRuntime.image`, so .NET
  reads `mcr.microsoft.com/dotnet/aspnet:8.0.22`, with the Docker Hub name as fallback for older
  rows), a version file "set php 8.4.27 in .tool-versions", a constraint
  "run php 8.2.35 or later (composer.json require.php allows ^8.2)"; an open lower bound
  (`engines.node >=20.9.0`) allows newer lines and gets the lowest fixed version at or above it
  ("run node 22.23.4 or later"). A supported line older than every fixed line gets the nearest fix
  on the same major or "plan the move to a supported release line"; never a major upgrade. A
  line the item does not list (`affectedLines`, or no fix on it) is unaffected while supported;
  newer than every line the EOL table knows, it cannot be placed and stays affected ("check
  which Node.js version runs"); a line missing from the table below its newest entry is history
  (node 17, php 7.3); past end of life (`src/lib/runtime-eol.ts`, static table from
  endoflife.date) it gets
  "node 18 is end-of-life and will not get this fix; move to 22.23.4 or later" (before the
  release, or when the item has no fix on that line: "move to 22 or later"). The target is
  always the lowest line still supported on the day, never the line a post names (a node
  26-only post does not send a node 18 repo to 26). That sentence is the one place a newer major is named: an EOL
  line has no fix of its own, so it names the lowest supported line and is worded as a
  migration, never as a command (AGENTS.md).
- Weekly bulletin: an affected runtime security item is must-act with that action; several of
  the same runtime in a week keep one act item, headed by the same item the urgent email uses
  (`incidentPrimary`), its action over the merged incident facts (`mergeIncidentMeta`), and the
  others fold under it as related. The subject names the runtime ("W44: PHP").
- Edited advisories (`src/sources/advisory-reconcile.ts`): GitHub advisory items are keyed by
  their GHSA id, not URL + title. When `updated_at`, the fixed versions, the severity or the
  title/URL change, the stored item is updated in place (metadata, text, content hash); no second
  item. An edit never re-sends an email, except when the severity rises from medium/low (handled
  without an email) to critical, high or unknown: those matches go back to pending.

## No official feed (not scraped)

| Wanted                                            | Finding                                                                                                                                               | Coverage instead                                                                                         |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Anthropic news (`anthropic.com/news`)             | No RSS/Atom; `/news/rss.xml`, `/rss.xml`, `/news/feed` all 404 and the page advertises no feed. Third-party scraper feeds exist but are not official. | Claude Platform release notes feed (models, pricing, API changes)                                        |
| RevenueCat changelog (`revenuecat.com/changelog`) | No feed advertised; common feed paths 404.                                                                                                            | RevenueCat blog feed + GitHub releases of `react-native-purchases` (via `github_releases`)               |
| Google Play policy updates                        | Play Console Help "policy announcements" and the Developer Policy Center publish no RSS/Atom.                                                         | Android Developers Blog (policy and target-API posts land there); revisit when deadline extraction lands |
| Expo SDK changelog                                | Covered: `expo.dev/changelog/rss.xml`                                                                                                                 | —                                                                                                        |

## Matching (deterministic, `src/lib/match/matcher.ts`)

| Signal                                                                               | Score                                  |
| ------------------------------------------------------------------------------------ | -------------------------------------- |
| Release feed of a direct dependency                                                  | 1.0                                    |
| Release feed of a transitive dependency                                              | 0.6                                    |
| Feed of a service the org uses directly                                              | 0.7                                    |
| Distinctive direct package (`@scope/x`, `x-y`) or service name mentioned in the item | 0.5 (or +0.1 on top of another signal) |
| Platform feed matching an org trait, or an `always` feed                             | 0.4                                    |

A monorepo release feed (`payloadcms/payload`) is shared by every package it publishes: its
match carries the repos of all of them, and the reason names one package (a direct one, then
the one named like the feed's repo, then the one most repos install).

Release feeds work the same for every ecosystem: `refresh-packages` sets
`Package.releaseFeedUrl` from the repository its registry names (npm `repository`, Packagist
`source.url`), and one `github_releases` source is created per feed. The org's stack is keyed
by (ecosystem, name) (`stackPackageKey`: npm keeps the bare name, others are
`Packagist:vendor/pkg`, `PyPI:name`, `Go:module`), so a feed maps to the package of the right ecosystem and
its `ItemMatch.packageId`, and an npm and a PyPI package of the same name never share an entry.
PyPI's repository link is the GitHub URL among `project_urls`; a Go module's is the proxy's
origin or the module path (`github.com/acme/kit/v2` → `acme/kit`), and when a feed is shared
the module named like the feed's repo leads with its `/vN` suffix ignored. The weekly
bulletin's alert fixes are looked up by name but kept per ecosystem: a security item uses only
the fixes of its matched package's ecosystem, and an item that names a package two ecosystems
share without a match to it gets no derived command.

Matches are stored per org with the repo ids that pulled the item in; repo
inclusion (in any stream) is applied at triage time (items reached only through
excluded repos wait) and the stream's repos again when each bulletin is built, so
changing stream membership needs no re-match.

## Triage (Haiku, `src/pipeline/triage.ts`, prompt `src/llm/prompts/triage.md`)

Only matched items reach the LLM, each once, and only if published in the last
14 days. Pre-release titles (`-canary`, `-beta`, `-alpha`, `-rc`, `-next`,
`-nightly`, `-dev`, `src/pipeline/versions.ts`) never reach the model: they get a
`minor` row with reason `pre-release` and model `rule`. Titles with a bare 40-hex commit
sha (monorepo CI tags such as `baml-language-source-<sha>: ...`) get the same treatment
with reason `sha-tag`; the bulletin drops both even when an older row triaged them otherwise. Buckets: `security`,
`breaking_or_feature`, `model_or_pricing`, `deadline` (date must be in the text;
otherwise demoted), `minor` (counted in the bulletin, never listed). Only
`security` is emailed right away (`BRIFF_URGENT_EMAIL`); `model_or_pricing` waits
for the weekly bulletin. Busy release feeds (Claude Code) mostly land in `minor`,
which is the point.

## Weekly bulletin (`src/pipeline/bulletin.ts`, prompt `synthesis.md`)

Before synthesis, releases of the same package in the window are folded into one
candidate (newest version is the item, older ones are listed in its text and kept
as `BulletinItem.foldedItemIds`, the most severe bucket wins). "Same package" is
the `release:<pkg>` match reason, or the feed itself for `changelog_md` /
`github_releases` sources (Claude Code). The bulletin is a capped to-do list:
`act` ("Needs your attention", at most 5, each with an `action`: security items
whose package has an alert this period, deadlines due within 14 days, anything the
model says needs doing soon), `know` ("Good to know", at most 5, each with a
what-to-do: Upgrade / Read / Wait / Skip) and `rest` ("Also this week", stored and
listed on the web page; the email only counts it together with the minor items).

One bulletin is written per stream (`BulletinStream`, a named set of repos, e.g.
work and personal). Matching stays org-wide; the stream is applied at bulletin
time: an item whose `ItemMatch.repoIds` has no repo of the stream is left out, a
platform-wide item (`trait:ios`, no repo ids) only reaches streams whose repos use
a service with that trait, and `trait:always` feeds (Claude Platform, Claude Code,
Dokploy) reach every stream. Security alerts and urgent emails stay org-wide, over
every repo that is in any stream (`Repo.included`).

## Known gaps

- Sources for repos that were deleted on GitHub keep returning 404; they are
  recorded on `Source.lastError` and retried each run.
- Package EOL data (`Package.eolDate/eolInfo`) is not populated yet (Phase 2 stack page).

RubyGems metadata uses the fixed rubygems.org JSON API: `gems/<gem>.json` supplies
repository links and `versions/<gem>/latest.json` supplies the latest non-yanked release.
There is no package deprecation field. RubyGems advisories use OSV ecosystem `RubyGems`;
GitHub source links attach the existing GitHub releases feed.
