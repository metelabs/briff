// Replays a scenario (src/replay/scenarios) and writes the static timeline page.
//   npm run replay -- php2shell --out docs/replay/php2shell.html
// No database, SMTP or LLM: the pipeline's pure functions run with a fake clock.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { runReplay } from "@/replay/engine";
import { renderReplayPage } from "@/replay/render";
import { SCENARIOS } from "@/replay/scenarios";

function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { out: { type: "string" } },
  });
  const id = positionals[0];
  const scenario = id ? SCENARIOS[id] : undefined;
  if (!scenario) {
    console.error(
      `usage: npm run replay -- <${Object.keys(SCENARIOS).join("|")}> [--out file.html]`
    );
    process.exit(1);
  }
  const result = runReplay(scenario);
  for (const e of result.entries) {
    if (!e.briffEmail) continue;
    const m = e.briffEmail;
    const delay = m.delayMinutes === null ? "" : ` (+${m.delayMinutes} min)`;
    console.log(`${m.at.toISOString()} ${m.kind}${delay}: ${m.subject}`);
  }
  if (result.untriaged.length > 0) {
    console.log(`left out (would need LLM triage): ${result.untriaged.join("; ")}`);
  }
  const out = path.resolve(values.out ?? `docs/replay/${scenario.id}.html`);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, renderReplayPage(result));
  console.log(`wrote ${path.relative(process.cwd(), out)}`);
}

main();
