// Backlog review: first-scan backlog alerts (Alert.kind = backlog) a member marked as
// reviewed are hidden from the default Alerts view and the home counts, and listed again
// behind "Show reviewed". New alerts are never hidden, and nothing here touches delivery:
// deliveredAt and the urgent emails do not read reviewedAt.

export interface ReviewableAlert {
  kind: string;
  reviewedAt: Date | null;
}

export function isReviewedBacklog(alert: ReviewableAlert): boolean {
  return alert.kind === "backlog" && alert.reviewedAt !== null;
}

/** The default view's rows (`open`) and the reviewed backlog, order kept. */
export function splitReviewed<T extends ReviewableAlert>(
  rows: readonly T[]
): { open: T[]; reviewed: T[] } {
  const open: T[] = [];
  const reviewed: T[] = [];
  for (const row of rows) (isReviewedBacklog(row) ? reviewed : open).push(row);
  return { open, reviewed };
}

/** The rows a "mark as reviewed" action may set: backlog alerts not yet reviewed. */
export const REVIEWABLE = { kind: "backlog", reviewedAt: null } as const;

/** `?reviewed=1` (or any value but 0/false) shows the reviewed backlog. */
export function showReviewedParam(value: string | string[] | undefined): boolean {
  const v = Array.isArray(value) ? value[0] : value;
  return v !== undefined && v !== "" && v !== "0" && v !== "false";
}
