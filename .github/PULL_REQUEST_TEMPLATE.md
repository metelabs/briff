## What and why

<!-- What changes, and the reason. Link the issue if there is one. -->

## How it was checked

<!-- Commands run and what they showed; for UI changes, a screenshot. -->

- [ ] `npm run typecheck && npm run lint && npm test`
- [ ] DB-backed tests with `TEST_DATABASE_URL` (when the change touches the database, jobs or delivery)
- [ ] A Vitest test for every behaviour change; a fixture for every parser or adapter change
- [ ] `npm run replay` rerun if a scenario, template or pipeline sentence changed
- [ ] Prompt version bumped if a prompt in `src/llm/prompts/` changed
- [ ] `.env.example` updated if an environment variable was added or changed
- [ ] No real repo names, customer domains, hosts or email addresses in fixtures or docs
