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

### First comment

```
Hi HN, I built Briff because I run a few dozen small repos (client sites, side projects,
apps) and kept finding out about security releases for things I actually run from a news
site, days late, with no idea which of my repos were affected.

Briff reads what each repo uses: package pins from 11 ecosystems (npm/pnpm/yarn, Composer,
PyPI, Go modules, Bundler, Cargo, Maven/Gradle, NuGet, pub, SwiftPM and Hex), GitHub Actions
`uses:` references, and runtime files
(Dockerfile FROM lines, compose images, .nvmrc, engines, go.mod, composer.json,
.tool-versions and so on). It never reads source code. You connect repos with a GitHub App
(contents read-only, only those file paths are fetched), a GitHub Action, or a CLI
(`npx briff-scan@0 --dry-run --json` prints exactly what would be uploaded).

From official feeds only (release feeds, vendor security pages, GitHub advisories, OSV) it
sends:

- a weekly email: what changed for the packages and runtimes you use, each item with the
  repos it affects, the version each runs, and the command or step to take;
- a same-day email when a critical or high security release or advisory hits a version you
  run (moderate and low ones wait for the weekly email).

Fix commands never cross the major you have installed. An end-of-life line gets "node 18 is
end-of-life and will not get this fix; move to 22.23.4 or later" instead of a command.

Two replays show what it would have sent, with real dated items and sample repos, run
through the production pipeline on a fake clock (https://app.briff.dev/replay/php2shell and
https://app.briff.dev/replay/node-oct-2026):

- PHP2Shell (October 2026): php.net posted advance notice at 20:32 UTC on 20 Oct; the urgent
  email goes out at 21:00 (+28 min). The GitHub advisories appeared at 13:34 UTC on 21 Oct;
  the fix email with one action per repo goes out at 14:00 (+26 min).
- Node.js October 2026 security releases: the pre-announcement merged 14 Oct 14:05 UTC,
  email at 15:00 (+55 min); the post was rewritten in place with 22.23.4 / 24.22.1 / 26.12.1
  at 12:07 UTC on 21 Oct, "fix released" email at 13:00 (+52 min).

The delay is the hourly collect, not a typo; security sources are polled every hour.

What it does not do: it does not open PRs or touch your repos, it does not scan code for
vulnerabilities, and it cannot see the installed OS package inventory inside a Docker image. Debian, Ubuntu
and Alpine image advisories are candidates from a short base-package list, with rebuild
or migration advice. Runtime support dates refresh daily from endoflife.date, with
"EOL in N days" facts. Curated ecosystem news is scoped to streams using that ecosystem
or runtime. The weekly text uses an LLM
(Anthropic); repo names are replaced with aliases before anything is sent. Runtime security
emails and OSV advisory emails are built by rules, with no model involved. docs/PRIVACY.md lists every outbound connection.

It is one Docker image (web + worker) on Postgres, self-hostable; the web app and worker are
AGPL-3.0, the scanner is MIT. It is a public beta: hosted sign-ups are open at
https://app.briff.dev, with defaults of 10 repos and 2 streams per organisation.
Self-hosted admins can raise those same defaults.

Code: https://github.com/metelabs/briff
Self-hosting guide: https://github.com/metelabs/briff/blob/main/docs/SELF-HOSTING.md
```

Check before posting:

- Severity threshold: `emailsImmediately` in `src/security/plan.ts` (critical/high, unknown
  counts as high); runtime urgent path in AGENTS.md ("critical/high/unknown severity only").
- Replay URLs: `src/replay/public-ids.ts`; both pages must answer 200 on app.briff.dev.
- Timelines: `src/replay/replay.test.ts` (php2shell: 28 and 26 minutes; node-oct-2026: the
  send times) and `docs/replay/*.html`.
- Package coverage and paths: `packages/scan/src/discover.ts` (`LOCKFILES`), `files.ts`,
  `ecosystems.ts`; registry adapters: `src/sources/registries.ts`; commands:
  `src/pipeline/install-commands.ts`; OSV planning: `src/security/plan.ts`.
