# Slack and webhooks

Next to the email, Briff can post each weekly bulletin and the same-day security alerts to a
**Slack channel** (incoming webhook) or to **your own webhook** (signed JSON). Owners set them
up under **Settings → Integrations**; on the hosted service they are part of the Team plan, on a
self-hosted instance they are always available.

Each integration has:

- **Kind**: Slack or Webhook.
- **URL**: a public `https://` address. Slack URLs must start with
  `https://hooks.slack.com/services/`. Briff shows only the host and the last four characters
  once it is saved.
- **Stream**: one stream, or all streams of the organisation. A stream's integration gets that
  stream's bulletin, and alerts only for repos in the stream.
- **Send**: the weekly bulletin, the same-day security alerts (new critical and high
  advisories, the same ones that are emailed), or both.

**Send test** posts a sample message right away and shows the result in the list. Turn an
integration off to pause it; remove it to delete it. Every add, on/off and removal is written to
the audit log (Settings → Members → Activity).

## When Briff posts

- **Bulletin**: once the week's bulletin of a stream is stored and emailed (Monday 04:00 UTC).
  Each integration gets each bulletin once; a bulletin that is regenerated later in the same
  week is emailed again but not posted again.
- **Security alerts**: once the daily security scan has emailed a batch of new critical or high
  advisories. Each integration gets each batch once. Moderate and low advisories wait for the
  bulletin, as in the email; the first-scan backlog is not posted.

A post that fails with a timeout (10 seconds), a network error, HTTP 408, 429 or 5xx is retried
three times (after about 30 s, 1 min and 2 min). HTTP 4xx and refused addresses are not retried.
The last error and the time of the last successful delivery are shown in the list.

Briff only connects to public addresses: a URL that resolves to a private, loopback or
link-local address is refused (the same SSRF guard as feed fetching, with the connection pinned
to the checked address). Redirects are not followed.

On the hosted service an organisation that leaves the Team plan keeps its integrations, paused:
nothing is sent and Settings says so, until the plan includes them again.

## Slack

1. In Slack, open **Apps**, search for **Incoming WebHooks** (or create an app at
   [api.slack.com/apps](https://api.slack.com/apps) → **Incoming Webhooks** → turn it on).
2. **Add New Webhook to Workspace**, pick the channel, **Allow**.
3. Copy the **Webhook URL** (`https://hooks.slack.com/services/T…/B…/…`).
4. In Briff: **Settings → Integrations → Add integration**, kind **Slack**, paste the URL, pick the
   stream and what to send, **Add integration**, then **Send test**.

The message is a Block Kit message: a header (the bulletin's subject, or the number of new
advisories), the summary, up to six lines (must-act and good-to-know items, or advisories by
severity with their repos) and an **Open bulletin** / **Open alerts** button.

## Webhook

Briff sends `POST <your URL>` with `Content-Type: application/json; charset=utf-8` and:

| Header              | Value                                                              |
| ------------------- | ------------------------------------------------------------------ |
| `X-Briff-Event`     | `bulletin`, `alerts` or `test`                                     |
| `X-Briff-Delivery`  | a unique id of this delivery (the same on its retries)             |
| `X-Briff-Signature` | `sha256=` + hex HMAC-SHA256 of the raw body, keyed with the secret |
| `User-Agent`        | `Briff-Delivery/1`                                                 |

The signing secret (`whsec_…`) is shown once, when the webhook is added. To rotate it, remove
the webhook and add it again.

Body:

```json
{
  "type": "bulletin",
  "org": { "id": "cm…", "name": "Acme" },
  "stream": { "id": "cm…", "name": "Weekly" },
  "occurredAt": "2026-11-02T04:03:11.000Z",
  "title": "Briff · Weekly · W45: undici · nodemailer and more",
  "summary": "Two security fixes to apply this week …",
  "url": "https://app.briff.dev/b/cm…",
  "items": [
    {
      "title": "undici 7.16.1 security release",
      "detail": "npm i undici@7.16.1",
      "url": "https://github.com/nodejs/undici/releases/tag/v7.16.1",
      "severity": null,
      "repos": ["acme/api", "acme/web"]
    }
  ]
}
```

- `type`: `bulletin`, `alerts` or `test`.
- `stream`: `null` for an alert batch posted to an all-streams webhook.
- `items`: for a bulletin, its must-act items (with the action as `detail`), then good-to-know
  items, then the week's advisories by package; for alerts, one entry per advisory
  (`severity`: `CRITICAL`, `HIGH`, `MODERATE`, `LOW` or `UNKNOWN`; `url`: its OSV page).

Answer with any 2xx within 10 seconds; do the work after answering. Use `X-Briff-Delivery` to
drop a repeat.

### Verifying the signature (Node.js)

Compute the HMAC over the **raw** request body, before any JSON parsing, and compare in constant
time:

```js
import { createHmac, timingSafeEqual } from "node:crypto";
import express from "express";

const app = express();

app.post("/hooks/briff", express.raw({ type: "application/json" }), (req, res) => {
  const expected = `sha256=${createHmac("sha256", process.env.BRIFF_WEBHOOK_SECRET)
    .update(req.body)
    .digest("hex")}`;
  const given = req.get("X-Briff-Signature") ?? "";
  const ok =
    given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) return res.sendStatus(401);
  res.sendStatus(204);
  const event = JSON.parse(req.body.toString("utf8"));
  console.log(req.get("X-Briff-Event"), event.title);
});

app.listen(3000);
```

## Audit log export

Owners can download the organisation's audit log as CSV from **Settings → Members → Activity →
Export audit log (CSV)** (`GET /api/export/audit`; Team plan on the hosted service). Columns:
`createdAt` (UTC, ISO 8601), `type` (`member.invited`, `role.changed`, `plan.changed`,
`delivery_target.created`, …), `actorEmail`, `targetEmail`, `detail`. Each export is itself
recorded as `audit.exported`.
