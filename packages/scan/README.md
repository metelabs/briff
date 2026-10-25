# briff-scan

The scanner for [Briff](https://briff.dev), the weekly briefing built from your own stack.
It reads a repo's lockfiles and runtime files and sends Briff the package names, installed
versions and runtimes it finds. **No source code and no file contents leave the machine.**

## What it sends

For each repo: `{ name, version, direct }` per installed package and
`{ runtime, version, file }` per declared runtime, plus the repo name. Nothing else.

- Lockfiles: `package-lock.json` / `npm-shrinkwrap.json` (v1–v3), `pnpm-lock.yaml` (v5–v9),
  `yarn.lock` (v1 and Berry), `composer.lock` (PHP), `poetry.lock`, `uv.lock`, `Pipfile.lock`,
  `requirements*.txt` (Python), `go.mod` (Go). Installed versions come from the lockfile, never
  from ranges; a
  requirements line without an exact `==` pin is sent as `unresolved` with the requirement.
- Runtimes: `.nvmrc`, `.node-version`, `package.json` engines/volta, `composer.json` /
  `composer.lock`, `.python-version`, `pyproject.toml`, `runtime.txt`, `Pipfile`, `go.mod`,
  `.ruby-version`, `Gemfile.lock`, `pom.xml`, Gradle files, `.sdkmanrc`, `global.json`,
  `*.csproj`, `rust-toolchain(.toml)`, `Cargo.toml`, `.tool-versions`, `mise.toml`, and every
  `FROM` / `image:` in Dockerfiles and compose files.
- `node_modules`, build output, test fixtures and dot-directories are skipped.

Run `npx briff-scan@0 --dry-run --json` to see the exact payload before sending anything.

## GitHub Actions

Create a scan token in Briff (onboarding, or Settings → Scan tokens), add it to the repo as the
secret `BRIFF_TOKEN`, and commit `.github/workflows/briff.yml`:

```yaml
name: briff
on:
  push: { branches: [main] }
  schedule:
    - cron: "0 3 * * 1" # Mondays 03:00 UTC, before the bulletin
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 22
          check-latest: true # newest 22.x, not the runner's cached one
          package-manager-cache: false
      - run: npx briff-scan@0
        env:
          BRIFF_API_URL: https://app.briff.dev
          BRIFF_TOKEN: ${{ secrets.BRIFF_TOKEN }}
```

In Actions it scans the checked-out repo and names it `owner/repo`.

## Local use

Node 20 or later.

```bash
npx briff-scan@0 --dry-run                                  # this repo; sends nothing
BRIFF_TOKEN=brf_... npx briff-scan@0                        # upload this repo
BRIFF_TOKEN=brf_... npx briff-scan@0 --all-repos --root ~/code   # every git repo in a folder
```

## Options

| Option                | Env             | Default                                              |
| --------------------- | --------------- | ---------------------------------------------------- |
| `--api <url>`         | `BRIFF_API_URL` | `https://app.briff.dev`                              |
| `--token <token>`     | `BRIFF_TOKEN`   | required unless `--dry-run`                          |
| `--root <dir>`        |                 | current directory                                    |
| `--repo-name <name>`  |                 | `GITHUB_REPOSITORY` in Actions, else the folder name |
| `--all-repos`         |                 | off: the root is one repo                            |
| `--include-worktrees` |                 | off (with `--all-repos`)                             |
| `--exclude <name>`    |                 | none; repeatable or comma-separated                  |
| `--max-depth <n>`     |                 | 6                                                    |
| `--chunk <n>`         |                 | 10 repos per upload (with `--all-repos`)             |
| `--dry-run`           |                 | off                                                  |
| `--json`              |                 | off: machine-readable output                         |

`--exclude` skips a repo by the exact name Briff would get: its path under `--root` with
`--all-repos` (`--exclude work/site,old-app`), else the `--repo-name` / folder name. Use it on a
machine that scans a folder of repos when one of them already runs the GitHub Action, so it is
not uploaded twice.

Exit codes: 0 done, 1 the scan or upload failed, 2 bad options.

## Licence

MIT. The bundle includes [yaml](https://github.com/eemeli/yaml) (ISC); its licence is at the
end of `dist/cli.mjs`.