- Actions: `packages/scan/src/actions.ts`, `src/sources/github-actions.ts`.
- Base image limits: `packages/scan/src/distros.ts`, `src/security/base-images.ts`.
- Lifecycle products and daily schedule: `src/lib/runtime-eol-catalog.ts`, `src/worker/scheduler.ts`.
- Scoped news: `src/sources/curated.ts`, docs/SOURCES.md.
- Capacity and sign-up defaults: `prisma/schema.prisma` (`Org`), `src/lib/env.ts`,
  `src/lib/org-limits.ts`; Admin can raise limits on self-hosted instances too.
- Runtime list: docs/SOURCES.md, "Runtime sources".
- EOL sentence: `src/pipeline/runtime-fixes.ts`.
- "A few dozen small repos": adjust to your own number or drop it.
- Hosted registration: confirm the deployed `ALLOW_SIGNUP` setting before posting.

## Reddit r/selfhosted

Title: `Briff: a self-hosted weekly briefing of what changed in the packages and runtimes your repos use, plus same-day security emails`

```
I've open-sourced Briff, which I've been running for my own repos.

It reads package pins from 11 ecosystems (npm/pnpm/yarn, Composer, PyPI, Go modules,
Bundler, Cargo, Maven/Gradle, NuGet, pub, SwiftPM and Hex), GitHub Actions `uses:`
references and runtime files, never application code, then watches official feeds (release
feeds, vendor security pages, GitHub advisories, OSV, endoflife.date) and emails you:

- once a week: what changed for the things you actually run, per repo, with the step to take
  (pinned image → the tag to move to; floating tag → rebuild; EOL line → the line to migrate to);
- the same day: when a critical or high security release or advisory hits a version you run.

Self-hosting: one Docker image from GHCR run twice (web on port 3000, worker), Postgres 16,
any SMTP relay. An Anthropic API key enables triage and the weekly synthesis; without it,
security alerts still work. All config is runtime env, documented in .env.example; nothing
is needed at build time. Repos come in through a GitHub App you create on your instance, a
GitHub Action, or a CLI. Guide: docs/SELF-HOSTING.md.

Support dates refresh daily from endoflife.date. Debian/Ubuntu/Alpine image advisories
are candidates: Briff cannot see installed OS packages. News feeds follow each stream's
ecosystems. Hosted sign-ups are open (10 repos, 2 streams per organisation by default);
self-hosted admins can raise those limits.

Every outbound connection is listed in docs/PRIVACY.md. AGPL-3.0 (the scanner is MIT).
Replays of two real incidents, with every email it would have sent and when:
https://app.briff.dev/replay/php2shell

https://github.com/metelabs/briff
```

Claims: package parsers in `packages/scan/src/discover.ts`, lifecycle catalog in
`src/lib/runtime-eol-catalog.ts`, base images in `src/security/base-images.ts`, scoped feeds in
`src/sources/curated.ts`, capacity defaults in `prisma/schema.prisma`.

Check before posting: docs/SELF-HOSTING.md and README "Self-hosting"; `.env.example`; r/selfhosted rules (flair
"Release" or "Software", self-promotion limits).

## X / Bluesky (each at most 280 characters on X, 300 on Bluesky with the full URL)

1. Launch (277 characters with the full URL; 267 on X):

   ```
   Briff: weekly stack briefings and same-day security emails. 11 package ecosystems, GitHub Actions, runtimes with EOL dates, Docker base images. Never reads app code. Public beta: hosted sign-ups open, or self-host with Docker + Postgres. AGPL.
   https://github.com/metelabs/briff
   ```

2. Replay (237 characters with the full URL; 222 on X):

   ```
   PHP2Shell: php.net's notice at 20:32 UTC, Briff's replay emails at 21:00. Advisories at 13:34 next day, fix email at 14:00 with one step per repo (set 8.4.27, rebuild the 8.3-fpm image, 8.1 is EOL).
   https://app.briff.dev/replay/php2shell
   ```

3. Self-host (244 characters with the full URL; 203 on X):

   ```
   Self-host it: one Docker image (web + worker), Postgres, any SMTP relay. Repo names reach the LLM only as aliases; runtime and advisory alerts use no model. AGPL-3.0, scanner MIT.
   https://github.com/metelabs/briff/blob/main/docs/SELF-HOSTING.md
   ```

