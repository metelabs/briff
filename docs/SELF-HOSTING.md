# Self-hosting Briff

Briff is one Docker image (`ghcr.io/metelabs/briff`) run twice, web and worker, next to
Postgres 16. [`compose.yaml`](../compose.yaml) runs all three; nothing is built on your host.

| Service    | Command                              | What it does                                                          |
| ---------- | ------------------------------------ | --------------------------------------------------------------------- |
| `web`      | `node server.js` (the image default) | UI, `/api/*`; applies pending database migrations on start, port 3000 |
| `worker`   | `node dist/worker.mjs`               | job queue in Postgres, UTC schedule, LLM calls, email; no port        |
| `postgres` | `postgres:16-alpine`                 | all data, in the named volume `<project>_briff-postgres`              |

## Requirements

- A Linux server with **2 vCPU and 4 GB RAM** and about 10 GB free disk (images, Postgres,
  logs).
- **Docker 24+** with the Compose v2 plugin (`docker compose version`).
- **A domain** (e.g. `briff.example.com`) pointing at the server, and a reverse proxy for TLS
  (Caddy below). The GitHub App and email links need a public HTTPS origin; for a local trial
  plain `http://127.0.0.1:<port>` works (see [Trial on an existing Docker host](#trial-on-an-existing-docker-host)).
- Optional: an SMTP relay, an Anthropic API key, a GitHub App (see
  [What works without the optional parts](#what-works-without-the-optional-parts)).

## Install (about 10 minutes)

```bash
sudo mkdir -p /opt/briff && sudo chown "$USER" /opt/briff && cd /opt/briff
curl -fsSLO https://raw.githubusercontent.com/metelabs/briff/main/compose.yaml
curl -fsSL -o .env https://raw.githubusercontent.com/metelabs/briff/main/.env.selfhost.example
chmod 600 .env
```

Edit `.env` (every variable is documented in it). The required ones:

```bash
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" .env
sed -i "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=$(openssl rand -base64 48 | tr -d '\n')|" .env
sed -i "s|^BETTER_AUTH_URL=.*|BETTER_AUTH_URL=https://briff.example.com|" .env   # your origin
sed -i "s|^BRIFF_VERSION=.*|BRIFF_VERSION=0.8.0|" .env   # a release from the GitHub releases page
```

Start it:

```bash
docker compose pull
docker compose up -d
docker compose ps          # all three "healthy" after about a minute
curl -s http://127.0.0.1:3000/api/health
```

You should see `{"ok":true,"db":"ok",...}`. `warnings` lists the optional features that are
off because their variables are empty. Then set up the [reverse proxy](#reverse-proxy-caddy),
open `https://briff.example.com/signup` and create your account.

`docker compose up -d` waits for Postgres to be healthy, starts `web` (which applies the
migrations), and starts `worker` only once `web` is healthy, so the worker never runs against
an old schema.

## First account = instance admin

The instance admin is the **oldest account** (`isInstanceAdmin` in `src/lib/auth/session.ts`:
the user with the earliest `createdAt`). There is no admin flag or role to set; create your
own account right after the first start, before you share the URL.

- Every account gets its own organisation. A self-hosted instance has no plans and no
  limits: repos, streams and members are unlimited as long as `BRIFF_CLOUD` stays `false`
  (the default; `true` is only for the hosted service at app.briff.dev, where it turns on
  plans, `/pricing` and Settings → Billing; the `PADDLE_*` billing variables are for the hosted
  service too and never needed here). The admin's **Admin** page (`/admin`) shows
  instance totals and every organisation's usage and can send a test email; **Admin → Runs** (`/admin/runs`) queues jobs by hand (`collect-sources`,
  `security-scan`, `weekly-bulletin`, ...).
- Sign-up is open by default. To close it after your account exists, set
  `ALLOW_SIGNUP=false` in `.env` and run `docker compose up -d`. The first account can always
  be created, even with `ALLOW_SIGNUP=false`, and so can an account opened from an invite
  link (see below).
- Sign-ups are limited to 5 per hour per client IP, read from the `X-Real-IP` header (the
  Caddy example sets it).

### Inviting teammates

An owner invites people from **Settings → Members**: email and role (member or owner). The
invite email links to `/invite/<token>`; the link works once, for 7 days, and only for an
account with that address (sign in, or create the account from the link, also on a closed
instance). Members use repos, streams, alerts and bulletins and get every bulletin and alert
email; owners also invite, change roles, remove members and rename or delete the organisation.
The last owner cannot leave or be demoted. Without SMTP the invite is not emailed: Settings
shows the link so you can pass it on yourself. An organisation can send 20 invites a day. One
account can belong to several organisations and switches between them in the account menu
(where **Create organisation** starts a new one).

## What works without the optional parts

Missing integrations disable a feature; they never stop the app. `GET /api/health` lists
what is off under `warnings`.

| Missing                                                               | What still works                                                                                                       | What is missing                                                                                       |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| SMTP (`SMTP_HOST`, `_PORT`, `_USER`, `_PASS`, `FROM_EMAIL`, all five) | Everything in the web app: scans, Alerts, Stack, bulletins on `/bulletins`                                             | No email at all: the weekly bulletin, same-day security alerts and urgent runtime emails are not sent |
| `ANTHROPIC_API_KEY`                                                   | Scans, security alerts from OSV (Alerts page and same-day email), urgent runtime security emails (no LLM), Stack drift | No triage of feed items and **no weekly bulletin** (the worker logs `LLM unavailable, skipping`)      |
| GitHub App (all six `GITHUB_APP_*`)                                   | Scans through the GitHub Action and the CLI with scan tokens                                                           | No "Connect GitHub" button; no scan on push                                                           |
| `GITHUB_TOKEN`                                                        | Everything                                                                                                             | GitHub release feeds and security-advisory calls are limited to 60 requests per hour                  |

> **Note**
> `BRIFF_LLM_FAKE` is refused in production; it is for development only.

## Connecting repos

Repos reach Briff in three ways. All of them upload only package names, installed versions
and runtimes (no source code). New repos arrive as "New" on `/repos` and stay out of the
bulletin until you add them to a stream on `/streams`.

1. **GitHub App** ("Connect GitHub" in onboarding and the Connect repos sheet; shown only when
   the app is configured): every instance needs its own
   app, because its webhook and callback URLs point at your origin. Runbook:
   [docs/GITHUB-APP.md](GITHUB-APP.md) ("Runbook: create the app"); put the six values into
   `.env` and run `docker compose up -d`.
2. **GitHub Action**: create a token in **Settings → Scan tokens → New token**, store it as the
   repo secret `BRIFF_TOKEN`, and commit the workflow from [docs/SCANNER.md](SCANNER.md)
   ("GitHub Action") with `BRIFF_API_URL: https://briff.example.com`.
3. **CLI** on any machine with Node 20+:
   ```bash
   BRIFF_API_URL=https://briff.example.com BRIFF_TOKEN=brf_... npx briff-scan@0
   npx briff-scan@0 --dry-run --json      # see the exact payload first
   ```
   Options and the daily systemd timer: [docs/SCANNER.md](SCANNER.md).

## Reverse proxy (Caddy)

Keep `BRIFF_BIND=127.0.0.1` (the default) so port 3000 is only reachable through the proxy.
`/etc/caddy/Caddyfile`:

```caddy
briff.example.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3000 {
		# Briff reads the client IP from X-Real-IP (sign-up rate limit).
		header_up X-Real-IP {remote_host}
	}
}
```

`sudo systemctl reload caddy`; Caddy gets the TLS certificate itself. With another proxy
(nginx, Traefik), forward to `127.0.0.1:3000`, pass the `Host` header and set `X-Real-IP` to the
client address. `BETTER_AUTH_URL` must equal the origin the browser uses.

## Updating

```bash
cd /opt/briff
sed -i "s|^BRIFF_VERSION=.*|BRIFF_VERSION=<new version>|" .env   # skip when you run latest
docker compose pull
docker compose up -d
```

Migrations run automatically when `web` starts; `worker` restarts on the same tag after `web`
is healthy. Read the release notes and [docs/UPGRADING.md](UPGRADING.md) before you move to a
new version, and take a [backup](#backup-and-restore) first.

## Backup and restore

Everything lives in Postgres. Back up (safe while running):

```bash
cd /opt/briff
docker compose exec -T postgres pg_dump -U briff -d briff --clean --if-exists > "briff-$(date +%F).sql"
```

Restore into the same or a new install (same or newer Briff version):

```bash
cd /opt/briff
docker compose stop web worker
docker compose exec -T postgres psql -U briff -d briff -v ON_ERROR_STOP=1 < briff-2026-11-01.sql
docker compose start web worker
```

> **Warning**
> Keep `.env` with the backup: `BETTER_AUTH_SECRET` signs sessions and the links in emails
> (feedback links stop working with a new one).

Copy dumps off the server, e.g. a nightly cron
line `0 2 * * * cd /opt/briff && docker compose exec -T postgres pg_dump -U briff -d briff --clean --if-exists | gzip > /var/backups/briff-$(date +\%F).sql.gz`.

## Health and logs

- `GET /api/health` (no auth): `ok`, `db`, whether every scheduled job ran on time
  (`freshness`, `stale`), the oldest due job (`queue.oldestPendingSeconds`), the last run of
  every job type (`lastRuns`, with `error` when it failed), pending and failed job counts, and
  `warnings`. HTTP 503 when the database is unreachable, a scheduled job is overdue or a due job
  has waited over an hour; point an uptime monitor at it. The `web` container healthcheck calls
  `/api/health?probe=live` (database only), so an overdue job never restarts the web container;
  the `worker` healthcheck checks a heartbeat file the worker refreshes every 30 s, also during
  long jobs (unhealthy after 180 s). The full body, job failure alerts (`OPS_ALERT_EMAIL`,
  `ALERT_WEBHOOK_URL`), Admin → Runs and optional Sentry: [OPERATIONS.md](OPERATIONS.md).
- Logs are JSON lines (secrets redacted), kept by Docker (10 MB × 5 per container):
  ```bash
  docker compose logs -f web worker
  docker compose logs --since 1h worker | grep '"level":"error"'   # errors only
  ```
  Warnings and errors go to stderr, the rest to stdout. `LOG_LEVEL=debug` in `.env` for more.

## Trial on an existing Docker host

To try Briff next to other containers, without a domain: pick a free port and a project name,
so containers, network and volume do not collide with anything else on the host.

```bash
mkdir -p /opt/briff-trial && cd /opt/briff-trial
curl -fsSLO https://raw.githubusercontent.com/metelabs/briff/main/compose.yaml
curl -fsSL -o .env https://raw.githubusercontent.com/metelabs/briff/main/.env.selfhost.example
chmod 600 .env
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" .env
sed -i "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=$(openssl rand -base64 48 | tr -d '\n')|" .env
sed -i "s|^BRIFF_WEB_PORT=.*|BRIFF_WEB_PORT=3042|" .env
sed -i "s|^BETTER_AUTH_URL=.*|BETTER_AUTH_URL=http://127.0.0.1:3042|" .env
sed -i "s|^COMPOSE_PROJECT_NAME=.*|COMPOSE_PROJECT_NAME=briff-trial|" .env
docker compose pull && docker compose up -d
curl -s http://127.0.0.1:3042/api/health
```

Reach the UI through an SSH tunnel (`ssh -L 3042:127.0.0.1:3042 <host>`, then
`http://127.0.0.1:3042/login` in your browser). Remove everything, data included:
`docker compose down -v`.

`scripts/smoke.sh` automates the same check end to end (start, health, sign-up, scan token,
`briff-scan` upload) in its own throw-away project; see the header of the script for its
options (`SMOKE_PORT`, `SMOKE_PROJECT`, `BRIFF_IMAGE`, `BRIFF_VERSION`). Each run uses a new
project name (`briff-smoke-<random>`) and refuses an existing one, so its cleanup never removes
another stack's data.

## Troubleshooting

| Symptom                                                       | Cause and fix                                                                                                                                                                                                                                   |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker compose` says `set POSTGRES_PASSWORD in .env`         | `.env` is missing or the value is empty. Run compose from the folder that holds `compose.yaml` and `.env`.                                                                                                                                      |
| `web` restarts; log shows `Invalid environment configuration` | A required variable is empty or invalid: `BETTER_AUTH_SECRET` (32+ chars), `BETTER_AUTH_URL` (a full URL), `ALLOW_SIGNUP` (`true`/`false`), `FROM_EMAIL` (an address or empty). The log line names it.                                          |
| `web` log: `password authentication failed for user "briff"`  | `POSTGRES_PASSWORD` changed after the first start; Postgres keeps the password it was initialised with. Put the old one back, or change it in the database (`docker compose exec postgres psql -U briff -c "ALTER USER briff PASSWORD '...'"`). |
| Sign-in or sign-up fails with `Invalid origin` (HTTP 403)     | `BETTER_AUTH_URL` is not the origin in the browser's address bar (scheme, host and port). Fix it in `.env`, `docker compose up -d`.                                                                                                             |
| `Too many sign-up attempts. Try again in one hour.`           | 5 sign-ups per IP per hour. Behind a proxy that does not set `X-Real-IP`, every visitor shares one bucket; add the header (Caddy example).                                                                                                      |
| `Sign-up is disabled.`                                        | `ALLOW_SIGNUP=false` and an account exists.                                                                                                                                                                                                     |
| `Bind for 127.0.0.1:3000 failed: port is already allocated`   | Another service uses the port. Set `BRIFF_WEB_PORT` (and the port in `BETTER_AUTH_URL` and the proxy).                                                                                                                                          |
| `pull access denied` / `manifest unknown`                     | The tag in `BRIFF_VERSION` does not exist. Tags are versions without `v` (`0.7.3`), see the releases page.                                                                                                                                      |
| `worker` stays `unhealthy`                                    | `docker compose logs worker`: usually the same env error as above, or the database is unreachable. The worker waits for `web`; if `web` is unhealthy, fix that first.                                                                           |
| No email arrives                                              | `/api/health` `warnings` says `email delivery disabled: missing ...`; fill all five SMTP variables. A `535` in the worker log is a wrong SMTP password. Admin → Send test email checks the setup.                                               |
| No weekly bulletin on Monday                                  | `ANTHROPIC_API_KEY` is empty (`LLM unavailable` in the worker log), or no repo is in a stream. Admin can queue `weekly-bulletin` by hand.                                                                                                       |
| Scanner: `HTTP 401`                                           | Wrong or revoked token, or `BRIFF_API_URL` points at another instance. Create a new token in Settings → Scan tokens.                                                                                                                            |
| Scanner: `HTTP 409` with `REPO_LIMIT`                         | Only with `BRIFF_CLOUD=true`, which a self-hosted instance should not set: the organisation reached its plan's repository limit. Set `BRIFF_CLOUD=false` (or remove the line) and run `docker compose up -d`.                                   |
