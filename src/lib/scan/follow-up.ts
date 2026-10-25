// When the runtime urgent pass may run after a scan upload. The scanner uploads in
// chunks; a pass that runs after the first chunk emails only the repos known by then
// (incident of 23 Oct 2026: 7 of 14 node repos). The pass is a collect-sources job
// (`{ due: true, rematchOrgId }`, one pending job per org) that reconciles the org's
// runtime security matches and then delivers. A completed scan always gets one, whether
// or not an upload reported new runtimes: reconciliation compares state, so it also
// catches repos an earlier pass missed. Its start is moved:
//   - session upload, not final: pushed SESSION_TIMEOUT_MS ahead, a safety net for a
//     scanner that dies before its final upload;
//   - final upload: moved to now;
//   - upload without a session (older scanner): pushed DEBOUNCE_MS ahead, so the chunks
//     of one run collapse into one pass after the last of them.
// The hourly collect reconciles every org as well, so a missed scan pass costs an hour at most.

export const SCAN_DEBOUNCE_MS = 2 * 60_000;
export const SCAN_SESSION_TIMEOUT_MS = 15 * 60_000;

export interface ScanUploadFacts {
  scanId?: string;
  final?: boolean;
}

export interface ScanFollowUp {
  runAfter: Date;
}

export function scanFollowUp(upload: ScanUploadFacts, now: Date): ScanFollowUp {
  const at = (ms: number) => new Date(now.getTime() + ms);
  if (upload.scanId && upload.final) return { runAfter: now };
  return { runAfter: at(upload.scanId ? SCAN_SESSION_TIMEOUT_MS : SCAN_DEBOUNCE_MS) };
}

/** One pending urgent pass per org. */
export function scanFollowUpKey(orgId: string): string {
  return `collect-sources:scan:${orgId}`;
}
