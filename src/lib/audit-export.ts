import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { EVENT_TYPE_NAMES } from "@/lib/org-events";

// Settings → Members → "Export audit log (CSV)": every OrgEvent of the org, oldest first, read
// through withOrg a page at a time.

export const AUDIT_CSV_HEADER = ["createdAt", "type", "actorEmail", "targetEmail", "detail"];
const PAGE = 500;

/** RFC 4180 quoting; a leading = + - @ is defused so a spreadsheet never runs it as a formula. */
export function csvCell(value: string | null): string {
  const text = value ?? "";
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function csvRow(cells: (string | null)[]): string {
  return `${cells.map(csvCell).join(",")}\r\n`;
}

export function auditCsvStream(db: PrismaClient, orgId: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const scoped = withOrg(db, orgId);
  let cursor: string | null = null;
  let started = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!started) {
        started = true;
        controller.enqueue(encoder.encode(csvRow(AUDIT_CSV_HEADER)));
        return;
      }
      const rows = await scoped.orgEvent.findMany({
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: PAGE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          createdAt: true,
          type: true,
          targetEmail: true,
          detail: true,
          actor: { select: { email: true } },
        },
      });
      if (rows.length === 0) {
        controller.close();
        return;
      }
      cursor = rows[rows.length - 1].id;
      controller.enqueue(
        encoder.encode(
          rows
            .map((r) =>
              csvRow([
                r.createdAt.toISOString(),
                EVENT_TYPE_NAMES[r.type],
                r.actor?.email ?? null,
                r.targetEmail,
                r.detail,
              ])
            )
            .join("")
        )
      );
      if (rows.length < PAGE) controller.close();
    },
  });
}
