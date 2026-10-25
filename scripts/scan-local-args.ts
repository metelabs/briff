// Arguments for `npm run scan:local` (scripts/scan-local.ts): briff-scan --all-repos over
// BRIFF_SCAN_ROOT (default ~/code), minus the repos in BRIFF_SCAN_EXCLUDE (a comma list),
// followed by the flags given on the command line.
export function scanLocalArgs(
  argv: readonly string[],
  env: Record<string, string | undefined>
): string[] {
  const hasRoot = argv.some((a) => a === "--root" || a.startsWith("--root="));
  const root = env.BRIFF_SCAN_ROOT || "~/code";
  const exclude = env.BRIFF_SCAN_EXCLUDE?.trim();
  return [
    "--all-repos",
    ...(hasRoot ? [] : ["--root", root]),
    ...(exclude ? ["--exclude", exclude] : []),
    ...argv,
  ];
}
