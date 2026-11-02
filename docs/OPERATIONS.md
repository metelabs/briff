# Operations: health, job alerts, run history

What an operator of a Briff instance (hosted or self-hosted) can watch, and what tells them when
something is wrong. Configuration is runtime env (`.env.example`).

## Status page

`/status` (public, no session) is the human-readable view of the health endpoint below: overall
state (Operational / Degraded / Down), the web, database and worker components, each scheduled
job's last success ("on schedule" / "late" / "not run yet"), queue lag, the version, the check
time and an incidents list (`INCIDENTS` in `src/lib/ops/incidents.ts`; add one when users were
affected). It reads `/api/health` from the same server on every request
(`http://127.0.0.1:$PORT`, `src/lib/ops/status-fetch.ts`), because a public page may not import
the database client, and refreshes itself every minute. It shows no error text or warnings. Both
footers' "Status" link points here; monitors keep using `/api/health`.

## Health endpoint

`GET /api/health` (no auth, `Cache-Control: no-store`) answers **200** when everything is on time
and **503** with `ok: false` when:

- the database is unreachable (`db: "error"`; the rest of the body is omitted), or
- a scheduled job type is `stale` (see below), or
- the oldest **due** pending job has waited longer than an hour (`queue.oldestPendingSeconds` >
  `queue.limitSeconds`): the worker is down or stuck.

```json
{
  "ok": false,
  "db": "ok",
  "freshness": {
    "security-scan": {
      "status": "ok",
      "lastSuccessAt": "2026-11-02T04:02:14.000Z",
      "dueBy": "2026-11-03T06:02:14.000Z"
    },
    "collect-sources": {
      "status": "stale",
      "lastSuccessAt": "2026-11-02T04:00:38.000Z",
      "dueBy": "2026-11-02T07:00:38.000Z"
    },
    "ops-check": { "status": "never", "lastSuccessAt": null, "dueBy": null }
  },
  "stale": ["collect-sources"],
  "queue": { "oldestPendingSeconds": 12, "limitSeconds": 3600 },
  "lastRuns": {
    "security-scan": { "status": "succeeded", "startedAt": "…", "finishedAt": "…", "error": null }
  },
  "jobs": { "pending": 1, "failed": 0 },
  "warnings": ["GitHub App disabled: missing GITHUB_APP_ID, …"]
}
```

`freshness` has one entry per scheduled job type (`src/lib/jobs/schedule.ts`):

| status  | meaning                                                                                         |
| ------- | ----------------------------------------------------------------------------------------------- |
| `ok`    | last success is younger than the schedule's interval plus grace (`dueBy` = when it turns stale) |
| `stale` | past that; or never succeeded and its first queued job is older than the grace period           |
| `never` | never succeeded and not expected yet (fresh install, or a job type added by an upgrade)         |

Allowed age = interval derived from the cron expression + grace (2h, or 1 day for weekly jobs):
daily jobs 26h, triage (every 6h) 8h, the hourly collect 3h, `ops-check` (every 30 min) 2.5h,
the weekly bulletin 8 days.

Point an uptime monitor at `/api/health` for the full check. The container healthcheck uses
`/api/health?probe=live` (database only, `{ "ok": true, "db": "ok" }`), so a stuck worker never
gets the web container restarted.

## Job alerts

The worker alerts the operators when

- a job **fails for good** (its last retry, `src/worker/runner.ts`; `ops-check` re-offers failures of the last 2 hours whose alert was not delivered), or a job is failed by the
  stale-lock release because its worker died on the last attempt (`lock expired`), and
- a scheduled job type turns **stale** (the `ops-check` job, every 30 min at :10 and :40).

Each alert is one email (the Briff layout: job, time, last success, error excerpt, a link to
Admin → Runs) to `OPS_ALERT_EMAIL` (comma-separated) or, when unset, the instance admin (the
first account, the same rule as `/admin`), plus, when `ALERT_WEBHOOK_URL` is set, a POST of

```json
{
  "text": "Briff: Job failed: security-scan (2026-11-02 04:03 UTC)\nError: OSV querybatch failed: 503\nhttps://app.example.com/admin/runs",
  "content": "(same as text)",
  "kind": "failed",
  "job": "security-scan",
  "error": "Error: OSV querybatch failed: 503"
}
```

Slack incoming webhooks and Telegram (`https://api.telegram.org/bot<token>/sendMessage?chat_id=<id>`)
read `text`; Discord webhooks read `content`. The webhook URL is a secret: it is never logged.

Dedupe: at most one alert per (job type, kind) per 24 hours, stored in the `ops_alert` table
(instance-level, not tenant data). Failures held back inside the window are counted and the next
email says how many. If every configured channel fails (SMTP error, webhook non-2xx), the slot is
released and the next failure or `ops-check` tick (which revisits jobs failed in the last 2 hours) tries again. With neither SMTP nor a webhook
configured, the alert is only written to the worker log (`"msg":"ops alert"`, once per window).

