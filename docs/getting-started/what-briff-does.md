# What Briff does

Briff reads the lockfiles and runtime files of your repositories, matches them against official
release feeds and security advisories, and tells you what changed for the versions you actually
run. Once a week it sends one email per stream; when a security advisory hits an installed
version, it emails the same day. It never reads source code.

Two ways to run it:

- **Hosted beta** at [app.briff.dev](https://app.briff.dev): sign up and connect your repos. A new
  organisation starts on the Free plan; Pro and Team are paid from Settings → Billing
  ([Billing](../BILLING.md)).
- **Self-hosted**: one Docker image next to Postgres, no plans and no limits
  ([Install](../SELF-HOSTING.md)).

The first week, step by step: [connect repos](connect-repos.md), read
[your first bulletin](first-bulletin.md), and work through [alerts](alerts.md).
