// Incidents the public /status page lists, newest first. Add one when users were affected:
// what broke, when (UTC), and what was done. Plain data, no database.

export interface Incident {
  /** ISO date, e.g. "2026-11-02". */
  date: string;
  title: string;
  summary: string;
}

export const INCIDENTS: readonly Incident[] = [];
