import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { OrgContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { createOrgForUser } from "@/lib/org";

import { GET } from "./route";

let session: OrgContext | null = null;
vi.mock("@/lib/auth/session", () => ({ getOrgContext: async () => session }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("GET /api/export", () => {
  const suffix = Date.now().toString(36);
  const saved = process.env.DATABASE_URL;
  let orgId = "";
  const userId = `u-export-${suffix}`;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    await getDb().user.create({
      data: { id: userId, name: "Exporter", email: `export-${suffix}@example.com` },
    });
    orgId = await createOrgForUser(getDb(), { name: `export-org-${suffix}`, userId });
  });

  afterAll(async () => {
    await getDb().org.deleteMany({ where: { id: orgId } });
    await getDb().user.deleteMany({ where: { id: userId } });
    process.env.DATABASE_URL = saved;
  });

  it("is 401 without a session", async () => {
    session = null;
    expect((await GET()).status).toBe(401);
  });

  it("downloads the session's org as a JSON attachment", async () => {
    session = { userId, email: "e", name: "n", emailVerified: true, orgId };
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="briff-export-\d{4}-\d{2}-\d{2}\.json"$/
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { org: { id: string }; streams: unknown[] };
    expect(body.org.id).toBe(orgId);
    expect(body.streams).toHaveLength(1);
  });
});
