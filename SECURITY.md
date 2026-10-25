# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately, not in a public issue:

1. Open https://github.com/metelabs/briff/security/advisories/new (repository → **Security**
   → **Report a vulnerability**).
2. Describe the issue, the affected version or commit, and how to reproduce it. A proof of
   concept against your own instance is welcome; do not test against other people's data on
   app.briff.dev.

The maintainer aims to answer within 7 days. Once a fix is released, the advisory is published
with credit unless you prefer otherwise.

In scope: the web app and worker in this repository, the `briff-scan` package
(`packages/scan`), the Docker image, and the hosted instance at app.briff.dev. Of particular
interest: anything that crosses the org boundary (tenant data is meant to be reachable only
through `withOrg`), scan token and GitHub App authentication, the webhook signature check,
SSRF through feed URLs, and anything that sends a repo name, email or token to the language
model (docs/PRIVACY.md).

## Supported versions

Briff is pre-1.0. Only the latest release (the newest tag, `ghcr.io/metelabs/briff:latest`)
and the latest `briff-scan` 0.x on npm get security fixes. Self-hosted instances should follow
releases; the changelog is [CHANGELOG.md](CHANGELOG.md).

## What data a Briff instance holds

Listed in full in [docs/PRIVACY.md](docs/PRIVACY.md). In short:

- Repo names, and per repo the installed package versions (whether direct) and declared
  runtime versions. No source code and no file contents.
- Accounts: name, email, password hash (Better Auth), org and stream settings, the interest
  profile text and bulletin feedback.
- Scan tokens as a sha256 hash plus an 8-character prefix; the secret is shown once.
- For a connected GitHub App: the installation id, account login and type. Installation
  tokens are kept in memory for under an hour and never stored.
- Derived data: matches, alerts, bulletins, job runs. Public catalog data (packages, feed
  items, advisories) is shared across orgs.

Secrets an operator configures (`BETTER_AUTH_SECRET`, `ANTHROPIC_API_KEY`, SMTP credentials,
the GitHub App key) are runtime environment only; none is needed to build the image and none
is written to the database.
