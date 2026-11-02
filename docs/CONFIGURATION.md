# Configuration

Briff is configured only through environment variables, read at runtime by `web` and `worker`;
nothing is baked into the image and there are no `NEXT_PUBLIC_*` variables. With
[`compose.yaml`](../compose.yaml) they live in `.env` next to it (start from
[`.env.selfhost.example`](../.env.selfhost.example)); on another platform set them on both
services ([`.env.example`](../.env.example) documents the same set). After a change, run
`docker compose up -d`.

Empty means unset. A value that fails validation stops the app with
`Invalid environment configuration` and the variable's name in the log. A missing optional
integration only turns its feature off, and `GET /api/health` lists it under `warnings`.

## Required

| Variable             | What it is                                                                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`  | Compose only: the password of the bundled `postgres` service. `compose.yaml` builds `DATABASE_URL` from it, so use URL-safe characters (`openssl rand -hex 24`). |
| `DATABASE_URL`       | Postgres connection string. Set by `compose.yaml`, which overrides any value in `.env`; set it yourself on other platforms.                                      |
| `BETTER_AUTH_SECRET` | Signs sessions and the links in emails; at least 32 characters (`openssl rand -base64 48`). Keep it with your backups: a new one breaks every link already sent. |
| `BETTER_AUTH_URL`    | The public origin, exactly as the browser shows it (scheme, host, and the port unless 443 or 80). Sign-in fails with `Invalid origin` when it differs.           |

## Access

| Variable       | Default | What it does                                                                                                                                                       |
| -------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ALLOW_SIGNUP` | `true`  | `false` closes registration. The first account (the instance admin) and accounts opened from an invite link can always be created.                                 |
| `BRIFF_CLOUD`  | `false` | Hosted service only. `true` turns on plans, limits, `/pricing` and Settings → Billing. Keep it `false` on your own instance: every organisation is then unlimited. |

## Email

All five SMTP values or nothing: without them no email is sent (bulletins, security alerts,
invites, password resets), and everything stays visible in the web app.

| Variable             | Default | What it does                                                                                                                            |
| -------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `SMTP_HOST`          |         | Any SMTP relay.                                                                                                                         |
| `SMTP_PORT`          |         | Port 465 uses TLS, any other port STARTTLS. The example files use 587.                                                                  |
| `SMTP_USER`          |         | Relay user name.                                                                                                                        |
| `SMTP_PASS`          |         | Relay password or API key. A `535` in the worker log means it is wrong.                                                                 |
| `FROM_EMAIL`         |         | Sender address; its domain must be verified at the relay.                                                                               |
| `BRIFF_URGENT_EMAIL` | `true`  | Email security items right after triage and runtime security items right after collection. `false` leaves them for the weekly bulletin. |

Admin → Send test email checks the setup.

## Language model

| Variable                | Default             | What it does                                                                                                                                              |
| ----------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`     |                     | Triage of feed items and the weekly synthesis. Without it there is no triage and no weekly bulletin; security alerts and urgent runtime emails still run. |
| `BRIFF_MODEL_TRIAGE`    | `claude-haiku-5-5`  | Model for triage.                                                                                                                                         |
| `BRIFF_MODEL_SYNTHESIS` | `claude-sonnet-5-5` | Model for the weekly bulletin.                                                                                                                            |
| `BRIFF_LLM_BATCH`       | `true`              | Send triage and synthesis through the Message Batches API (half the token price, results within minutes). `false` makes one direct call per request.      |

What reaches the model, and what never does: [What leaves your server](PRIVACY.md#outbound-connections).

## GitHub

| Variable                    | What it does                                                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GITHUB_APP_ID`             | The GitHub App's id. The six `GITHUB_APP_*` values are all needed, on `web` and `worker`, or none.                                                       |
| `GITHUB_APP_SLUG`           | The app's URL slug (`https://github.com/apps/<slug>`).                                                                                                   |
| `GITHUB_APP_PRIVATE_KEY`    | The app's private key: `base64 -w0 key.pem`, or the PEM with `\n` for newlines.                                                                          |
| `GITHUB_APP_WEBHOOK_SECRET` | Verifies the app's webhook deliveries.                                                                                                                   |
| `GITHUB_APP_CLIENT_ID`      | The app's OAuth client: proves the installing user can access the installation.                                                                          |
| `GITHUB_APP_CLIENT_SECRET`  | Secret of that OAuth client.                                                                                                                             |
| `GITHUB_TOKEN`              | Optional fine-grained token (public repositories, read-only). Raises the limit for release feeds and security-advisory calls above 60 requests per hour. |