A type that has never succeeded is not alerted on until a job of that type was queued and a grace
period passed, so a new instance or an upgrade that adds a job type stays quiet.

## Admin → Runs

`/admin/runs` (instance admin only) lists the last 7 days of runs per job type: status, start time
(UTC), duration, counts, and the error (first line, expandable to the whole stack). Each scheduled
job type shows whether it is on schedule, its last success and when it would turn overdue, and a
**Run now** button that queues it (idempotent: an already pending job of the type is reused).

## Worker container heartbeat

The worker container is healthy while `/tmp/briff-worker-heartbeat` is younger than 180 s
(`docker-healthcheck.sh`). The worker refreshes it every 30 s on a timer, before every claim and
on every job heartbeat, so a long job (a multi-minute collect + triage drain) no longer looks
dead to the healthcheck.

## LLM cost and the monthly budget

Every LLM request is priced from its tokens with the list prices in `src/llm/pricing.ts` (USD per
million tokens: Haiku 5.5 0.10 in / 0.50 out, Sonnet 5.5 2 in / 10 out, Message Batches half);
a model without a price there (the development fake, an unknown id) counts as $0 and is listed
as unpriced. These are estimates; Anthropic's invoice is the truth.

- **Admin → LLM cost** sums the tokens of every `triage-items` and `weekly-bulletin` run this and
  last calendar month (UTC), per `task:model`.
- **Admin → Organisations** shows each org's LLM calls, tokens and estimated cost this month from
  `OrgUsage` (one row per org and UTC day, written as each synthesis and profile request
  completes). Triage is shared by every org (one triage per item), so it is only in the card.
- **Budget** (hosted service only, `BRIFF_CLOUD=true`): Free $0.50, Pro $3, Team $10 a month,
  Unlimited none (`PLAN_ALLOWANCES[*].llmBudgetUsd`); Admin → Edit limits → Monthly AI budget replaces the
  plan's value for one org. Once the month-to-date estimate reaches the budget, the weekly
  bulletin of that org is a **condensed edition**: the triage model (`BRIFF_MODEL_TRIAGE`) with
  an 8000-token output cap, and a "Condensed edition" note on the page and in the email. Nothing
  is skipped; triage and same-day security alerts never read the budget.
- At **80 %** and **100 %** the org's owners get one email each (billing-notify job) and the
  operator gets an ops alert (`kind: budget`, job `llm-budget:<org>:<month>:<pct>`), once per
  month and threshold (`Org.llmBudgetNotifiedMonth` / `llmBudgetNotifiedPct`). Settings → Billing
  shows "AI usage this month: $x of $y".

## Abuse limits

- `POST /api/scan` refuses a body over `BRIFF_SCAN_MAX_BYTES` (default 5 MB) with **413**
  (`code: SCAN_TOO_LARGE`) before reading it when `content-length` says so, else once the read
  passes the cap. On the hosted service each org may upload `PLAN_ALLOWANCES[*].scanUploadsPerDay` times a
  UTC day (Free 20, Pro 200, Team 1000, Unlimited no limit); past it **429**
  (`code: SCAN_RATE_LIMIT`, `Retry-After` until midnight UTC). Each `briff-scan --chunk` upload
  counts once. briff-scan prints the JSON error.
- GitHub App installations per org: Free 1, Pro 5, Team unlimited. Connect GitHub at the limit
  goes straight back to Repos with "installation limit reached" and an Upgrade link; the OAuth
  callback checks again under a per-org lock.

## Sentry (optional)

With `SENTRY_DSN` set, `@sentry/node` is initialised in the worker (`src/worker/index.ts`) and
in the web server through Next's instrumentation hook (`src/instrumentation.ts`, Node runtime
only; `onRequestError` reports server render, route handler and Server Action errors). Final
job failures are reported with the job type. Nothing reaches the browser bundle, tracing is off
(`tracesSampleRate: 0`), and data collection is off (no user, headers, cookies, bodies, query
strings, local variables, server name). Without `SENTRY_DSN` the SDK is never imported.

### Runbook: turn Sentry on

1. In Sentry: Projects → Create project → Node.js → name it `briff`. Settings → Projects →
   briff → Client Keys (DSN) → copy the DSN (`https://<key>@<host>/<project id>`).
2. Dokploy → the Briff project → `web` → Environment → add `SENTRY_DSN=<the DSN>` → Save →
   Deploy. Do the same on `worker` (same DSN; events carry the tag `role: web` or
   `role: worker`).
3. Check that both started with it: `docker logs <web container> 2>&1 | grep -i sentry` and the
   same for the worker print nothing. A line `sentry: init failed` means the DSN is wrong.
