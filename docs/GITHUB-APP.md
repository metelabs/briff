# GitHub App

"Connect GitHub" installs the **Briff GitHub App** on a user or organisation account. Briff
then scans the selected repos once at install, again whenever repos are added, and after
every push to a repo's default branch that changes a file the scanner reads. Nobody copies a
token or adds a workflow. The GitHub Action and the local CLI keep working; a repo uploaded by
the Action (`owner/repo`, source `github`) and the same repo scanned by the app are one Briff
repo.

## What Briff reads

Permissions: **Contents: read-only** and **Metadata: read-only**, nothing else. For each repo:

1. `GET /repos/{owner}/{repo}/branches/{default_branch}`: the head commit. If it is the commit
   Briff scanned last time, it stops here.
2. `GET /repos/{owner}/{repo}/git/trees/{tree}?recursive=1`: the list of **paths** (no
   contents).
3. `GET /repos/{owner}/{repo}/git/blobs/{sha}` only for paths the scanner reads, at most 400
   files per repo, each at most 10 MB. Never a tarball, a zipball or any other file.

A path is read when its file name is in the list below **and** no directory on the way starts
with `.` or is one of `node_modules`, `dist`, `build`, `out`, `coverage`, `vendor`, `target`,
`Pods`, `DerivedData`, `venv`, `site-packages`, `__pypackages__`, `__fixtures__`, `fixtures`,
`testdata`, `__mocks__`, **and** it is at most 6 directories deep. Symlinks and submodules are
never followed. The test is one function, `isScannedPath` in
[`packages/scan/src/files.ts`](../packages/scan/src/files.ts), shared by the CLI's directory
walk and the app; the names come from `lockfileKind` (`packages/scan/src/discover.ts`) and
`runtimeFileKind` (`packages/scan/src/runtimes.ts`):

| Kind             | File names                                                                                                                                                                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lockfiles        | `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`, `composer.lock`, `poetry.lock`, `uv.lock`, `Pipfile.lock`, `requirements.txt`, `requirements-<x>.txt` / `requirements_<x>.txt`                                            |
| Node             | `package.json` (dependencies for the direct flag, `engines.node`, `volta.node`), `.nvmrc`, `.node-version`                                                                                                                                           |
| Version managers | `.tool-versions`, `mise.toml`, `.mise.toml`, `.sdkmanrc`                                                                                                                                                                                             |
| PHP              | `composer.json` (`require` / `require-dev` for the direct flag, `require.php`), `composer.lock` (packages, `platform.php`)                                                                                                                           |
| Python           | `.python-version`, `pyproject.toml` (`[project]`, `[dependency-groups]`, `[tool.poetry]` and `[tool.uv]` dependencies for the direct flag, `requires-python`), `runtime.txt`, `Pipfile` (`[packages]` / `[dev-packages]` for the direct flag)        |
| Go               | `go.mod` (`require` for the modules and the direct flag, `go` / `toolchain`); never `go.sum`                                                                                                                                                         |
| Ruby             | `.ruby-version`, `Gemfile.lock` (GEM specs, DEPENDENCIES, Ruby runtime), `Gemfile` (literal development/test groups)                                                                                                                                 |
| JVM              | `pom.xml`, `build.gradle`, `build.gradle.kts`                                                                                                                                                                                                        |
| .NET             | `global.json`, `*.csproj`, `packages.lock.json`, `Directory.Packages.props`                                                                                                                                                                          |
| Rust             | `rust-toolchain`, `rust-toolchain.toml`, `Cargo.toml` (workspace and dependency declarations), `Cargo.lock` (v3/v4 registry pins)                                                                                                                    |
| Containers       | `Dockerfile`, `Containerfile`, `Dockerfile.<x>` / `Containerfile.<x>` (not `.md`/`.txt`), `*.Dockerfile` / `*.dockerfile`, `compose.yml`, `compose.yaml`, `docker-compose.yml`, `docker-compose.yaml`, `compose.<x>.yml` / `docker-compose.<x>.yaml` |

Note that dot-files such as `.nvmrc` are read; dot-_directories_ (`.github`, `.devcontainer`)
are not.

## What Briff never reads

Source code, READMEs, workflows, issues, pull requests, secrets, environment files, git
history, or any file not in the table. The contents it reads are parsed on the server into
`{package, installed version, direct}` and `{runtime, version, file}` rows, exactly as the CLI
does (`collectFromFiles` in `packages/scan/src/collect.ts`, tested to give the same record as
the CLI on the same files); the file contents themselves are not stored. Installation tokens
live in process memory for under an hour and are never stored; the user token from the
one-time OAuth check is used once and dropped. What leaves Briff afterwards is listed in
[PRIVACY.md](PRIVACY.md).

## How it works

- **Connect** (Settings / onboarding → GitHub App): `/api/github/install` sends you to
  `https://github.com/apps/<slug>/installations/new` with a signed `state` (org + user, 30
  minutes).
