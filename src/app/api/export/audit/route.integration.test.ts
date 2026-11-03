import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { OrgContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { withOrg } from "@/lib/db/with-org";
import { resetEnvCache } from "@/lib/env";
import { createOrgForUser } from "@/lib/org";

import { GET } from "./route";

let session: OrgContext | null = null;
vi.mock("@/lib/auth/session", () => ({ getOrgContext: async () => session }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("GET /api/export/audit", () => {
  const suffix = Date.now().toString(36);
  const saved = process.env.DATABASE_URL;
  const alice = `u-audit-a-${suffix}`;
  const bob = `u-audit-b-${suffix}`;
  const carol = `u-audit-c-${suffix}`;
  let mine = "";
  let other = "";

  const as = (userId: string, orgId: string, role: "owner" | "member"): OrgContext => ({
    userId,
    email: `${userId}@example.com`,
    name: userId,
    emailVerified: true,
    orgId,
    role,
  });

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    const db = getDb();
    for (const id of [alice, bob, carol]) {
      await db.user.create({ data: { id, name: id, email: `${id}@example.com` } });
    }
    mine = await createOrgForUser(db, { name: `audit-mine-${suffix}`, userId: alice });
    other = await createOrgForUser(db, { name: `audit-other-${suffix}`, userId: bob });
    await withOrg(db, mine).orgMember.create({
      data: { orgId: mine, userId: carol, role: "member" },
    });
    await withOrg(db, mine).orgEvent.create({
      data: {
        orgId: mine,
        actorUserId: alice,
        type: "role_changed",
        targetEmail: `${carol}@example.com`,
        detail: '=HYPERLINK("x","y")',
      },
    });
    await withOrg(db, other).orgEvent.create({
      data: {
        orgId: other,
        actorUserId: bob,
        type: "org_renamed",
        detail: `other-secret-${suffix}`,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  afterAll(async () => {
    await getDb().org.deleteMany({ where: { id: { in: [mine, other] } } });
    await getDb().user.deleteMany({ where: { id: { in: [alice, bob, carol] } } });
    process.env.DATABASE_URL = saved;
  });

  it("is 401 without a session and 403 for a member", async () => {
    session = null;
    expect((await GET()).status).toBe(401);
    session = as(carol, mine, "member");
    expect((await GET()).status).toBe(403);
  });

  it("is 403 on a hosted plan without the export", async () => {
    vi.stubEnv("BRIFF_CLOUD", "true");
    resetEnvCache();
    session = as(alice, mine, "owner");
    const res = await GET();
    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/included in Team/);
  });

  it("streams only the session org's events as CSV and records the export", async () => {
    vi.stubEnv("BRIFF_CLOUD", "true");
    resetEnvCache();
    await getDb().org.update({ where: { id: mine }, data: { plan: "team" } });
    session = as(alice, mine, "owner");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="briff-audit-\d{4}-\d{2}-\d{2}\.csv"$/
    );
    const lines = (await res.text()).trimEnd().split("\r\n");
    expect(lines[0]).toBe('"createdAt","type","actorEmail","targetEmail","detail"');
    const body = lines.slice(1).join("\n");
    expect(body).toContain(`"org.created","${alice}@example.com"`);
    expect(body).toContain(
      `"role.changed","${alice}@example.com","${carol}@example.com","'=HYPERLINK(""x"",""y"")"`
    );
    expect(body).toContain(`"audit.exported","${alice}@example.com"`);
    expect(body).not.toContain(`other-secret-${suffix}`);
    expect(body).not.toContain(bob);
  });
});
