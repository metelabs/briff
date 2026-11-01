# Operations: health, job alerts, run history

What an operator of a Briff instance (hosted or self-hosted) can watch, and what tells them when
something is wrong. Configuration is runtime env (`.env.example`).

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

- a job **fails for good** (its last retry, `src/worker/runner.ts`), or a job is failed by the
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
released and the next failure or `ops-check` tick tries again. With neither SMTP nor a webhook
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

## Sentry (optional)

With `SENTRY_DSN` set, `@sentry/node` is initialised in the worker (`src/worker/index.ts`) and
in the web server through Next's instrumentation hook (`src/instrumentation.ts`, Node runtime
only; `onRequestError` reports server render, route handler and Server Action errors). Final
job failures are reported with the job type. Nothing reaches the browser bundle, tracing is off
(`tracesSampleRate: 0`), and data collection is off (no user, headers, cookies, bodies, query
strings, local variables, server name). Without `SENTRY_DSN` the SDK is never imported.