Check before posting: count characters in the client (links count as 23 on X); the PHP2Shell
steps are the `To do` lines in `src/replay/replay.test.ts`. On Bluesky, a link in the text
needs the link card or a facet; paste the URL so the client makes the card.

## FAQ answers for the threads

Paste these when the question comes up; each is one paragraph.

**Why not Dependabot or Renovate?**

```
Use them too; Briff does a different job. Dependabot and Renovate open pull requests per
package and per repo, and Dependabot alerts live in each repo's Security tab. Briff never
touches your repos: it reads the lockfiles and runtime files of all of them and sends one
email a week across the whole set, with the repos each item affects and the one step to
take, plus a same-day email for critical and high advisories. It also covers what those
bots do not open PRs for: runtimes in Dockerfiles, compose files and version files (Node.js,
PHP, Python, ... with end-of-life dates), Debian/Ubuntu/Alpine base image fixes, and
vendor security announcements that come before the advisory (the PHP2Shell replay shows
an email 28 minutes after php.net's advance notice). Fix commands stay on the release line
you run, so it never tells you to jump a major to silence an alert.
```

**What data leaves your server?**

```
On a self-hosted instance, only what docs/PRIVACY.md lists, connection by connection.
Package names and installed versions go to OSV for the security scan; public package names
go to the registries for "latest version" lookups; feed URLs are plain GETs. If you set an
Anthropic key, triage and the weekly summary send public item text plus your package names
and versions, but never repo names, org names, emails or tokens: every repo name in a
request is replaced with a per-request alias (repo-1, repo-2, ...) on the server and mapped
back after the answer (src/llm/pseudonym.ts), and an integration test fails if a repo, org,
user or token value reaches a prompt. Runtime and advisory alerts use no model at all. Leave
the Anthropic key empty and nothing goes to Anthropic; leave SMTP empty and no email leaves.
The scanner uploads only {package, version, direct} and {runtime, version, file} per repo;
`npx briff-scan@0 --dry-run --json` prints exactly that.
```

Check before posting: docs/PRIVACY.md ("Outbound connections", "Repo names and the LLM"),
`src/pipeline/llm-payload.integration.test.ts`, the PHP2Shell timeline in
`src/replay/replay.test.ts`.

## Launch checklist (founder)

The launch is: make `metelabs/briff` public with **0.8.0** as the launch release. Nothing in
this repository changes visibility or settings by itself; every step below is a click or a
command for the founder. Do them in order; each ends with what you should see.

### Before the switch (repository still private)

1. **Everything for the launch is merged and `main` is green.** Password reset and email
   verification, docs/SELF-HOSTING.md, docs/UPGRADING.md, docs/OPERATIONS.md and this PR.

   ```bash
   gh run list -R metelabs/briff --branch main --limit 5
   ```

   You should see: the newest `CI` and `Docker` runs `completed success`.

2. **History is clean.** `metelabs/briff` starts from a single import commit, so the private
   history of the earlier repository is not in it.

   ```bash
   git -C ~/code/briff fetch origin && git -C ~/code/briff log --reverse --format='%h %s' origin/main | head -1
   gh pr list -R metelabs/briff --state all --limit 200 --json number,title,body \
     | grep -iE '<a private repo, customer or host name>' || echo "no match"
   ```

   You should see: `85aa78b chore: import Briff 0.6.1 into the metelabs organisation`, then
   `no match` for each name you check (use the plain list behind the hashes in
   `src/test/private-names.test.ts`, kept outside the repository). A match in a PR title or body: edit that PR's text on GitHub before the switch.

3. **No secrets in history.**

   ```bash
   docker run --rm -v ~/code/briff:/repo ghcr.io/gitleaks/gitleaks:latest git /repo
   ```

   You should see: `no leaks found`. A finding: rotate that secret first, then decide whether
   the commit can stay public.

