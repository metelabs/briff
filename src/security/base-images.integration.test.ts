import { prepareStream } from "@/pipeline/weekly";
import { readFileSync } from "node:fs";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, describe, expect, it, vi } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import { withOrg } from "@/lib/db/with-org";
import { resetEnvCache } from "@/lib/env";
import { log } from "@/lib/log";
import { ingestScan } from "@/lib/scan/ingest";
import { osvVulnSchema } from "@/sources/osv";
import { collectFromFiles } from "@scan/collect";

import { baseImageScan } from "./base-images";
import { loadBaseImageGroups } from "./base-image-view";

const mail = vi.hoisted(() => ({ sent: 0 }));
vi.mock("@/lib/email/mailer", () => ({
  smtpConfig: () => ({ host: "example.com" }),
  sendMail: async () => {
    mail.sent++;
    return { status: "sent" };
  },
}));
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("base image scan against Postgres", () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });
  const orgs: string[] = [];
  const users: string[] = [];
  afterAll(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetEnvCache();
    await db.org.deleteMany({ where: { id: { in: orgs } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  });
  it("groups candidates by image, scopes tenants, honors opt-outs and emails a candidate once", async () => {
    vi.stubEnv("DATABASE_URL", url ?? "");
    vi.stubEnv("BETTER_AUTH_SECRET", "synthetic-test-secret-with-at-least-32-characters");
    vi.stubEnv("BETTER_AUTH_URL", "https://example.com");
    resetEnvCache();
    const raw = JSON.parse(
      readFileSync(new URL("./__fixtures__/base-images.json", import.meta.url), "utf8")
    ) as { vulns: unknown[] };
    const recorded = raw.vulns.map((v) => osvVulnSchema.parse(v));
    const vuln = {
      ...recorded[0],
      id: `CVE-ACME-${Date.now()}`,
      database_specific: { severity: "HIGH" },
    };
    let queries = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        if (String(input) !== "https://api.osv.dev/v1/query") throw new Error("Unexpected request");
        queries++;
        const body = JSON.parse(String(init?.body)) as {
          package: { name: string; ecosystem: string };
        };
        expect(body).not.toHaveProperty("version");
        return Response.json({
          vulns:
            body.package.ecosystem === "Debian:12" && body.package.name === "openssl" ? [vuln] : [],
        });
      })
    );
    const user = await db.user.create({
      data: { id: `base-${Date.now()}`, name: "Acme", email: `base-${Date.now()}@example.com` },
    });
    users.push(user.id);
    for (const enabled of [true, false]) {
      const org = await db.org.create({ data: { name: "acme", baseImageAlerts: enabled } });
      orgs.push(org.id);
      const scoped = withOrg(db, org.id);
      await scoped.orgMember.create({ data: { orgId: org.id, userId: user.id } });
      const repo = await collectFromFiles(
        "acme/web",
        { Dockerfile: "FROM node:22-bookworm-slim\nFROM debian:12" },
        { warn: () => undefined }
      );
      if (!repo) throw new Error("Missing fixture repo");
      await ingestScan(db, org.id, { source: "github", repos: [repo] });
      await scoped.repo.updateMany({ data: { included: true } });
    }
    const context = {
      db,
      log,
      jobId: "base-images-test",
      payload: {},
      heartbeat: async () => undefined,
    };
    await baseImageScan(context);
    const enabled = withOrg(db, orgs[0]);
    expect(await enabled.baseImageAlert.count()).toBe(2);
    expect(await withOrg(db, orgs[1]).baseImageAlert.count()).toBe(0);
    expect(
      (await loadBaseImageGroups(db, orgs[0], { included: true })).map((g) => g.image)
    ).toEqual(["debian:12", "node:22-bookworm-slim"]);
    expect(await loadBaseImageGroups(db, orgs[1], { included: true })).toEqual([]);
    expect(mail.sent).toBe(1);
    expect(await enabled.baseImageAlert.count({ where: { deliveredAt: null } })).toBe(0);
    await baseImageScan(context);
    expect(await enabled.baseImageAlert.count()).toBe(2);
    expect(mail.sent).toBe(1);
    const stream = await enabled.bulletinStream.create({
      data: { orgId: orgs[0], name: "Weekly", slug: "weekly" },
    });
    const repo = await enabled.repo.findFirstOrThrow();
    await enabled.streamRepo.create({
      data: { orgId: orgs[0], streamId: stream.id, repoId: repo.id },
    });
    const now = new Date(Date.now() + 1000);
    expect(
      await prepareStream(
        db,
        orgs[0],
        { id: stream.id, name: stream.name, repoIds: [repo.id] },
        {
          now,
          weekStart: now,
          week: "W44",
          language: "en",
          model: "synthetic",
          promptVersion: "synthetic",
        }
      )
    ).not.toBeNull();
    expect(queries).toBeGreaterThan(0);
  });
});
