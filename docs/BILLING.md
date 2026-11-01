# Billing (hosted service only)

Briff's hosted service (`BRIFF_CLOUD=true`, app.briff.dev) sells the Pro and Team plans through
[Paddle](https://www.paddle.com), the merchant of record: Paddle takes the payment, adds VAT or
sales tax, sends receipts and invoices and handles refunds. A self-hosted instance has no plans,
no limits and no billing; none of this applies there.

Code: `src/lib/billing/` (catalog, pure rules in `state.ts`, DB sync in `sync.ts`, webhook,
plan management in `manage.ts`, jobs), the webhook route `src/app/api/billing/paddle/route.ts`
and the page `src/app/settings/billing/`. API shapes follow `@paddle/paddle-node-sdk` and
`@paddle/paddle-js`.

## Flow

1. An owner opens **Settings → Billing**, picks Pro or Team, monthly or yearly, and clicks
   Upgrade. Paddle.js opens the overlay checkout with the price id, the owner's email (or the
   org's existing Paddle customer) and `customData: { orgId, orgSig }`; `orgSig` is an HMAC of
   the org id keyed from `BETTER_AUTH_SECRET` (`src/lib/billing/org-link.ts`), so a buyer cannot
   attach a subscription to another org by editing the custom data.
2. Paddle redirects to `/settings/billing?checkout=success` ("Payment received, your plan
   updates in a moment") and the page reloads its data every 3 s for up to 60 s.
3. Paddle sends `transaction.completed` and `subscription.created` to
   `POST /api/billing/paddle`. The webhook stores the subscription (`Subscription`, a tenant
   table) and sets `Org.plan` from the price's `custom_data.plan` (fallback: the catalog).
4. Owners change plan (preview, then confirm), cancel at the end of the period, resume a
   scheduled cancel, open Paddle's customer portal (payment method, invoices, address) and
   download invoices from the page. Every change Paddle accepts is mirrored at once from its
   answer and confirmed later by the webhook.
5. Members see the plan and "ask an owner". Only owners (re-read from the database on every
   action) manage billing, and every action works on the org's own subscription: no
   subscription or customer id ever comes from the browser; an invoice id is checked against the
   org's subscriptions.

Plan changes: a bigger plan, or monthly to yearly on the same plan, is `prorated_immediately`
(the difference is charged now); a smaller plan, or yearly to monthly, is
`prorated_next_billing_period` (settled on the next bill, nothing refunded mid-period). Paddle's
default `on_payment_failure: prevent_change` applies: a declined card leaves the plan as it was.

The customer portal opens only for the person who pays (the Paddle customer's email equals the
signed-in owner's): a Paddle customer is one email and may pay for other orgs too, whose
invoices and cards a co-owner of this org must not see. Billing history lists only the
transactions of this org's own subscriptions.

Deleting an organisation with a live subscription cancels it immediately through the API first;
if that fails the org is not deleted.

## Plan rules (`src/lib/billing/state.ts`)

- `active` and `trialing` give the subscription's plan.
- `past_due` keeps the plan for **14 days** from the first failed renewal (`pastDueSince`), then
  Free. The owners get one "payment failed" email when the subscription turns past_due.
- A cancel is scheduled (`scheduled_change.action = cancel`): the plan stays until
  `effective_at`; the owners get a "subscription canceled, ends on" email. **Resume** removes the
  scheduled change.
- `canceled` keeps the plan only while a paid period is still running, then Free; `paused` gives
  Free.
- An org with several subscriptions gets the biggest plan any of them gives.
- **Manual plans win**: `Org.planSource` records who set the plan (`default`, `admin`,
  `paddle`). Billing never touches `unlimited` and never lowers a plan the instance admin set in
  Admin → Edit limits; a bigger paid plan still applies and from then on belongs to billing.
- Every plan change writes an `OrgEvent` (`plan.changed`, "Billing changed the plan from Free to
  Pro"; the admin's changes say "The instance admin ...") and the owners get a "plan changed"
  email.

`Org.plan` is written only here (`applyOrgPlan`) and by the admin's Edit limits action.

## Webhook

`POST /api/billing/paddle`: 5 MB cap, `Paddle-Signature` verified on the raw body with
`PADDLE_WEBHOOK_SECRET` (`Webhooks.unmarshal`, which also rejects timestamps older than
5 seconds), then the event is stored in `BillingEvent` (Paddle's event id is the key) and
processed once under a row lock; a retry of a processed event answers `duplicate`. Events are
ordered by `occurred_at`: a state older than the stored `Subscription.stateAt` is ignored, so an
update that arrives before its create converges on the newest state. The org comes from the
signed `custom_data.orgId`, else the org already holding the subscription, else the only org
with that Paddle customer.

| Event                                                                                                          | What happens                                                                                              |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `subscription.created`, `.updated`, `.activated`, `.canceled`, `.past_due`, `.paused`, `.resumed`, `.trialing` | Mirror the subscription, derive the plan, emails                                                          |
| `transaction.completed`                                                                                        | Link the Paddle customer to the org (signed org id)                                                       |
| `transaction.payment_failed`, `customer.updated`                                                               | Stored for debugging; the state arrives with the subscription events (the portal reads the customer live) |
| anything else                                                                                                  | Stored and ignored                                                                                        |

Answers: 200 when processed (or a duplicate), 401 for a bad signature, 400 without a signature,
413 over 5 MB, 503 when `PADDLE_WEBHOOK_SECRET` is unset, 500 when processing fails (the error is
stored on the `BillingEvent`; Paddle retries: 3 times in sandbox, for 3 days live). A signature
failure or a processing error alerts the instance admin through the ops alert path
(`OPS_ALERT_EMAIL` / `ALERT_WEBHOOK_URL`, docs/OPERATIONS.md), at most once per 24 h each. The
secret is never logged.

Emails (owners' account addresses, `billing-notify` job) are queued in the same transaction as the
change that causes them, so each goes out once.

## billing-check (daily, 05:45 UTC)

For every org with a subscription: subscriptions that are not canceled and whose newest state is
older than 24 h are read from the Paddle API (a missed webhook), then the plan is re-derived,
which ends expired past_due grace periods and canceled plans whose paid period is over.
Processed `BillingEvent` rows older than 180 days are deleted.

## Environment

| Variable                | Where      | What                                                                |
| ----------------------- | ---------- | ------------------------------------------------------------------- |
| `PADDLE_ENV`            | web+worker | `sandbox` (default) or `live`; picks the price ids and the API host |
| `PADDLE_API_KEY`        | web+worker | Server API key (`pdl_sdbx_apikey_...` / `pdl_live_apikey_...`)      |
| `PADDLE_CLIENT_TOKEN`   | web        | Paddle.js client token (`test_...` / `live_...`), public by design  |
| `PADDLE_WEBHOOK_SECRET` | web        | The notification destination's secret (`pdl_ntfset_...`)            |
| `BRIFF_PADDLE_FAKE`     | dev only   | Canned API answers for the billing page; refused in production      |

All are optional: without the API key or the client token the billing page says "Billing is
not configured on this instance" and nothing else changes; without the webhook secret the
webhook answers 503. Admin → Configuration lists the missing ones on the hosted service.
Nothing is read at build time and nothing goes into the image.

## Set up the notification destination

Paddle dashboard → **Developer tools → Notifications → New destination**:

- Description: `Briff production` (one destination per environment; sandbox and live are separate).
- Type: Webhook. URL: `https://app.briff.dev/api/billing/paddle`.
- Events: `subscription.created`, `subscription.updated`, `subscription.activated`,
  `subscription.canceled`, `subscription.past_due`, `subscription.paused`,
  `subscription.resumed`, `subscription.trialing`, `transaction.completed`,
  `transaction.payment_failed`, `customer.updated`.
- Save, copy the secret key (shown once) into `PADDLE_WEBHOOK_SECRET` on the web service and
  redeploy. Check: **Notifications → the destination → Logs** shows 200 for the next event.

Checkout settings: default payment link `https://app.briff.dev/settings/billing`; approved
domain `app.briff.dev` (live only; sandbox approves every domain).

## Sandbox testing

Test cards (any future expiry, any CVC):

| Card                  | Result                                          |
| --------------------- | ----------------------------------------------- |
| `4242 4242 4242 4242` | Succeeds                                        |
| `4000 0038 0000 0446` | Succeeds after 3-D Secure                       |
| `4000 0000 0000 0002` | Declined                                        |
| `4000 0027 6000 3184` | First payment succeeds, renewals fail (dunning) |

End to end: with the sandbox keys set, open Settings → Billing as an owner, Upgrade to Pro, pay
with `4242 4242 4242 4242`. The page lands on `?checkout=success` and shows Pro within seconds;
the notification log shows 200 for `transaction.completed` and `subscription.created`. Cancel,
resume and change plan from the page; use **Developer tools → Simulations** for `past_due` and
`canceled`. Locally, `BRIFF_PADDLE_FAKE=true` renders the page, the change-plan preview and the
history without keys (checkout itself needs a real client token).

## Live prices

1. Create the products and prices in the live dashboard with the same `custom_data` as sandbox:
   `{ "plan": "pro" | "team", "interval": "month" | "year" }`.
2. Add the four live price ids to `PADDLE_CATALOG.live` in `src/lib/billing/catalog.ts` (until
   all four exist, live checkout reports "not configured"). Nothing else in the code names a
   price id.
3. Set `PADDLE_ENV=live` with the live API key, client token and a live notification destination
   secret.
