# Launch announcement drafts

Drafts for the open-source launch. Nothing here has been posted. Every claim points at
something in this repository; check the list under each text before posting, and re-check
numbers if the code changed since this file was written.

## Hacker News

### Title (max 80 characters)

```
Show HN: Briff – a weekly dependency briefing and same-day CVE emails for repos
```

(79 characters.) Link: `https://github.com/metelabs/briff`.

### First comment (target 350–450 words)

```
Hi HN, I built Briff because I run a few dozen small repos (client sites, side projects,
apps) and kept finding out about security releases for things I actually run from a news
site, days late, with no idea which of my repos were affected.

Briff reads what each repo uses: lockfiles (npm, pnpm, yarn) and runtime files
(Dockerfile FROM lines, compose images, .nvmrc, engines, go.mod, composer.json,
.tool-versions and so on). It never reads source code. You connect repos with a GitHub App
(contents read-only, only those file paths are fetched), a GitHub Action, or a CLI
(`npx briff-scan@0 --dry-run --json` prints exactly what would be uploaded).

From official feeds only (release feeds, vendor security pages, GitHub advisories, OSV) it
sends:

- a weekly email: what changed for the packages and runtimes you use, each item with the
  repos it affects, the version each runs, and the command or step to take;
- a same-day email when a security release or advisory hits a version you run.

Fix commands never cross the major you have installed. An end-of-life line gets "node 18 is
end-of-life and will not get this fix; move to 22.23.4 or later" instead of a command.

Two replays show what it would have sent, with real dated items and sample repos, run
through the production pipeline on a fake clock:

- PHP2Shell (October 2026): php.net posted advance notice at 20:32 UTC on 20 Oct; the urgent
  email goes out at 21:00 (+28 min). The GitHub advisories appeared at 13:34 UTC on 21 Oct;
  the fix email with one action per repo goes out at 14:00 (+26 min).
- Node.js October 2026 security releases: the pre-announcement merged 14 Oct 14:05 UTC,
  email at 15:00 (+55 min); the post was rewritten in place with 22.23.4 / 24.22.1 / 26.12.1
  at 12:07 UTC on 21 Oct, "fix released" email at 13:00 (+52 min).

The delay is the hourly collect, not a typo; security sources are polled every hour.

What it does not do: it does not open PRs or touch your repos, it does not scan code for
vulnerabilities, and lockfile support is JavaScript-only for now (runtimes cover Node, PHP,
Python, Go, Ruby, .NET, Rust, Postgres, Redis and a few more). The weekly text uses an LLM
(Anthropic); repo names are replaced with aliases before anything is sent. Runtime security
emails and OSV advisory emails are built by rules, with no model involved. docs/PRIVACY.md lists every outbound connection.

It is one Docker image (web + worker) on Postgres, self-hostable; the web app and worker are
AGPL-3.0, the scanner is MIT. There is also a hosted instance.

Code and replays: https://github.com/metelabs/briff
```

Check before posting:

- Timelines: `src/replay/replay.test.ts` (php2shell: 28 and 26 minutes; node-oct-2026: the
  send times) and `docs/replay/*.html`.
- Lockfile ecosystems: `packages/scan/src/discover.ts` (`LOCKFILES`). If more ecosystems have
  landed, change "JavaScript-only for now" and the list in the second paragraph.
- Runtime list: docs/SOURCES.md, "Runtime sources".
- EOL sentence: `src/pipeline/runtime-fixes.ts`.
- "A few dozen small repos": adjust to your own number or drop it.
- "There is also a hosted instance": only if sign-ups are open there (`ALLOW_SIGNUP=true` on
  the web service); otherwise drop the sentence.

## Reddit r/selfhosted (target 150–220 words)

Title: `Briff: a self-hosted weekly briefing of what changed in the packages and runtimes your repos use, plus same-day security emails`

```
I've open-sourced Briff, which I've been running for my own repos.

It scans lockfiles and runtime files (Dockerfile FROM, compose images, .nvmrc, go.mod,
composer.json, ...), never source code, then watches official feeds (release feeds, vendor
security pages, GitHub advisories, OSV) and emails you:

- once a week: what changed for the things you actually run, per repo, with the step to take
  (pinned image → the tag to move to; floating tag → rebuild; EOL line → the line to migrate to);
- the same day: when a security release or advisory hits a version you run.

Self-hosting: one Docker image from GHCR run twice (web on port 3000, worker), Postgres 16,
any SMTP relay. An Anthropic API key enables triage and the weekly synthesis; without it,
security alerts still work. All config is runtime env, documented in .env.example; nothing
is needed at build time. Repos come in through a GitHub App you create on your instance, a
GitHub Action, or a CLI.

Every outbound connection is listed in docs/PRIVACY.md. AGPL-3.0 (the scanner is MIT).

https://github.com/metelabs/briff
```