4. Confirm that the DSN accepts events (from any shell, the DSN in `DSN`):

   ```bash
   KEY=${DSN#https://}; KEY=${KEY%%@*}; HOST=${DSN#*@}; HOST=${HOST%%/*}; PROJECT=${DSN##*/}
   printf '{"event_id":"%s"}\n{"type":"event"}\n{"message":"briff sentry check","level":"info"}\n' \
     "$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')" |
     curl -sS -X POST "https://$HOST/api/$PROJECT/envelope/" \
       -H 'content-type: application/x-sentry-envelope' \
       -H "x-sentry-auth: Sentry sentry_version=7, sentry_key=$KEY, sentry_client=briff-check/1.0" \
       --data-binary @-
   ```

   You should see `{"id":"…"}`, and within a minute an issue "briff sentry check" under Issues.
   The first real error from Briff appears the same way, with its `role` tag; job failures also
   carry the job type.

## Runbook: external uptime monitor

A monitor outside the server notices what the server cannot report itself (host down, proxy
broken). Free tier of UptimeRobot (or Better Stack Uptime, same steps):

1. Sign up, then Integrations & API (or My Settings) → Alert contacts → add your email; add
   Telegram (Add → Telegram → open the bot link and press Start; the contact turns active).
2. Monitors → New monitor → type **HTTP(s)** (Better Stack: "URL becomes unavailable"), URL
   `https://<your Briff host>/api/health`, interval **5 minutes**, alert both contacts → Create.
3. You should see the monitor "Up" after the first check. `/api/health` answers 503 when a
   scheduled job is overdue or the queue is stuck, so the monitor also pages on a stuck worker.
   Use `/api/health?probe=live` instead if you only want "the web server answers".
4. Test the contacts once: Alert contacts → each contact → Test notification. Both the email
   and the Telegram message should arrive within a minute.

## Runbook: Docker log rotation

Docker's default `json-file` driver never rotates, so container logs grow until the disk is
full. On each server, once:

```bash
sudo cat /etc/docker/daemon.json 2>/dev/null   # merge into an existing file, do not overwrite it
sudo tee /etc/docker/daemon.json > /dev/null <<'JSON'
{ "log-driver": "json-file", "log-opts": { "max-size": "50m", "max-file": "5" } }
JSON
sudo systemctl restart docker
```

- The restart stops and restarts **every container** on the host: expect a minute or two of
  downtime (web, worker, Postgres). Do it in a quiet hour, not around Monday 04:00 UTC (weekly
  bulletin) or 04:00 daily (security-scan).
- The setting applies to containers created afterwards. Redeploy each service (Dokploy →
  service → Deploy) so its container is recreated with it.
- Check: `docker inspect -f '{{.HostConfig.LogConfig}}' <container>` prints
  `{json-file map[max-file:5 max-size:50m]}`. At most 250 MB of logs per container are kept.

## Runbook: restore drill (quarterly)

A backup is only proven by a restore. Once a quarter, restore last night's dump on a scratch
host (never the production server) and check that Briff starts on it. `scripts/smoke.sh`
creates a throw-away stack with its own database and never touches another one, so the drill
restores into the stack it creates and keeps:

1. On the scratch host, with this repository checked out, copy last night's dump next to it
   (the nightly cron writes `briff-<date>.sql.gz`, see [Backup and restore](SELF-HOSTING.md#backup-and-restore)):
   `scp <backup host>:/var/backups/briff-$(date -d yesterday +%F).sql.gz .`
2. Start a smoke stack and keep it:
   `SMOKE_KEEP=1 SMOKE_PROJECT=briff-restore scripts/smoke.sh`. Every step prints `PASS`, and
   the last line names the kept stack's directory:

   ```text
   kept: docker compose --project-directory /tmp/briff-smoke.XXXXXX -p briff-restore down -v
   ```

   Set `W=/tmp/briff-smoke.XXXXXX` from it and
   `dc() { docker compose --project-directory "$W" -f "$W/compose.yaml" -p briff-restore "$@"; }`.

3. Stop the app and restore: `dc stop web worker`, then
   `gunzip -c briff-*.sql.gz | dc exec -T postgres psql -U briff -d briff -v ON_ERROR_STOP=1`.
   It should end without an `ERROR` line. The worker stays stopped: the dump holds real members,
   and nothing in the drill should email them (the smoke stack has no SMTP anyway).
4. `dc start web`, then `curl -s http://127.0.0.1:3999/api/health?probe=live` prints
   `{"ok":true,"db":"ok"}` (web ran `prisma migrate deploy` on the restored schema), and
   `dc exec -T postgres psql -U briff -d briff -tAc 'select count(*) from org'` matches the
   organisation count on Admin in production.
5. Clean up: `dc down -v && rm -rf "$W" briff-*.sql.gz`. Write the date and the result in the
   operator notes. A failure (dump missing, restore error, health not ok) is a broken backup:
   fix the backup before anything else.
