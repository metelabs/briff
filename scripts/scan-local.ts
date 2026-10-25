// Scans a folder of repos (default ~/code) with the briff-scan package and uploads to Briff.
// Kept for the systemd unit (deploy/systemd/briff-scan.service), which runs
// `npm run scan:local` from a Briff checkout; the scanner itself is packages/scan.
// Run: npm run scan:local -- [--root ~/code] [--dry-run] [--include-worktrees] [--exclude name]
// Env: BRIFF_SCAN_ROOT, BRIFF_SCAN_EXCLUDE (comma list of repo names, e.g. repos the GitHub
// Action already scans), BRIFF_TOKEN, BRIFF_API_URL.
import { run } from "../packages/scan/src/run";

import { scanLocalArgs } from "./scan-local-args";

void run(
  scanLocalArgs(process.argv.slice(2), process.env),
  {
    ...process.env,
    // SCANNER_TOKEN is the deprecated instance-wide token; BRIFF_TOKEN is a per-org scan token.
    BRIFF_TOKEN: process.env.BRIFF_TOKEN || process.env.SCANNER_TOKEN,
  },
  { out: (line) => console.log(line), err: (line) => console.error(line), cwd: process.cwd() }
).then((code) => {
  process.exitCode = code;
});
