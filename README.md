# Briff

Briff watches the packages and runtimes your repositories actually use and tells you what
changed for them. Once a week it sends one email: the releases, deprecations, deadlines and
security fixes that touch your stack, each with the repos it affects and what to run. When a
security advisory hits an installed version, it emails the same day. It learns your stack from
lockfiles and runtime files only; it never reads source code.

Briff is a Next.js app and a worker on Postgres. You can run it yourself (below) or use the
hosted instance at [app.briff.dev](https://app.briff.dev). Sign-ups are open: each new
organisation defaults to 10 repos and 2 streams, including the default stream.

## What you get

- **Weekly bulletin** (Monday 04:00 UTC, per stream): items sorted into _act_, _know_ and the
  rest. Every act item names the affected repos, the version each one runs and the version
  to move to. Fix commands never cross the installed major; an end-of-life line gets a
  migration sentence instead.
- **Same-day security alerts**: OSV advisories for installed versions (daily scan, critical
  and high emailed at once) and runtime security releases (Node.js, PHP, Python, ... checked
  hourly), with a follow-up when the fix is published or a newly scanned repo turns out to be
  affected.
- **Runtime and end-of-life view**: what every repo runs (Dockerfile `FROM`, compose images,
  `.nvmrc`, `engines`, `go.mod`, ...) against the end-of-life table and the newest release.
- **Streams**: named repo sets with their own bulletin, e.g. one per client or team.

Sources are official feeds only (release feeds, vendor blogs, security advisories, OSV); no
HTML scraping. The list and the matching rules are in [docs/SOURCES.md](docs/SOURCES.md).

## What Briff reads

- **Packages:** npm/pnpm/yarn; Composer; PyPI (Poetry, uv, Pipfile and requirements);
  Go modules; RubyGems/Bundler; crates.io/Cargo; Maven (`pom.xml`, Gradle lockfiles and
  version catalogs); NuGet; pub (Dart/Flutter); SwiftPM; Hex (Elixir). Package pins feed
  OSV checks, registry metadata and ecosystem-specific fix advice on the installed line.
- **GitHub Actions:** literal workflow `uses:` references, with tag/SHA pinning advice.
  Local actions, Docker references and expressions are skipped.
- **Runtimes:** Node.js, PHP, Python, Go, Ruby, Java, .NET, Rust, PostgreSQL, MySQL,
  MariaDB, Redis, Valkey, nginx, Deno and Bun, from version files, manifests and images.
  Support dates refresh daily from endoflife.date, including Debian, Ubuntu and Alpine,
  with “EOL in N days” facts. Rust and Valkey have no lifecycle catalog entry.
- **Docker base images:** candidate Debian, Ubuntu and Alpine OS advisories for a short
  base-package list (including OpenSSL, zlib, libc and curl), with rebuild or migration
  advice. Briff cannot see the installed package list or patch versions inside an image;
  these are candidates, not confirmed vulnerabilities, and do not cover packages added
  by Dockerfile commands.
- **Curated news:** ecosystem feeds are scoped to streams whose repos use the matching
  ecosystem or runtime. See [docs/SOURCES.md](docs/SOURCES.md) for the feeds and rules.

The exact file paths come from `packages/scan/src/files.ts` and `discover.ts`;
[docs/GITHUB-APP.md](docs/GITHUB-APP.md) lists them for readers.

## What Briff would have sent

- [PHP2Shell, October 2026](docs/replay/php2shell.html): an urgent email 28 minutes after
  php.net's advance notice, the fix email (one PHP block, one action per repo, five sources)
  26 minutes after the advisories, and the weekly act item.
- [Node.js security releases, October 2026](docs/replay/node-oct-2026.html): the
  announcement, then the "fix released" follow-up with one action per repo.

Each page is a replay: the real dated items from the sources, a few sample repos, and
Briff's own pipeline run hour by hour with a fake clock (no database, no SMTP, no LLM).
The left column is what happened in the world, with sources; the right column is each email
rendered by the production template, with its send time and the delay from the item that
triggered it. Every incident becomes a replay case in `src/replay/replay.test.ts`.
Regenerate with `npm run replay -- php2shell --out docs/replay/php2shell.html`.

## How Briff reads your repos

Three ways, all built on the same parser code ([`packages/scan`](packages/scan), MIT):

| Way                      | Setup                                                        | Docs                                     |
| ------------------------ | ------------------------------------------------------------ | ---------------------------------------- |
| GitHub App               | "Connect GitHub" in the app; contents and metadata read-only | [docs/GITHUB-APP.md](docs/GITHUB-APP.md) |
| GitHub Action            | a scan token as a repo secret and a 20-line workflow         | [docs/SCANNER.md](docs/SCANNER.md)       |
| CLI (`npx briff-scan@0`) | a scan token; one repo or every repo under a folder          | [docs/SCANNER.md](docs/SCANNER.md)       |

What is sent is `{package, installed version, direct}` and `{runtime, version, file}` per
repo, plus the repo name. Run `npx briff-scan@0 --dry-run --json` to see the exact payload.
The GitHub App fetches only the lockfile, manifest and runtime file paths listed in
docs/GITHUB-APP.md and does not store their contents.

Every outbound connection the server makes and what it carries is listed in
[docs/PRIVACY.md](docs/PRIVACY.md). Repo names reach the language model only as per-request
aliases (`repo-1`, `repo-2`, ...).

## Self-hosting

Briff is one Docker image run twice, next to Postgres 16:

| Role   | Command                              | Notes                                                                              |
| ------ | ------------------------------------ | ---------------------------------------------------------------------------------- |
| web    | `node server.js` (the image default) | port 3000; applies database migrations on start (`MIGRATE_ON_START=false` to skip) |
| worker | `node dist/worker.mjs`               | job queue in Postgres, UTC schedule; no port                                       |

Releases publish the image as `ghcr.io/metelabs/briff` (`latest`, `<version>`,
`sha-<commit>`), or build it from this repository with `docker build .`; the build needs no
secrets and no env. All configuration is runtime environment, set on both roles;
[.env.example](.env.example) documents every variable. The minimum:

| Variable                                                         | What                                                                 |
| ---------------------------------------------------------------- | -------------------------------------------------------------------- |
| `DATABASE_URL`                                                   | Postgres 16 connection string                                        |
| `BETTER_AUTH_SECRET`                                             | session signing secret, 32+ chars (`openssl rand -base64 48`)        |
| `BETTER_AUTH_URL`                                                | the public origin of the web app                                     |
| `ANTHROPIC_API_KEY`                                              | triage and the weekly synthesis; without it only security alerts run |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `FROM_EMAIL` | any SMTP relay; without them nothing is emailed                      |

A minimal compose file:

```yaml
services:
  db:
    image: postgres:16-alpine
    environment: { POSTGRES_USER: briff, POSTGRES_PASSWORD: change-me, POSTGRES_DB: briff }
    volumes: [briff-db:/var/lib/postgresql/data]
  web:
    image: ghcr.io/metelabs/briff:latest
    env_file: .env
    ports: ["3000:3000"]
    depends_on: [db]
  worker:
    image: ghcr.io/metelabs/briff:latest
    command: ["node", "dist/worker.mjs"]
    env_file: .env
    depends_on: [db]
volumes:
  briff-db:
```

with `DATABASE_URL=postgresql://briff:change-me@db:5432/briff` in `.env`. Put a TLS-terminating
proxy in front of port 3000. `GET /api/health` reports the database state and which optional
features are disabled by missing variables. Both roles have a container healthcheck.

The first account created on an instance owns it and is its admin. Sign-ups are open by default
(`ALLOW_SIGNUP=true`); set `ALLOW_SIGNUP=false` to close registration after the first account.
Each new account gets its own organisation with 10 repositories and 2 streams (including
the default stream). Self-hosted instances use the same defaults; the instance Admin page can raise these limits
to fit your own capacity. There is no separate self-hosted tier. There is no invite
system. Point scanners at your instance with `BRIFF_API_URL`, and create your own
GitHub App if you want "Connect GitHub" ([docs/GITHUB-APP.md](docs/GITHUB-APP.md)).

Operator notes for the hosted instance at app.briff.dev (its servers, deploy hooks and
credentials) are kept outside this repository; everything a self-hosted instance needs is here.

## Development

Node 22, npm, Docker for Postgres.

```bash
docker compose up -d                  # Postgres 16 on 127.0.0.1:55432
cp .env.example .env                  # set BETTER_AUTH_SECRET; DATABASE_URL is preset
npm ci                                # also runs prisma generate
npm run db:migrate                    # prisma migrate dev
npm run dev                           # web on :3000; the first sign-up at /login owns the instance
npm run dev:worker                    # worker with watch
```

Without an Anthropic key, set `BRIFF_LLM_FAKE=true` in `.env` for a deterministic stand-in.
Checks before a pull request: `npm run typecheck && npm run lint && npm test`; DB-backed tests
run when `TEST_DATABASE_URL` points at a disposable, migrated database. Contribution rules are
in [CONTRIBUTING.md](CONTRIBUTING.md); architecture and code conventions in
[CLAUDE.md](CLAUDE.md) (written for people and coding agents alike). Release notes:
[CHANGELOG.md](CHANGELOG.md). Security reports: [SECURITY.md](SECURITY.md).

## License

Copyright (C) 2026 Fikret Yunus Yildiz.

- **Briff** (this repository: web app, worker, pipeline) is licensed under the
  [GNU Affero General Public License v3.0 only](LICENSE) (`AGPL-3.0-only`). You may run,
  study, change and share it; if you run a modified version as a network service, you must
  offer its users the source of that version.
- **The scanner** ([`packages/scan`](packages/scan), the `briff-scan` npm package) is
  [MIT](packages/scan/LICENSE), so it can run in anyone's CI or on any machine, inside any
  project, without license obligations beyond keeping the notice. It only reads lockfiles
  and runtime files and uploads package names, versions and runtimes.
