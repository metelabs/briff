import { SCANNER_VERSION } from "@scan/version";

/** The npm major the workflow pins (`npx briff-scan@0`), so 0.x updates arrive by themselves. */
export const SCANNER_MAJOR = SCANNER_VERSION.split(".")[0];

export const WORKFLOW_PATH = ".github/workflows/briff.yml";

/** The GitHub Actions workflow shown in onboarding and docs/SCANNER.md (a test keeps them equal). */
export function scanWorkflowYaml(apiUrl: string): string {
  return `# Briff scan (briff-scan ${SCANNER_VERSION}, pinned to @${SCANNER_MAJOR})
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
      - run: npx briff-scan@${SCANNER_MAJOR}
        env:
          BRIFF_API_URL: ${apiUrl}
          BRIFF_TOKEN: \${{ secrets.BRIFF_TOKEN }}
`;
}

/** Shell commands for the local scanner; `token` is the fresh secret or a placeholder. */
export function localScanCommands(apiUrl: string, token: string) {
  const env = `BRIFF_API_URL=${apiUrl} BRIFF_TOKEN=${token}`;
  return {
    dryRun: `npx briff-scan@${SCANNER_MAJOR} --dry-run`,
    upload: `${env} npx briff-scan@${SCANNER_MAJOR}`,
    allRepos: `${env} npx briff-scan@${SCANNER_MAJOR} --all-repos --root ~/code`,
  };
}