How to create the app: [GitHub App setup](GITHUB-APP.md#runbook-create-the-app).

## Operations

| Variable               | Default   | What it does                                                                                                                             |
| ---------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `MIGRATE_ON_START`     | `true`    | `web` applies pending database migrations on start; `false` skips it (run `prisma migrate deploy` yourself). The worker never migrates.  |
| `LOG_LEVEL`            |           | `debug`, `info`, `warn` or `error`. Unset: `info` in production, `debug` otherwise.                                                      |
| `OPS_ALERT_EMAIL`      |           | Comma-separated recipients of job failure and overdue alerts. Unset: the instance admin.                                                 |
| `ALERT_WEBHOOK_URL`    |           | An `http(s)` URL that also gets each alert as JSON (`text` for Slack and Telegram, `content` for Discord). A secret; it is never logged. |
| `SENTRY_DSN`           |           | Error reporting from the web server and the worker, without personal data. Unset: Sentry is never loaded.                                |
| `BRIFF_RSS_USER_AGENT` |           | User-Agent of feed requests. Unset: `Mozilla/5.0 (compatible; Briff/1.0; +https://briff.dev)`.                                           |
| `BRIFF_SCAN_MAX_BYTES` | `5242880` | Largest `POST /api/scan` body in bytes (5 MB). A bigger upload gets `413`; `briff-scan --chunk` sends fewer repos per upload.            |

Details of the alerts and the health endpoint: [Operations](OPERATIONS.md).

## Compose

Read by `compose.yaml` only, never by the app.

| Variable               | Default                  | What it does                                                                                         |
| ---------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `BRIFF_VERSION`        | `latest`                 | Image tag. Pin a release (versions without `v`, e.g. `0.12.0`); `web` and `worker` run the same tag. |
| `BRIFF_IMAGE`          | `ghcr.io/metelabs/briff` | Image name; change it only to test an image you built yourself.                                      |
| `BRIFF_BIND`           | `127.0.0.1`              | Host address `web` is published on. Keep the loopback address behind a reverse proxy.                |
| `BRIFF_WEB_PORT`       | `3000`                   | Host port of `web`. Change it when 3000 is taken (and the port in `BETTER_AUTH_URL` and the proxy).  |
| `COMPOSE_PROJECT_NAME` | `briff`                  | Prefix of the containers, the network and the database volume. Give a second stack another name.     |

## Deprecated

| Variable         | What it does                                                                                                                                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SCANNER_TOKEN`  | Instance-wide scan token (24+ characters) from before per-organisation scan tokens. Still accepted, with a warning per upload; switch your scanners ([how](SCANNER.md#switch-a-scanner-from-scanner_token)) and remove it. |
| `SCANNER_ORG_ID` | The organisation `SCANNER_TOKEN` uploads belong to; needed only when more than one exists.                                                                                                                                 |

## Hosted service only

Billing through Paddle, read only with `BRIFF_CLOUD=true`. A self-hosted instance never needs them:
`PADDLE_ENV` (`sandbox` or `live`, default `sandbox`), `PADDLE_API_KEY`, `PADDLE_CLIENT_TOKEN`,
`PADDLE_WEBHOOK_SECRET` and `BRIFF_CHECKOUT` (`inline`, the default, or `overlay`). See
[Billing](BILLING.md).

## Set by the image or for development

- `NODE_ENV`, `PORT` and `HOSTNAME`: the image sets `production`, `3000` and `0.0.0.0`. Keep the
  port at 3000; the public `/status` page reads `/api/health` from the same server through it.
- `BRIFF_LLM_FAKE` and `BRIFF_PADDLE_FAKE`: stand-ins for the Anthropic and Paddle APIs in
  development. With `NODE_ENV=production` the first is refused and the second is ignored.
- `PRODUCTHUNT_API_KEY` and `PRODUCTHUNT_API_SECRET`: read by a Product Hunt client that no job
  calls yet. Leave them empty.
