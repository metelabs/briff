<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Code Review Rules

Read `CLAUDE.md` first; it is the source of truth for conventions. Flag only what would break in production or contradict a rule below.

- Tenant data (OrgMember, Repo, Dependency, RepoRuntime, ItemMatch, Alert, Bulletin, BulletinItem, Feedback, InterestProfile, Deadline, BulletinStream, StreamRepo, ScanToken, GithubInstallation) must be read and written through `withOrg(getDb(), orgId)`. A nested relation write or raw SQL on these tables is a finding.
- Fix commands and derived actions never recommend a higher major than the installed release line. A command or sentence that crosses the line is a finding, with one exception: An end-of-life line gets the EOL sentence, which names the lowest supported line; that is the only derived action allowed to name a higher major, and it is worded as a migration, not a fix command. (`src/pipeline/runtime-fixes.ts`, "node 18 is end-of-life and will not get this fix; move to 22.23.4 or later"; an EOL line has no fix on its own major, so naming the supported line is the only truthful action.) An EOL sentence in command form (`npm i ...`, a `FROM`/image tag, "set node X") is a finding.
- An item's repos have one source: `BulletinItem.affectedRepos` is the item's `affected_repos` in the synthesis input (match repos in the stream, plus repos with an alert on the item's security package), and `BulletinItem.upgrades` names exactly those repos (`alignUpgrades`; a repo without a version on record reads "installed version unknown"). A path that builds upgrades, actions or lines from another repo list is a finding. A model line or action that names only some of the affected repos is repaired after the alias restore (`completeRepoNames`, `chooseAction`), never stored as written.
- Model output is accepted only for refs present in the synthesis input; any path where model text adds a URL, a version or a package the input did not contain is a finding.
- A security headline names the fix for the installed lines (`fixVersions` / `fix_versions`), not the feed release's version; a change that lets a headline name a release version outside `fixVersions` when that list is not empty is a finding. A line without a safe fix gets "read the advisory" in the command, never a version from another line.
- Jobs that can run longer than a few minutes must call `ctx.heartbeat()`; a loop that sends email or polls a batch without it is a finding.
- Nothing may be delivered twice: check `deliveredAt`, `urgentAt` and the batch `custom_id` mapping on every change to delivery code.
- Env is read through `getEnv()` at request or job time, never at module top level. No `NEXT_PUBLIC_*`, no secrets in build args.
- Upper-cased copy goes through `caps()`; CSS or Tailwind `uppercase` on user-facing text is a finding (Turkish locale turns "Security" into "SECURİTY").
- Every LLM prompt edit bumps the prompt version; every behaviour change ships a Vitest test. A change to a parser or adapter without a fixture is a finding.
- Code, comments, commit messages and PR text are English.