Check before posting: README "Self-hosting"; `.env.example`; r/selfhosted rules (flair
"Release" or "Software", self-promotion limits).

## X / Bluesky (each at most 280 characters on X, 300 on Bluesky with the full URL)

1. Launch (253 characters with the full URL; 239 on X):

   ```
   Briff is open source. It reads your repos' lockfiles and Dockerfiles (never code) and emails you once a week what changed for the stack you actually run, plus the same day when a security fix hits a version you use.
   https://github.com/metelabs/briff
   ```

2. Replay (273 characters with the full URL; 222 on X):

   ```
   PHP2Shell: php.net's notice at 20:32 UTC, Briff's replay emails at 21:00. Advisories at 13:34 next day, fix email at 14:00 with one step per repo (set 8.4.27, rebuild the 8.3-fpm image, 8.1 is EOL).
   https://github.com/metelabs/briff/blob/main/docs/replay/php2shell.html
   ```

3. Self-host (230 characters with the full URL; 203 on X):

   ```
   Self-host it: one Docker image (web + worker), Postgres, any SMTP relay. Repo names reach the LLM only as aliases; runtime and advisory alerts use no model. AGPL-3.0, scanner MIT.
   https://github.com/metelabs/briff#self-hosting
   ```

Check before posting: count characters in the client (links count as 23 on X); the PHP2Shell
steps are the `To do` lines in `src/replay/replay.test.ts`. On Bluesky, a link in the text
needs the link card or a facet; paste the URL so the client makes the card.

## Launch checklist (founder)

Do these in order. Nothing in this repository changes visibility or settings by itself.

1. **Decide about history.** Older commits, commit messages and earlier PR titles and bodies
   still name private repos and hosts (see PR #52). Either accept that, or publish a new
   repository from a single squashed commit of `main` instead of flipping this one.
2. **Secrets**: none found in history (gitleaks, PR #52). Nothing to rotate.
3. **Private vulnerability reporting** (SECURITY.md links to it): GitHub → the repo →
   **Settings** → **Code security** (or **Security**) → **Private vulnerability reporting** →
   **Enable**. Check: `https://github.com/metelabs/briff/security/advisories/new` opens a
   form when you are logged out of the owner account.
4. **Flip visibility**: GitHub → the repo → **Settings** → **General** → **Danger Zone** →
   **Change visibility** → **Change to public** → type `metelabs/briff` → confirm.
   Check: open the repo in a private browser window; README renders and the replay links
   open.
5. **GHCR package**: GitHub → your profile → **Packages** → `briff` → **Package settings** →
   **Danger Zone** → **Change visibility** → **Public**. Check:
   `docker pull ghcr.io/metelabs/briff:latest` works without `docker login`.
6. **Discussions**: **Settings** → **General** → **Features** → tick **Discussions**. Then
   **Discussions** tab → create a "Q&A" category if it is not there.
7. **About box**: repo page → gear icon next to **About** → description "Weekly dependency
   briefing and same-day security alerts from your repos' lockfiles and runtime files",
   website `https://briff.dev`, topics `dependencies`, `security`, `self-hosted`, `nextjs`,
   `osv`, `lockfile`.
8. **First release notes**: the newest release is created by release-please. Repo →
   **Releases** → the newest tag → **Edit** → add a short paragraph above the generated notes
   ("First public release. Self-hosting: README → Self-hosting.") → **Update release**.
   If the release PR (`chore(main): release ...`) is open, merge it first.
9. **Landing page source link**: the landing page shows a link to the source; set its
   constant to `https://github.com/metelabs/briff` (see docs/LANDING.md for where it
   lives once the landing page is merged), deploy, and check the link on the live page.
10. **npm README link**: publish the next `briff-scan` so npm shows the new `repository` and
    `bugs` fields from `packages/scan/package.json` (docs/SCANNER.md, "Developing and
    publishing the package"). Check: `npm view briff-scan repository.url`.
11. **Hosted sign-ups**: if the posts mention the hosted instance, set `ALLOW_SIGNUP=true` on
    its web service and check that `/login` offers sign-up.
12. **Post**: Show HN (weekday, 14:00–16:00 UTC), stay in the thread for the first two hours;
    Reddit and X/Bluesky after the HN post is up.
