# Connect repos

Briff learns your stack from scans. Every scanner sends the same thing: per repo, the repo name,
`{package, installed version, direct}` from lockfiles and `{runtime, version, file}` from version
files, Dockerfiles and compose files. No source code and no file contents leave the repo.

Open **Connect repos** in the top bar (on your first sign-in, the onboarding page shows the same
steps). It has three tabs.

| Way            | Best for                                       | Setup                                          |
| -------------- | ---------------------------------------------- | ---------------------------------------------- |
| GitHub App     | Repos on GitHub, scanned on every push         | Install the app; no token, no workflow         |
| GitHub Action  | One repo at a time, or when the app is not set | A scan token as a repo secret and one workflow |
| briff-scan CLI | Any folder of repos, any machine with Node 20+ | A scan token; run it by hand, from cron or CI  |

## GitHub App

The tab appears only when the instance has a GitHub App configured. app.briff.dev has one; a
self-hosted instance needs its own app (see [GitHub App setup](../GITHUB-APP.md#runbook-create-the-app)).

1. Click **Connect GitHub** and choose the account and the repos on GitHub.
2. Back in Briff the installation shows as **Connected**. Briff scans the selected repos right
   away, again when you add repos to the installation, and after every push to a repo's default
   branch that changes a file the scanner reads.

The app asks for read-only access to contents and metadata and fetches only the files listed in
[What Briff reads](../GITHUB-APP.md#what-briff-reads).

## GitHub Action

1. Create a scan token: **Create token** on the tab, or Settings → Scan tokens → New token. The
   secret (`brf_` and 40 characters) is shown once.
2. Store it in the repo as the Actions secret `BRIFF_TOKEN`:

   ```bash
   gh secret set BRIFF_TOKEN
   ```

3. Commit the workflow the tab shows as `.github/workflows/briff.yml`. It already carries this
   instance's URL, scans on every push to `main` and on Mondays at 03:00 UTC, before the
   bulletin. The full file and what each line does: [GitHub Action](../SCANNER.md#github-action).

One token can serve every repo. A repo the Action uploads and the same repo scanned by the
GitHub App are one Briff repo.

## briff-scan CLI

Start with a dry run: it lists what it found and sends nothing.

```bash
cd ~/code/my-site
npx briff-scan@0 --dry-run
BRIFF_TOKEN=brf_... npx briff-scan@0                              # this repo
BRIFF_TOKEN=brf_... npx briff-scan@0 --all-repos --root ~/code    # every git repo under ~/code
```

The CLI uploads to `https://app.briff.dev` unless `BRIFF_API_URL` (or `--api`) names your own
instance. Options, exit codes and a daily systemd timer: [briff-scan CLI](../SCANNER.md#local-cli).

> **Note**
> A repo scanned by the CLI is a separate Briff repo from the same repo scanned on GitHub
> (`owner/repo` there, the folder name here). Skip a repo GitHub already covers with
> `--exclude <name>`.

## Put repos in a stream

New repos show up on **Repos** marked **New** and stay out of bulletins and security alerts until
they are in a stream. The connect steps end with **Pick repos**, which opens **Streams**: tick
the repos the stream should cover and save. A new organisation has one stream, "Weekly"; add more
(one per client or team) with **New stream**. Each stream gets its own bulletin.