- **Setup URL** `/api/github/setup?installation_id=…&setup_action=…&state=…`: checks the state
  against the signed-in member. The installation id in the URL proves nothing (anyone can
  type one), so a new installation goes through the app's OAuth once: `/api/github/callback`
  exchanges the code and links the installation only if `GET /user/installations` for that
  GitHub user contains it. An installation belongs to exactly one Briff org
  (`GithubInstallation.installationId` is unique). A change of repo selection on an
  installation already linked to your org ("Redirect on update") only shows a confirmation;
  the `installation_repositories` webhook scans the added repos, so they are scanned once.
- **Scan** (`github-scan` job, `src/lib/github/scan.ts`): one scan session per job (`scanId`,
  `final` on the last upload), so the runtime urgent pass runs once afterwards, as for a CLI
  run. On a rate limit the repos read so far are stored and the rest are scanned again at
  GitHub's reset time; a repo that fails otherwise is retried after 10, 20 and 30 minutes. A
  known repo whose last scanned file was deleted is stored empty; a read with a file that
  failed to parse, a truncated tree, or files left out by the 400-file / 10 MB budget never
  replaces what is stored.
- **Webhook** `/api/github/webhook`: body capped at 5 MB, `X-Hub-Signature-256` checked with a
  constant-time compare before parsing, answers `202` after queueing:
  - `installation`: `deleted` forgets the installation (its repos stay, unlinked),
    `suspend` / `unsuspend` pause scans; `created` is ignored (linking needs the setup flow).
  - `installation_repositories`: `added` scans those repos, `removed` deletes the Briff repos
    the app brought in (an Action-uploaded repo stays).
  - `push`: only the default branch, only when a changed path passes `isScannedPath` (a force
    push or a partial commit list is scanned anyway).

## Runbook: create the app

Every Briff instance needs its own GitHub App, because the app's webhook and callback URLs point
at one instance. Below, `https://briff.example.com` stands for your instance's public origin
(`BETTER_AUTH_URL`). Needs: a GitHub account or organisation that owns the app, and access to
the environment of the web and worker services. About 10 minutes.

1. GitHub → your avatar → **Settings** → **Developer settings** → **GitHub Apps** →
   **New GitHub App**. (For an organisation-owned app: organisation → **Settings** →
   **Developer settings** → **GitHub Apps** → **New GitHub App**.)
