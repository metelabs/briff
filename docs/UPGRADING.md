# Upgrading Briff

## How versions work

- Releases are cut by [release-please](https://github.com/googleapis/release-please) from
  conventional commits on `main`. Each release has a GitHub release, a `CHANGELOG.md` entry
  and a git tag **without `v`** (`0.7.3`, not `v0.7.3`).
- The release builds one image, `ghcr.io/metelabs/briff`, tagged `<version>` (e.g. `0.7.3`),
  `sha-<commit>` and `latest`. `latest` follows the newest build (it can also move on an
  emergency build of `main` without a release), so pin a version with `BRIFF_VERSION` in
  `.env` for anything you rely on.
- Before 1.0 a `feat` release bumps the minor (`0.7.x` → `0.8.0`) and a `fix` release the patch.
  A breaking change is marked `BREAKING CHANGE` in its commit and listed in the release notes
  and below.

## The rules

1. **Always read the release notes** (GitHub releases or `CHANGELOG.md`) of every version
   between yours and the target, and this file's section for any of them.
2. **Migrations are automatic.** The `web` service runs `prisma migrate deploy` on start
   (`MIGRATE_ON_START=false` to skip). There is no manual schema step; take a backup before
   upgrading anyway (docs/SELF-HOSTING.md, "Backup and restore"). Downgrades are not supported:
   to go back, restore the backup taken before the upgrade and run the old tag.
3. **`web` and `worker` must run the same tag.** With `compose.yaml` both use
   `BRIFF_VERSION`, and the worker starts only after `web` is healthy, i.e. after the
   migrations of the new version are applied. On another platform, deploy `web` first, then
   `worker` on the same tag.

```bash
cd /opt/briff
docker compose exec -T postgres pg_dump -U briff -d briff --clean --if-exists > "briff-$(date +%F).sql"
sed -i "s|^BRIFF_VERSION=.*|BRIFF_VERSION=<new version>|" .env
docker compose pull && docker compose up -d
docker compose ps        # web and worker healthy on the new tag
```

## Breaking changes

None so far: no release up to 0.7.3 has needed an operator step beyond pulling the new image.
New variables have all been optional, and their defaults keep the previous behaviour.

Deprecations (still working, plan to remove the variable):

- **0.3.0: `SCANNER_TOKEN` / `SCANNER_ORG_ID`.** Per-org scan tokens (Settings → Scan tokens)
  replace the instance-wide token; uploads with it log a warning. Switch each scanner
  (docs/SCANNER.md, "Switch a scanner from SCANNER_TOKEN"), then remove both variables.

A future breaking change gets a section here in this form:

```markdown
### X.Y.0: <short title>

- **Who is affected:** <which setups>
- **What changes:** <behaviour, variable or file>
- **Before upgrading:** <steps, with commands>
- **After upgrading:** <how to verify>
```