4. **Cut 0.8.0 with release-please.** release-please (`.github/workflows/docker.yml`,
   config `release-please-config.json` with `bump-minor-pre-major: true`) proposes the next
   version from the commits merged since 0.7.3: any `feat:` gives 0.8.0, only `fix:` gives
   0.7.4.

   ```bash
   gh pr list -R metelabs/briff --search 'chore(main): release in:title' --state open
   ```

   - The open release PR says `chore(main): release 0.8.0`: go to step 4c.
   - It says `0.7.4` (or there is none): force the version with a `Release-As` footer. The
     release-please README documents it: a commit on `main` whose **body** contains
     `Release-As: x.y.z` makes the next release PR that version. Do not use `feat!:` for
     this: pre-1.0 with `bump-minor-pre-major` it would also give 0.8.0, but the changelog
     would get a "⚠ BREAKING CHANGES" section that is not true.

     a. When you squash-merge the next pull request (any one), open **Squash and merge**,
     and in the extended description add a last line on its own:

     ```
     Release-As: 0.8.0
     ```

     Then **Confirm squash and merge**. (The repository's squash message is the commit
     messages; the footer must be a line by itself, not a `* ` bullet.)

     b. Without a pending pull request, use an empty commit on a branch:

     ```bash
     cd ~/code/briff && git fetch origin && git switch -c chore/release-0.8.0 origin/main
     git commit --allow-empty -m "chore: release 0.8.0" -m "Release-As: 0.8.0"
     git push -u origin chore/release-0.8.0
     gh pr create -R metelabs/briff --base main --title "chore: release 0.8.0" --body "Release-As: 0.8.0"
     ```

     Squash-merge it with the footer line kept in the description.

     You should see: within a few minutes the `Docker` run on `main` updates the release PR
     to `chore(main): release 0.8.0`.

   c. Merge the release PR. You should see: tag `0.8.0`, a GitHub release `0.8.0`, and in
   the `Docker` run "Trigger Dokploy deploys" with `WEB deploy triggered` and
   `WORKER deploy triggered`. Then `curl -s https://app.briff.dev/api/health` starts with
   `{"ok":true,"db":"ok"`.

5. **Landing source links.** Every repository link on the public pages is built from
   `SOURCE_URL` in `src/components/landing/links.ts`, already
   `https://github.com/metelabs/briff`.

   ```bash
   curl -s https://app.briff.dev/ | grep -o 'https://github.com/metelabs/briff[^"]*' | sort -u
   ```

   You should see: the repository URL plus `#self-hosting`, `#readme` and
   `/blob/main/docs/PRIVACY.md`. They return 404 until step 6; step 10 checks them again.

### The switch

6. **Change visibility.** GitHub → `metelabs/briff` → **Settings** → **General** → scroll to
   **Danger Zone** → **Change visibility** → **Change to public** → confirm the warnings →
   type `metelabs/briff` → **I understand, change repository visibility**.
   You should see: a **Public** label next to the repository name. In a private browser
   window (logged out), `https://github.com/metelabs/briff` opens.

