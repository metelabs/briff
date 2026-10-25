# Contributing to Briff

Thanks for helping. Bug reports, missed sources and small focused pull requests are the most
useful contributions. For a larger change, open an issue first so the approach can be agreed
before you write it.

Everything in the repository and on GitHub is in **English**: code, comments, commit messages,
pull request text and review replies.

## Setup

Node 22, npm, Docker (for Postgres).

```bash
git clone https://github.com/metelabs/briff.git && cd briff
docker compose up -d                  # Postgres 16 on 127.0.0.1:55432
cp .env.example .env                  # set BETTER_AUTH_SECRET (openssl rand -base64 48)
npm ci                                # also runs prisma generate
npm run db:migrate                    # prisma migrate dev
npm run dev                           # web on http://localhost:3000
npm run dev:worker                    # worker, restarts on change
```

Set `BRIFF_LLM_FAKE=true` in `.env` to work without an Anthropic key (a deterministic stand-in;
refused in production). Without SMTP variables no email is sent; `npm run email:preview -- --out
/tmp/briff-mail` renders the templates to files instead. `npm run worker -- --once <job> ...`
enqueues jobs, drains them and exits.

Architecture, data model rules and conventions are in [CLAUDE.md](CLAUDE.md). It is written
for coding agents and people alike; read it before changing the pipeline, the tenant layer or
delivery code. [AGENTS.md](AGENTS.md) lists what a review flags.

## Tests

```bash
npm run typecheck && npm run lint && npm test
```

DB-backed tests (`*.integration.test.ts`) are skipped unless `TEST_DATABASE_URL` points at a
disposable database with the migrations applied. They delete and create rows freely, so never
point it at a database you care about:

```bash
docker run -d --rm --name briff-test -e POSTGRES_USER=briff -e POSTGRES_PASSWORD=briff \
  -e POSTGRES_DB=briff -p 127.0.0.1:55433:5432 postgres:16-alpine
DATABASE_URL=postgresql://briff:briff@127.0.0.1:55433/briff npx prisma migrate deploy
TEST_DATABASE_URL=postgresql://briff:briff@127.0.0.1:55433/briff npm test
```

CI runs all of the above on every pull request.

- Every behaviour change comes with a Vitest test; a parser or source adapter change comes
  with a fixture.
- Fixtures and docs use synthetic names (`acme/web`, `*.example`). `src/test/private-names.test.ts`
  rejects known private names and real email addresses.
- A change to a replay scenario, an email template or a pipeline sentence needs
  `npm run replay -- <scenario> --out docs/replay/<scenario>.html`; the committed pages must
  equal the rendered output.
- A change to a prompt in `src/llm/prompts/` bumps its `<!-- version: ... -->` line.
- A new environment variable is read through `getEnv()` and documented in `.env.example`.

## Commits and pull requests

- [Conventional commits](https://www.conventionalcommits.org/): `feat(scope): ...`,
  `fix(scope): ...`, `docs: ...`, `chore: ...`. The type matters: release-please derives the
  version and the changelog from it (`feat` bumps the minor, `fix` the patch while pre-1.0).
  Write the reason in the commit body, not only what changed.
- One topic per pull request, branched from `main`. Fill in the template's checklist.
- Every pull request gets an automated review from Codex (the maintainer requests one with an
  `@codex review` comment when it does not start by itself). Each finding is either fixed or
  answered in its thread before merge; CI must be green.
- Pull requests are squash-merged. Do not edit `CHANGELOG.md` or the version in `package.json`;
  release-please owns them.

## Licensing of contributions

The repository is `AGPL-3.0-only`, except `packages/scan`, which is MIT. By opening a pull
request you agree that your contribution is licensed under the license of the directory it
changes.
