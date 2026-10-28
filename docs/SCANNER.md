# Scanner (briff-scan)

The scanner is the npm package **`briff-scan`** (source `packages/scan/`, MIT, one bundled
file, no runtime dependencies). It finds every `package-lock.json` (v1–v3), `pnpm-lock.yaml`
(v5–v9, every workspace importer), `yarn.lock` (v1 and Berry), `composer.lock`, `poetry.lock`,
`uv.lock`, `Pipfile.lock`, `requirements*.txt` and `go.mod` plus the runtime files below, and uploads **only** `{repo, package, installed version, direct}` and
`{runtime, version, file}` to `POST /api/scan` (see [Ecosystems](#ecosystems)). No source code, no file contents, no absolute paths leave the machine.

It runs in three places, all with the same code:

| Where                     | How                                                          | Repo names                         |
| ------------------------- | ------------------------------------------------------------ | ---------------------------------- |
| GitHub Actions (any user) | `npx briff-scan@0` in a workflow, one repo per run           | `owner/repo` (`GITHUB_REPOSITORY`) |
| A laptop or server        | `npx briff-scan@0` in a repo, or `--all-repos --root ~/code` | folder name / path under the root  |
| A server, daily (systemd) | `npm run scan:local` = `scripts/scan-local.ts`, a wrapper    | path under `~/code`                |

- Installed versions come from the lockfile, never from `package.json` / `composer.json` /
  `pyproject.toml` ranges. A `requirements.txt` line without an exact `==` pin has no
  installed version: it is sent as an `unresolved` row (see [Ecosystems](#ecosystems)).
- "Direct" means declared in the manifest next to the lockfile: `package.json` (or a
  workspace manifest) and installed at the top level, `composer.json` `require` / `require-dev`,
  `pyproject.toml` / `Pipfile` (see [Ecosystems](#ecosystems)).
- One repo per run by default: everything under `--root` (default: the current directory) is
  one repo, nested git repos and a root that is a linked worktree included. With `--all-repos`
  a repo is the nearest directory with a `.git` and its name is the path relative to the root;
  linked git worktrees (`*-wt` checkouts) are skipped unless `--include-worktrees` is passed.
  `node_modules`, `dist`, `build`, `Pods` and dot-directories are never entered.
- Inside GitHub Actions (`GITHUB_ACTIONS=true`) the upload says `source: "github"`, so the
  repo shows as "GitHub" on `/repos`; everywhere else `source: "local"` ("Local scanner").
  The same repo scanned both ways is two Briff repos.
- New repos arrive with `included = false`; they show up as "new" in the web app
  and stay out of the bulletin until you include them.

## Ecosystems

Each dependency row carries its ecosystem, named as OSV names it
(`packages/scan/src/ecosystems.ts`); Briff stores it as `Package.ecosystem`, so a package is
(ecosystem, name) and the same name in two ecosystems is two packages. npm rows carry no
`ecosystem` field, so an npm-only upload is byte-for-byte what it was before (the repo-level
`ecosystem: "npm"` stays for older servers).

| Ecosystem (`ecosystem`) | Lockfile                                                                                                                              | Direct from                                                                                                                                                                                                                                                                                                       | Name / version as stored                                                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm (absent)            | npm, pnpm, yarn                                                                                                                       | `package.json`                                                                                                                                                                                                                                                                                                    | as written                                                                                                                                                                                            |
| Composer (`Packagist`)  | `composer.lock`                                                                                                                       | `composer.json` `require` + `require-dev`                                                                                                                                                                                                                                                                         | lower-cased; leading `v` dropped and `6.4` read as `6.4.0` (Composer treats them alike)                                                                                                               |
| Python (`PyPI`)         | `poetry.lock` (`manager: "poetry"`), `uv.lock` (`uv`), `Pipfile.lock` (`pipenv`), `requirements.txt` / `requirements-<x>.txt` (`pip`) | `pyproject.toml` `[project]` dependencies + optional dependencies, `[dependency-groups]`, `[tool.uv] dev-dependencies`, `[tool.poetry]` dependencies + groups; uv.lock's own workspace project; `Pipfile` `[packages]` + `[dev-packages]`; every requirements line (pip-compile `# via pkg` lines are transitive) | PEP 503 names (`Flask_SQLAlchemy` → `flask-sqlalchemy`); PEP 440 versions in semver form where they mean the same release (`2.31` → `2.31.0`, `1.0rc1` → `1.0.0-rc.1`), else as written (`1.0.post1`) |
| Go (`Go`)               | `go.mod`                                                                                                                              | `require` lines without `// indirect`                                                                                                                                                                                                                                                                             | module paths as written (case-sensitive); versions without the `v` OSV leaves out (`v0.30.0` → `0.30.0`, pseudo-versions and `+incompatible` kept)                                                    |

A Composer package required only in `require-dev` is sent with `dev: true` (stored as
`Dependency.dev`), so its fix command keeps it there (`composer require --dev`).
Composer branch installs (`dev-main`, `2.x-dev`) name no release and are skipped, like npm links.
Platform requirements (`php`, `ext-*`) are not packages; `php` is a runtime (below).

Python rows carry the tool whose file listed them (`manager`), so the fix command speaks it,
and `group` (every section that declares it, comma-joined: `.` the main list, a dependency
group, `extra:<name>`) with `dev: true` when all of them are development groups
(PEP 735 dependency groups and Poetry groups by name; `[tool.uv] dev-dependencies`, Poetry
dev-dependencies and Pipfile `[dev-packages]` are `dev`), stored as `Dependency.dev` /
`Dependency.group`, so the command keeps it in that group (`uv add --dev`, `uv add --group test`,
`poetry add --group test`, `pipenv install --dev`). A production package declared only in an
optional extra (`[project.optional-dependencies]`, Poetry extras) carries `group: "extra:<name>"`
and gets `uv add --optional <name>` / `poetry add --optional <name>`. A declaration with extras
or a marker is sent in `requirement`, one `target<TAB>shape` line per declaration (target: its
section, or `member:section` in a uv workspace) (`acme-http[socks]; python_version >= "3.9"`, stored as
`Dependency.requirement`): the command keeps both and replaces only the version
(`uv add 'acme-http[socks]==2.32.0; python_version >= "3.9"'`), so the tool updates the
existing declaration, its constraint included, instead of adding a second one. In a uv workspace, a
dependency a member declares carries `project` (`Dependency.project`): `.` for the root plus
`member:section` pairs, and the command runs one `uv add [--package <member>]` per
declaration (with several, each as `uv add --frozen` and then one `uv lock`, so no edit
resolves against another declaration's old pin); two conditional pins of one package in one
section keep their own shapes, matched to the locked version they pin; a member's `requires-dist` in uv.lock gives its extras and
markers. When a requirements export pins the same version as a lockfile, the lockfile's
declaration (group, extra, dev, requirement, member) wins. pip-compile `# via`
annotations are read in both styles (separate lines and `--annotation-style line`).
When a lockfile and a requirements file pin the same version (`poetry export` output), the
lockfile's tool wins. Packages from git, path or URL sources are skipped. A requirements line
without an exact pin (`>=2.0`, `~=1.4`, `==2.*`, no specifier) is sent with `unresolved: true`
and the requirement as `version`: Briff matches releases for the package, shows the
requirement on the Stack page, and never queries OSV with it or compares it to a version.
Options (`-r`, `-e`, `--index-url`, `--hash`), URLs and local paths are skipped. `venv`,
`site-packages` and `__pypackages__` directories are never entered.

Go: since Go 1.17 a module's `go.mod` lists every module in the build list at the version
minimal version selection picked, the indirect ones marked `// indirect`, so its `require`
lines are the installed set; `go.sum` holds hashes of more versions than are selected and is
neither read nor fetched. A `replace` by another module version stands in for the required one
(that is what gets built), and its fix command edits that replacement
(`go mod edit -replace=… && go mod tidy`), since `go get` would only change the requirement.
A replacement of the exact required version wins over one of every version, as in Go; a
replacement by a local directory has no released version and is skipped. A `go.mod` from
before Go 1.17 lists only part of the indirect modules.

On the server the ecosystem picks the OSV query (`security-scan`), the registry that
`refresh-packages` asks for the latest version, deprecation and repository (npm registry,
Packagist `p2` metadata: newest stable release, `abandoned` as the deprecation; PyPI JSON:
`info.version`, "Development Status :: 7 - Inactive" as the deprecation, the GitHub link among
`project_urls`), and the fix commands: `npm i pkg@X` / `npm ls pkg`, `composer require [--dev]
vendor/pkg:^X` / `composer why vendor/pkg`, `uv add [--dev | --group g | --optional e] pkg==X` / `poetry add [--group g]
pkg@X` / `pipenv install [--dev] pkg==X` / `pip install pkg==X` and `uv tree --invert --package
pkg` / `pipdeptree -r -p pkg`, `go get module@vX` / `go mod why -m module`. Go modules come from
the module proxy (`proxy.golang.org/<module>/@latest`, the `// Deprecated:` comment of that
release's go.mod) with the GitHub repo when the proxy's origin or the module path names one,
else the module's pkg.go.dev page. Composer's caret and the exact Python and Go versions keep
the install on the release line the fix was chosen for (a Go major above v1 is part of the
module path; below 1.0 every minor is its own line, as for npm).

## Scan tokens

Every upload carries `Authorization: Bearer <token>`. A token is created per scanner in
**Settings → Scan tokens → New token** (name it after where it runs: "GitHub Action",
"build-server", "laptop"); the dialog shows the secret once (`brf_` + 40 url-safe characters) with a
Copy button. Briff stores only its sha256 and the first 8 characters for the list, so a lost
token cannot be shown again: revoke it and create a new one.

- The token decides the org: uploads land in the org that created it, whatever else exists on
  the instance. There is no `SCANNER_ORG_ID` for tokens.
- Every accepted upload sets the token's "last used" time (Settings shows it).
- Revoke (Settings → Scan tokens → Revoke → Revoke token) is immediate: the next upload gets
  `HTTP 401 {"error":"This scan token was revoked."}`. Revoked tokens stay in the list, marked.
- The scanner reads the token from `BRIFF_TOKEN`.

### Legacy `SCANNER_TOKEN` (deprecated)

Before scan tokens (24 Oct 2026) the web service had one instance-wide `SCANNER_TOKEN` env and
picked the org with `SCANNER_ORG_ID` (or the only org). It still works as a fallback: a bearer
that is not a known scan token is compared with `SCANNER_TOKEN`, and every such upload logs
`scan: SCANNER_TOKEN is deprecated ...` at warn level in the web service's logs. Switch each scanner as
described in [Switch a scanner from SCANNER_TOKEN](#switch-a-scanner-from-scanner_token), then
remove `SCANNER_TOKEN` and `SCANNER_ORG_ID` from the web service.

## GitHub Action

For each repo (the onboarding page's "GitHub Action" tab shows the same steps with this
instance's URL):

1. Token: onboarding → GitHub Action → **Create token** (creates "GitHub Action" once), or
   Settings → Scan tokens → New token. One token can serve every repo.
2. Repo secret: GitHub → the repo → Settings → Secrets and variables → Actions → **New
   repository secret**, name `BRIFF_TOKEN`, value the token. Or in the repo:
   `gh secret set BRIFF_TOKEN` (it prompts for the value).
3. Commit `.github/workflows/briff.yml`:

<!-- prettier-ignore -->
```yaml
# Briff scan (briff-scan 0.1.1, pinned to @0)
name: briff
on:
  push: { branches: [main] }
  schedule:
    - cron: "0 3 * * 1"   # Mondays 03:00 UTC, before the bulletin
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 22
          check-latest: true   # newest 22.x, not the runner's cached one
          package-manager-cache: false
      - run: npx briff-scan@0
        env:
          BRIFF_API_URL: https://app.briff.dev
          BRIFF_TOKEN: ${{ secrets.BRIFF_TOKEN }}
```

4. Check: the repo → Actions → briff → the run's "Run npx briff-scan@0" step ends with
   `uploaded 1 repos`; the repo appears on `/repos` as `owner/repo` (GitHub) and onboarding's
   "Waiting for the first scan" turns into "1 repo received" within 5 seconds.

`check-latest: true` makes `setup-node` install the newest Node.js 22.x on every run instead of
the runner's preinstalled toolcache version, which can lag behind a security release (a run
without it used the cached 22.23.3 while 22.23.4 carried a security fix); the major stays floating
(never a full version). `checkout` and `setup-node` are on v5, which run on Node.js 24 (v4 runs on
the deprecated Node.js 20). `package-manager-cache: false`: the scan installs nothing, and v5's
automatic cache for a `packageManager` field would fail in a repo without a lockfile. The major is pinned (`@0`), so 0.x releases arrive by themselves; the comment names the
version current when the file was copied. `src/lib/scan/workflow.ts` renders this file for
onboarding, and a test keeps it equal to the block above (`npm test` fails after a version
bump in `packages/scan/package.json` until this block is updated).

## Local CLI

Node 20 or later.

```bash
cd ~/code/my-site
npx briff-scan@0 --dry-run                     # what would be sent; sends nothing
BRIFF_TOKEN=brf_... npx briff-scan@0           # upload this repo (to https://app.briff.dev)
BRIFF_TOKEN=brf_... npx briff-scan@0 --all-repos --root ~/code   # every git repo under ~/code
npx briff-scan@0 --dry-run --json              # the exact payload as JSON
```

| Option                | Env             | Default                                              |
| --------------------- | --------------- | ---------------------------------------------------- |
| `--api <url>`         | `BRIFF_API_URL` | `https://app.briff.dev`                              |
| `--token <token>`     | `BRIFF_TOKEN`   | required unless `--dry-run`                          |
| `--root <dir>`        |                 | current directory (`~` expanded)                     |
| `--repo-name <name>`  |                 | `GITHUB_REPOSITORY` in Actions, else the folder name |
| `--all-repos`         |                 | off: the root is one repo                            |
| `--include-worktrees` |                 | off (only with `--all-repos`)                        |
| `--exclude <name>`    |                 | none; repeatable or comma-separated (0.1.1+)         |
| `--max-depth <n>`     |                 | 6                                                    |
| `--chunk <n>`         |                 | 10 repos per upload (only with `--all-repos`)        |
| `--dry-run`, `--json` |                 | off                                                  |

`--exclude` skips a repo by the exact name Briff would receive: the path under `--root` with
`--all-repos` (`sigma/forms-web`; a nested repo is excluded on its own), otherwise the
`--repo-name` / `owner/repo` / folder name. An excluded repo is not read at all and is
reported on stderr as `skip <name>: excluded with --exclude`; with `--all-repos`, a name that
matches no repo gets `--exclude <name>: no repo with a lockfile or runtime file has that name`
(a typo would otherwise upload the repo again). Use it for a repo that the GitHub Action
already scans: the same repo scanned both ways is two Briff repos (`owner/repo` and the
folder name), and removing the local one on `/repos` only lasts until the next local scan.

Exit codes: 0 done (also when nothing was found), 1 the scan or upload failed (the server's
message is printed, e.g. `HTTP 401: {"error":"This scan token was revoked."}`), 2 bad options.
Every request sends `user-agent: briff-scan/<version>`.

### Developing and publishing the package

- Source in `packages/scan/src/` (the lockfile and runtime parsers the app also imports as
  `@scan/*`; one source, no copies). Tests run with the app's `npm test`.
- `cd packages/scan && npm run build` bundles `src/cli.ts` with esbuild into
  `dist/cli.mjs` (yaml bundled, its ISC licence appended). Try it with
  `node packages/scan/dist/cli.mjs --dry-run`.
- Release: bump `version` in `packages/scan/package.json` (a test then asks for the workflow
  block above to be updated), merge, then from a checkout with `npm ci` done at the root:
  ```bash
  cd packages/scan
  npm login                        # once per machine; the npm account that owns briff-scan
  npm publish --access public      # prepublishOnly builds dist/cli.mjs first
  npm view briff-scan version      # must print the new version
  ```
  A breaking change to options or payload needs a new major and a new workflow template.

## Scan session (atomic upload)

The scanner uploads in chunks of 10 repos (`--chunk`). Every upload of one run carries the same
`scanId` (a UUID) and the last one `final: true`. Briff never runs the runtime security
reconciliation and urgent email per upload; it holds one collect-sources job per org
(`collect-sources:scan:<orgId>`, payload `{ due: true, rematchOrgId }`, `src/lib/scan/follow-up.ts`):

| Upload                                | Effect on the org's pending urgent pass                                 |
| ------------------------------------- | ----------------------------------------------------------------------- |
| session, not final                    | created or pushed to now + 15 min (safety net if the final never comes) |
| session, final                        | created or moved to now                                                 |
| no `scanId` (scanner before sessions) | created or pushed to now + 2 min (debounce)                             |

Whether an upload changed runtimes does not matter: the pass reconciles state (docs/SOURCES.md),
so any completed scan also catches repos an earlier pass missed, and the hourly collect does the
same for every org. So the email of a run covers every repo of the run. Before this (23 Oct 2026)
the pass ran after the first chunk and the Node.js alert listed 7 of 14 node repos; repos the
reconciliation adds to an already emailed match get one "also affects" follow-up. The response
carries `urgentPass: { id, runAfter }` (null when scheduling failed). Older web apps ignore
`scanId`/`final`.

## Runtime detection

Beside lockfiles the scanner reads which runtimes a repo declares
(`packages/scan/src/runtimes.ts`, pure, fixtures in `packages/scan/src/__fixtures__/runtimes/`).
A repo with runtime files but no lockfile (a PHP site) is uploaded too.

| Runtime | Files and fields                                                                                                                   |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| node    | `.nvmrc` (`lts/<codename>` → major), `.node-version`, `package.json` `engines.node` / `volta.node`                                 |
| php     | `composer.json` `require.php` / `config.platform.php`, `composer.lock` `platform` / `platform-overrides`                           |
| python  | `.python-version`, `pyproject.toml` `requires-python` / Poetry `python`, `runtime.txt`, `Pipfile`                                  |
| go      | `go.mod` `go` and `toolchain`                                                                                                      |
| ruby    | `.ruby-version`, `Gemfile.lock` `RUBY VERSION`                                                                                     |
| java    | `pom.xml` `maven.compiler.release` / `.target` / `java.version`, Gradle toolchain / `sourceCompatibility`, `.sdkmanrc`             |
| dotnet  | `global.json` `sdk.version`, `*.csproj` `TargetFramework(s)` (`net8.0` → 8.0)                                                      |
| rust    | `rust-toolchain(.toml)` `channel`, `Cargo.toml` `rust-version`                                                                     |
| any     | `.tool-versions` (asdf), `mise.toml` `[tools]`                                                                                     |
| images  | every `FROM` in `Dockerfile`, `Dockerfile.*`, `*.Dockerfile`, `Containerfile`; `image:` in `docker-compose*.yml` / `compose*.yaml` |

Runtime ids: `node php python go ruby java dotnet rust postgres mysql mariadb redis valkey
nginx deno bun`. Images map through `IMAGE_RUNTIMES` (official `node`, `php`, `python`,
`golang`, `ruby`, `eclipse-temurin`/`openjdk`/`amazoncorretto`, `mcr.microsoft.com/dotnet/*`,
`rust`, `postgres`, `mysql`, `mariadb`, `redis`, `valkey/valkey`, `nginx`, `denoland/deno`,
`oven/bun`); the tag's version prefix becomes the version (`php:8.3-fpm-alpine` → php 8.3).
Stage aliases, `scratch` and `--platform` are ignored. A tag built from a variable
(`php:${PHP_VERSION}`) is sent raw with `unresolved: true`, and so is a reference pinned
by digest only (`golang@sha256:...`: version = the full reference, no normalised version);
with a tag and a digest the tag wins (`node:22@sha256:...` → node 22). Only a reference
with neither (`FROM node`) is reported as `latest`. An image the map does not know
is sent as `image` with the full reference; extend the map to turn it into a runtime.
`__fixtures__`, `fixtures`, `testdata` and `__mocks__` directories are not entered.

Each repo in the payload carries
`runtimes: [{ name, version, normalized, source, unresolved, constraint? }]`: `version` is the raw
text (`^8.2`, `22-bookworm-slim`), `normalized` the `major[.minor[.patch]]` derived from it
or null, `source` the file relative to the repo root plus the field (`package.json
engines.node`), `constraint: true` when the text is a range (below). The field is optional: an
upload without it leaves the repo's stored
runtimes alone, an upload with it (even empty) replaces them. Runtimes show as chips on
`/repos`; sources with `Source.runtime` set match repos that declare that runtime
(`runtime:<id>` match reason, weight 1.0 like a direct release).

### Constraints and evidence

A range (`engines.node >=20`, `require.php ^8.3`, `requires-python >=3.10`, `18 || 20`,
`8.2.*`: an operator, a wildcard or alternatives; `isVersionConstraint`) is a **constraint, not
an installed version**. The scanner flags it `constraint: true` (`RepoRuntime.constraint`; uploads
from older scanners get the same rule on ingest, and rows stored before the column are null and
derived on read, both through `isConstraintRow`). Image tags, `.nvmrc` /
`.node-version` / `.tool-versions`, `go.mod`, composer `platform` and `volta.node` are concrete.

End-of-life checks (`/repos` chips, Stack, the home tile) and runtime advisory matching
(`affectedRuntimeRepos`, the urgent email, the bulletin's runtime act item) judge each repo on its
**evidence** (`runtimeEvidence`, `packages/scan/src/runtimes.ts`):

1. the concrete rows, when the repo has any (Dockerfile `FROM` tag, compose image, version files,
   `go.mod`, composer platform);
2. else the constraints at the repo root, so a workspace package's `engines`
   (`packages/scan/package.json >=20`) never outweighs the root's;
3. else every constraint.

A constraint alone is shown as a chip in its readable form (`node 20+`) but is never called
end-of-life: no EOL chip, no Stack EOL cell, and an advisory gets "check which Node.js version
runs" instead of the end-of-life sentence. An open lower bound still gets the lowest fixed
version at or above it ("run node 22.23.4 or later"). The Briff repo itself (`node:22-alpine`,
root `>=22.12`, `packages/scan >=20`) is judged on the Dockerfile.

## Run by hand (from a Briff checkout)

`npm run scan:local` is `scripts/scan-local.ts`, a thin wrapper over the package:
`briff-scan --all-repos --root ${BRIFF_SCAN_ROOT:-~/code}`, plus `--exclude $BRIFF_SCAN_EXCLUDE`
when that comma list is set, then the given flags, reading `BRIFF_TOKEN` (or the deprecated
`SCANNER_TOKEN`) and `BRIFF_API_URL`.

```bash
cd ~/code/briff
npm run scan:local -- --dry-run                 # print what would be sent
BRIFF_API_URL=https://app.briff.dev BRIFF_TOKEN=brf_... npm run scan:local
npm run scan:local -- --root ~/code/sigma --dry-run
BRIFF_SCAN_EXCLUDE=briff,grove npm run scan:local -- --dry-run   # everything but these two
```

Output lists each repo with dependency and runtime counts and `(new)` for first
sightings; `--dry-run` also prints every detected runtime under its repo:

```
  garden-php                                    0 deps    0 direct
      php 8.3 (^8.3) [constraint] · composer.json require.php
      php 8.3 (8.3-fpm) · Dockerfile
```

## Run daily with systemd (03:30 UTC)

For a Linux machine that keeps checkouts of your repos under `~/code` (a build server or a
workstation). The units are in `deploy/systemd/` and run as a systemd user service.

1. Checkout and dependencies (on that machine):
   ```bash
   cd ~/code && git clone git@github.com:metelabs/briff.git   # or: cd ~/code/briff && git pull
   cd ~/code/briff && npm ci
   ```
2. Secrets file (create a token named after the machine in Settings → Scan tokens, e.g.
   https://app.briff.dev/settings#scan-tokens, and paste the secret the dialog shows; set
   `BRIFF_API_URL` to your own instance when you self-host):
   ```bash
   mkdir -p ~/.config/briff && chmod 700 ~/.config/briff
   cat > ~/.config/briff/scanner.env <<'ENV'
   BRIFF_API_URL=https://app.briff.dev
   BRIFF_TOKEN=brf_paste-the-token-here
   ENV
   chmod 600 ~/.config/briff/scanner.env
   ```
   A repo that uses the GitHub Action should be excluded here, or it shows up twice (once as
   `owner/repo` from the Action, once as its folder name from this machine) and comes back after
   you remove the local copy on `/repos`. Add its folder name (the path under `~/code`, as
   `npm run scan:local -- --dry-run` lists it) to a comma list in the same file:
   ```bash
   echo 'BRIFF_SCAN_EXCLUDE=briff,grove' >> ~/.config/briff/scanner.env
   cd ~/code/briff && set -a && . ~/.config/briff/scanner.env && set +a && npm run scan:local -- --dry-run
   ```
   The dry run must print `skip briff: excluded with --exclude` (one line per name) and must
   not list those repos. The unit reads the file as its `EnvironmentFile`, so no unit change is
   needed; the next timer run uses it.
3. Units:
   ```bash
   mkdir -p ~/.config/systemd/user
   ln -sf ~/code/briff/deploy/systemd/briff-scan.service ~/.config/systemd/user/
   ln -sf ~/code/briff/deploy/systemd/briff-scan.timer ~/.config/systemd/user/
   systemctl --user daemon-reload
   systemctl --user enable --now briff-scan.timer
   loginctl show-user "$USER" -p Linger   # must print Linger=yes; else: sudo loginctl enable-linger "$USER"
   ```
4. Verify with a manual run:
   ```bash
   systemctl --user start briff-scan.service
   journalctl --user -u briff-scan.service -n 40 --no-pager
   systemctl --user list-timers briff-scan.timer
   ```
   You should see `uploaded N repos` in the journal and the next run at 03:30 UTC.

## Switch a scanner from SCANNER_TOKEN

The systemd unit works unchanged during the switch: the scanner sends `BRIFF_TOKEN` when it is
set and falls back to `SCANNER_TOKEN`.

1. Create the token: https://app.briff.dev/settings#scan-tokens → **New token** → name
   it after the machine → **Create token** → **Copy** (the secret is shown only now).
2. Put it into the scanner's env and drop the old variable:
   ```bash
   sed -i '/^SCANNER_TOKEN=/d; /^BRIFF_TOKEN=/d' ~/.config/briff/scanner.env
   echo 'BRIFF_TOKEN=brf_paste-the-token-here' >> ~/.config/briff/scanner.env
   grep -c '^BRIFF_API_URL=https://app.briff.dev$' ~/.config/briff/scanner.env   # must print 1
   ```
3. Run it once and check:
   ```bash
   systemctl --user start briff-scan.service
   journalctl --user -u briff-scan.service -n 20 --no-pager   # "uploaded N repos"
   ```
   Settings → Scan tokens should now show `<name> · last used <just now>`, and the web service's
   logs should have `"auth":"token"` on the `scan: ingested` line (no deprecation warning).
4. Remove `SCANNER_TOKEN` and `SCANNER_ORG_ID` from the web service's environment and
   restart it. From then on only scan tokens are accepted.

## Troubleshooting

| Symptom                                 | Cause                                             | Fix                                                     |
| --------------------------------------- | ------------------------------------------------- | ------------------------------------------------------- |
| `HTTP 401 Unauthorized`                 | Unknown token (typo, other instance, deleted org) | Create a token in Settings, paste it into `BRIFF_TOKEN` |
| `HTTP 401 This scan token was revoked.` | The token was revoked in Settings                 | Create a new token, replace `BRIFF_TOKEN`               |
| `HTTP 409 No org exists yet`            | Legacy `SCANNER_TOKEN` and nobody has signed up   | Sign up, then switch to a scan token                    |
| `npm: not found` in the journal         | Node is not on the login-shell PATH               | Check `sh -lc 'which npm'`; adjust `ExecStart`          |
| A repo is missing                       | No lockfile or runtime file, or it is a worktree  | `npm run scan:local -- --dry-run` shows what was found  |
| A runtime shows as `image ...`          | The image is not in `IMAGE_RUNTIMES`              | Add it in `packages/scan/src/runtimes.ts` with a test   |

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

### Cargo (crates.io)

`Cargo.lock` v3/v4 supplies crates.io pins. `Cargo.toml` dependencies, development and
build dependencies (including target sections) identify direct crates. Workspace member
manifests and inherited workspace dependencies are read through the same file filter in
the CLI and GitHub App. Renamed dependencies keep their registry package names. Path,
Git and alternate-registry pins are excluded. Workspace member patterns support `*` in
one directory segment; manifests beyond the scanner's depth limit are not read.

OSV uses `crates.io`. Fixes use `cargo update -p <crate>@<installed> --precise <fix>`
to preserve manifest sections and disambiguate installed versions. Cargo may require a
manual manifest constraint edit if the existing requirement excludes the fixed version.
Transitive advice uses `cargo tree -i <crate>`; fixes never cross the installed release line.
Registry refresh uses the crates.io API with a User-Agent, `max_stable_version`, yanked
status and repository links. A package with no available stable release has no latest
version; all-yanked packages are marked accordingly. Existing mixed-ecosystem tags apply
to Stack, Repos and Alerts.

### RubyGems (Bundler)

`Gemfile.lock` GEM specs supply installed RubyGems versions; DEPENDENCIES supplies the
direct set. Platform builds of one version collapse into one pin. Git and path sources
are excluded. Literal `gem` declarations in `Gemfile` inside development/test groups
(or with `group:` / `groups:`) mark direct gems as development-only; a production
declaration wins. Gemfiles are inspected as text, never evaluated, so computed Ruby
declarations and imported Gemfiles cannot supply group information.

OSV queries use `RubyGems`. Fixes keep the existing declaration and its groups: set its
version requirement to `"~> X.Y.Z"`, then run `bundle update <gem> --conservative`. The
bounded requirement prevents a major upgrade while allowing the patched release. Briff
uses this instead of `bundle add`, which could change declaration groups, or an unbounded
update, which could select another major. Transitive-only advice uses
`bundle exec gem dependency <gem> --reverse-dependencies`.

Registry refresh reads RubyGems.org `gems/<gem>.json` for repository/homepage links and
`versions/<gem>/latest.json` for the latest available release (yanked releases are absent).
RubyGems exposes no package deprecation status; Briff leaves it unset. Non-semver Ruby
versions are retained as written; a version the fix rules cannot compare gets advisory
reading advice rather than a guessed upgrade.

### Organisation capacity

New organisations can store 10 repositories and 2 streams, including the default
stream. All stored repos count, including excluded ones. Existing repositories can
still refresh at capacity. A new repo over capacity gets HTTP 409 with
`Repository limit reached (10)`; the CLI and GitHub Action print that message and
exit 1 after sending all chunks. Existing repos refresh even when a rejected new
repo appears earlier in the upload; accepted repos are retained. The API reports
capacity errors with `code: "REPO_LIMIT"`, the accepted `repos` and rejected names.
Remove an unused repo or ask the instance admin to raise the limit, then
rerun the scan. The Admin page can raise both limits.

### Maven and Gradle

OSV uses `Maven`, with package names `group:artifact`. POM dependencies with literal
versions or locally resolved properties are direct; local parents supply properties and
dependency management. Managed entries alone are not installed packages. Module POMs are
read within the normal depth and directory limits. External parents and imported BOMs are
not downloaded by the scanner; unresolved versions are skipped.

Gradle uses `gradle.lockfile` pins when present, including transitive packages. Without a
lock it reads literal coordinates in `build.gradle(.kts)` and `gradle/libs.versions.toml`.
It never executes Maven, Gradle, plugins or build scripts. Dynamic versions and ranges are
skipped. Without a lock, declared versions are evidence rather than a resolved graph.
Non-semver Maven versions are retained for OSV but cannot produce automatic fix targets.

Fix guidance names the declaration file and a safe version on the installed release line;
edit the version or its controlling property/catalog entry and resolve dependencies. A
transitive dependency uses `mvn dependency:tree`, or
`./gradlew dependencies --configuration runtimeClasspath` for Gradle. Registry refresh uses
Maven Central search for latestVersion and the published POM's SCM link for GitHub releases.
Central provides no package-wide deprecation or yank field, so those remain unset.

## NuGet

`packages.lock.json` supplies installed versions and `Direct`/`Transitive` ownership per
framework. Project declarations are a fallback only in directories without a lockfile:
`*.csproj` PackageReference versions and VersionOverride, including child XML elements,
local properties, exact bracket pins and the closest `Directory.Packages.props`
PackageVersion entries when ManagePackageVersionsCentrally is true. Unused central entries
are not dependencies. Names are case-insensitive and stored lower-case. Dynamic ranges,
external MSBuild imports and expressions are not evaluated; no restore or build executes.
A literal unlocked version is declaration evidence rather than a verified restore result;
commit a lockfile for the resolved transitive set. Several conditional/framework pins are
retained, and duplicate pins merge their owning project paths. Later unconditional property
assignments replace earlier values. Conditional child versions retain their central or explicit
fallback unless simple TargetFramework equality conditions cover every declared framework.
Other conditions are retained as alternatives rather than evaluated as MSBuild expressions.

OSV uses `NuGet`. Direct fixes use `dotnet add <project.csproj> package <id> --version X`
for every recorded owning project. Conditional or multi-target declarations instead get an
instruction to edit only declarations on the target release line, preserving other framework
conditions and versions; project-wide add commands cannot safely express that change.
Transitive guidance uses `dotnet nuget why <project.csproj>
<id>`. The target remains on the installed release line. No development flag is inferred
from PrivateAssets: it controls propagation, not whether the dependency runs in production.

## Dart and Flutter (Pub)

`pubspec.lock` supplies hosted pub.dev versions and `direct main` / `direct dev` /
`transitive` ownership. The sibling `pubspec.yaml` selects Flutter when its dependencies
include the Flutter SDK, otherwise Dart. Without a lock, manifest ranges remain unresolved:
they match releases but never become installed versions in OSV queries. SDK, git, path and
custom registry packages are skipped. No Dart or Flutter process runs during scanning.

OSV uses `Pub`. Direct fixes first set the existing declaration to `^X` in each owning
pubspec, preserving dev_dependencies, then run `dart pub upgrade <pkg>` or
`flutter pub upgrade <pkg>` in that directory. The caret prevents a higher release line,
including for 0.x. Transitive guidance is `dart pub deps`. `Dependency.project` records
comma-separated `pubspec.yaml:dart` / `pubspec.yaml:flutter` owners so mixed repositories
keep their own tools. Registry refresh uses pub.dev latest, isDiscontinued and the pubspec
repository/homepage link; retracted latest releases are not recommended. Stack, Repos and
Alerts use the shared Pub ecosystem tag.