2. Fill in:
   - **GitHub App name**: `Briff` (if taken, `Briff App`). The URL slug GitHub derives from it
     (shown later as `https://github.com/apps/<slug>`) is `GITHUB_APP_SLUG`.
   - **Description** (Markdown, shown on the install page): paste the text from
     [App description](#app-description) below.
   - **Homepage URL**: your instance or project page (the hosted instance uses `https://briff.dev`)
   - **Callback URL**: `https://briff.example.com/api/github/callback`
   - **Expire user authorization tokens**: leave checked.
   - **Request user authorization (OAuth) during installation**: **off**.
   - **Enable Device Flow**: off.
   - **Setup URL (optional)**: `https://briff.example.com/api/github/setup`
   - **Redirect on update**: **on**.
   - **Webhook → Active**: on. **Webhook URL**: `https://briff.example.com/api/github/webhook`.
     **Webhook secret**: generate one and keep it for step 5:
     ```bash
     openssl rand -hex 32
     ```
   - **Permissions → Repository permissions**: **Contents: Read-only**, **Metadata:
     Read-only** (GitHub sets Metadata itself). Everything else: No access. No organisation
     or account permissions.
   - **Subscribe to events**: **Push**. (Installation and installation repositories events
     are always sent to apps; there is no checkbox for them.)
   - **Where can this GitHub App be installed?**: **Any account**.
3. **Create GitHub App**. On the app's page note **App ID** (`GITHUB_APP_ID`) and **Client ID**
   (`GITHUB_APP_CLIENT_ID`).
4. Same page → **Client secrets** → **Generate a new client secret**; copy it now
   (`GITHUB_APP_CLIENT_SECRET`). Then **Private keys** → **Generate a private key**; a `.pem`
   file downloads. Keep it outside any repo (e.g. `~/.keys/briff-github-app.pem`) and turn
   it into one line:
   ```bash
   base64 -w0 ~/.keys/briff-github-app.pem; echo
   ```
5. Add these to the environment of the **web** service and the same six to the **worker**
   service, then restart both:
   ```
   GITHUB_APP_ID=<App ID from step 3>
   GITHUB_APP_SLUG=<slug from https://github.com/apps/<slug>>
   GITHUB_APP_PRIVATE_KEY=<the base64 line from step 4>
   GITHUB_APP_WEBHOOK_SECRET=<the openssl value from step 2>
   GITHUB_APP_CLIENT_ID=<Client ID from step 3>
   GITHUB_APP_CLIENT_SECRET=<client secret from step 4>
   ```
   The literal PEM also works (`-----BEGIN ... -----` with `\n` for newlines); base64 avoids
   quoting trouble.

### App description

Paste this into the **Description** field (it supports Markdown). It is what a user sees on
`https://github.com/apps/<slug>` and on the install screen, so it states the permissions and the
read scope in the user's words.

```markdown
**Briff** turns your repositories into a weekly dependency briefing and same-day security
alerts for the packages and runtimes you actually run.

**What this app reads**

Only the files Briff needs to know your stack: dependency manifests and lockfiles
(`package.json`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `composer.json`,
`composer.lock`, `pyproject.toml`, `poetry.lock`, `uv.lock`, `Pipfile.lock`, `requirements.txt`,
`go.mod` and similar) and runtime
files (`Dockerfile`, `docker-compose.yml`, `.nvmrc`, `.node-version`, `.tool-versions`).
It never reads application code, issues, pull requests or secrets, and it never writes to
your repositories.

**Permissions**

- Contents: read-only, to fetch the files above
- Metadata: read-only, required by GitHub for every app

**When it runs**

On install, and after every push to the default branch that changes one of the files
above. Other pushes are ignored.

**What leaves GitHub**

Package names, versions and runtime versions. Repository names are replaced with aliases
before anything is sent to a language model.

Uninstall the app at any time: scanning stops immediately. The repositories and their data
stay in your Briff account until you remove them on the Repos page or delete the
organisation in Settings.
```

### Verify

1. `curl -s https://briff.example.com/api/health` no longer lists `GitHub App disabled: missing …`
   among its warnings.
2. GitHub app page → **Advanced** → **Recent Deliveries**: the `ping` delivery shows `202`
   after **Redeliver** (before the env was set it was `503`).
3. In Briff: Repos (or Settings) → **Connect GitHub** → install on **one** repo → approve the
   OAuth screen. You land on Repos with "GitHub connected; scanning your repos." Within a
   minute the repo appears in Repos (source GitHub) with its dependencies, and:
   ```bash
   psql "$DATABASE_URL" -c 'select "installationId", "accountLogin", "suspendedAt" from github_installation'
   ```
   shows one row (run it wherever the instance's `DATABASE_URL` is reachable).
4. Push a commit that changes that repo's lockfile on its default branch: Recent Deliveries
   shows `push` → `202` with `"scan queued (scanned files changed)"`; a README-only push shows
   `"ignored: no scanned file changed"`.

Common problems:

- Deliveries `401 Invalid signature`: `GITHUB_APP_WEBHOOK_SECRET` differs from the app's
  webhook secret; set both again.
- Repos page says "Could not confirm that your GitHub account can access that installation":
  the OAuth step ran under another GitHub account than the one that installed the app.
- Worker log `github-scan: GitHub App not configured`: the six variables are on web but not on
  the worker.
- `GITHUB_APP_PRIVATE_KEY is neither a PEM nor a base64-encoded PEM`: the value got cut;
  paste the `base64 -w0` output again.

Maven dependencies are read from `pom.xml` (including local parent properties and dependency management). Gradle packages use root/subproject `gradle.lockfile`, or literal declarations in `build.gradle`, `build.gradle.kts` and `gradle/libs.versions.toml` when no lock is present. These names are exported by the scanner and shared with the tree filter.

## GitHub Actions

Briff reads `.github/workflows/*.yml` and `*.yaml` for literal `uses:` references only.
It extracts action and reusable-workflow package names (`owner/repo`), refs and subpaths;
local actions, `docker://` references and expressions are ignored. Workflow contents are
not stored or uploaded by the CLI. The GitHub App fetches these workflow blobs to run the
same parser and discards their contents; it does not execute workflow steps.

Actions appear under **Actions** with OSV ecosystem `GitHub Actions`. Full tags are exact
versions. A 40-character SHA with a `# vX.Y.Z` annotation uses that version and retains the
SHA as evidence; unannotated SHAs are queried as commits. Floating majors and minors are
constraints, matched only when an advisory covers their entire release interval. Branch
refs have no known release line and receive no versioned fix recommendation.

Public GitHub tags are fetched during package refresh (up to the first 100 tags), alongside
the existing GitHub releases feed. On-line fixes use the tag's original spelling and SHA (`pin owner/repo to vX.Y.Z (sha …)`).
A missing tag mapping directs the reader to the advisory; a fix outside the
installed release line never becomes a command. Public action names and refs are sent to
OSV; action repository names are sent to the public GitHub tags API. No credentials or
workflow `run` values are sent to either API.

NuGet: the shared tree filter also reads `packages.lock.json` and
`Directory.Packages.props`, alongside the existing `*.csproj` pattern. Lockfile pins take
precedence over declarations in the same directory; central versions apply only to project
references using the nearest central file. Imported MSBuild files are not fetched or executed.

## Organisation capacity

New organisations have a 10-repository limit shared with CLI/Action uploads. A scan
leaves extra GitHub repositories unlinked when capacity is exhausted; their existing
installation permission on GitHub is unchanged. Repos displays a capacity note.
Ask the instance admin to raise the limit in Admin, then rescan the installation.
Concurrent scans enforce the same limit at the shared ingestion write boundary.

SwiftPM: the shared file list includes `Package.resolved` and `Package.swift`, including
resolved files under Xcode project workspaces when they pass the existing path exclusions.
Only literal manifest URLs are read for direct ownership; no Swift code is executed.