7. **Fork pull request approval.** **Settings** → **Actions** → **General** → **Approval for
   running fork pull request workflows from contributors** → **Require approval for
   first-time contributors** → **Save**. CI uses no secrets (CONTRIBUTING.md, "CI for
   forks"), so this only guards against someone spending CI minutes.
   You should see: the option selected after a reload.

8. **Private vulnerability reporting** (SECURITY.md and the issue chooser link to it; the
   setting exists only for public repositories, hence after step 6). **Settings** →
   **Code security** (older layout: **Code security and analysis**) → **Private
   vulnerability reporting** → **Enable**.
   You should see: logged out of the owner account (or as another account),
   `https://github.com/metelabs/briff/security/advisories/new` opens the "Report a
   vulnerability" form.

9. **Discussions.** **Settings** → **General** → **Features** → tick **Discussions** → on
   the new **Discussions** tab, **Set up discussions** → keep the default categories (they
   include **Q&A**).
   You should see: a **Discussions** tab on the repository with a Q&A category.

10. **README renders.** Open `https://github.com/metelabs/briff` logged out.
    You should see: the Briff logo (ink on light, teal on dark theme), the CI badge
    "passing", the release badge "0.8.0", the license badge, the "Status: public beta"
    line; the links to docs/SELF-HOSTING.md and the replay pages open. Then check the
    landing links from step 5:

    ```bash
    for u in $(curl -s https://app.briff.dev/ | grep -o 'https://github.com/metelabs/briff[^"#]*' | sort -u); do
      printf '%s %s\n' "$(curl -s -o /dev/null -w '%{http_code}' "$u")" "$u"; done
    ```

    You should see: `200` on every line. (The release badge can take a few minutes:
    shields.io caches.)

11. **GHCR package public.** `https://github.com/orgs/metelabs/packages` → **briff** →
    **Package settings** (right column) → **Danger Zone** → **Change visibility** →
    **Public** → type `briff` → **I understand the consequences, change package visibility**.

    ```bash
    docker logout ghcr.io; docker pull ghcr.io/metelabs/briff:0.8.0
    ```

    You should see: the pull completes without `unauthorized` or `denied`.

12. **About box.** Repository page → gear icon next to **About** → Description `Weekly
dependency briefing and same-day security alerts from your repos' lockfiles and runtime
files` → Website `https://briff.dev` → Topics `dependencies`, `security`,
    `self-hosted`, `vulnerability-alerts`, `osv`, `lockfile`, `nextjs`, `email` → **Save
    changes**. Or:

    ```bash
    gh repo edit metelabs/briff --homepage https://briff.dev \
      --description "Weekly dependency briefing and same-day security alerts from your repos' lockfiles and runtime files" \
      --add-topic dependencies,security,self-hosted,vulnerability-alerts,osv,lockfile,nextjs,email
    ```

    You should see: the description, `briff.dev` (it redirects to app.briff.dev) and the
    topic chips in the About box.

13. **Launch release notes.** Repository → **Releases** → `0.8.0` → **Edit** (pencil) → add
    this paragraph above the generated notes, then **Update release**:

    ```
    First public release. Self-hosting: docs/SELF-HOSTING.md; hosted beta: https://app.briff.dev.
    ```

    You should see: the paragraph on the release page, the release marked **Latest**.

### After the switch

14. **npm `briff-scan` links.** npm still shows the 0.1.1 metadata without `repository` and
    `bugs`; `packages/scan/package.json` already has them. Bump `version` (0.1.1 → 0.1.2)
    in a pull request, following docs/SCANNER.md "Developing and publishing the package"
    (a test asks for the workflow block there to be updated), merge, then publish from
    that section's commands.

    ```bash
    npm view briff-scan version repository.url bugs.url
    ```

    You should see: `0.1.2`, `git+https://github.com/metelabs/briff.git`,
    `https://github.com/metelabs/briff/issues`; the npm page's sidebar links to the
    repository.

15. **Branch rules (only if you want them).** Free plans get rulesets on public repositories.
    **Settings** → **Rules** → **Rulesets** → **New ruleset** → **New branch ruleset** → name
    `main` → Enforcement **Active** → **Bypass list** → **Add bypass** → **Repository
    admin** → Targets **Add target** → **Include default branch** → tick **Restrict
    deletions**, **Block force pushes**, **Require a pull request before merging** (required
    approvals 0, or 1 if someone else reviews) → **Create**.
    Do **not** tick **Require status checks to pass** with `check`: release PRs are opened
    with `GITHUB_TOKEN` and never get a CI run (`ci.yml`, `paths-ignore`), so they could
    not be merged. With 1 required approval you cannot approve your own PRs; the admin
    bypass is what lets you merge them.
    You should see: `git push origin HEAD:main` from a local commit is rejected with
    "Changes must be made through a pull request".

16. **Hosted sign-ups.** The posts say sign-ups are open. Check that the hosted web service
    runs with `ALLOW_SIGNUP=true`: open `https://app.briff.dev/login` logged out.
    You should see: a "Create account" option.

17. **Open the starter issues.** Blank issues are off (`.github/ISSUE_TEMPLATE/config.yml`),
    so open each section of docs/CONTRIBUTING-ISSUES.md with `gh` (title = the section
    heading without its number, body = the section text):

    ```bash
    gh label create "good first issue" -R metelabs/briff --color 7057ff --force
    gh issue create -R metelabs/briff --label "good first issue" --title "<section title>" --body "<section body>"
    ```

    You should see: the issues under **Issues** → **Labels** → `good first issue`.

18. **Post.** Show HN on a weekday, 14:00–16:00 UTC; stay in the thread for the first two
    hours (FAQ answers above). Reddit and X/Bluesky after the HN post is up.
