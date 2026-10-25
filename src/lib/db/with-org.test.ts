import { describe, expect, it } from "vitest";

import { isTenantModel, OrgScopeError, scopeArgs } from "./with-org";

const ORG = "org_a";

describe("scopeArgs", () => {
  it("adds orgId to reads", () => {
    for (const op of ["findMany", "findFirst", "findUnique", "count", "aggregate", "groupBy"]) {
      expect(scopeArgs(op, { where: { name: "x" } }, ORG).where).toEqual({ name: "x", orgId: ORG });
    }
  });

  it("adds a where clause when none was given", () => {
    expect(scopeArgs("findMany", undefined, ORG)).toEqual({ where: { orgId: ORG } });
  });

  it("rejects a where.orgId that points at another org", () => {
    expect(() => scopeArgs("findMany", { where: { orgId: "org_b" } }, ORG)).toThrow(OrgScopeError);
  });

  it("injects orgId into create and createMany data", () => {
    expect(scopeArgs("create", { data: { name: "r" } }, ORG).data).toEqual({
      name: "r",
      orgId: ORG,
    });
    expect(scopeArgs("createMany", { data: [{ a: 1 }, { a: 2 }] }, ORG).data).toEqual([
      { a: 1, orgId: ORG },
      { a: 2, orgId: ORG },
    ]);
  });

  it("refuses the org relation form and foreign orgIds on create", () => {
    expect(() => scopeArgs("create", { data: { org: { connect: { id: "x" } } } }, ORG)).toThrow(
      OrgScopeError
    );
    expect(() => scopeArgs("create", { data: { orgId: "org_b" } }, ORG)).toThrow(OrgScopeError);
  });

  it("scopes updates and deletes and blocks moving rows across orgs", () => {
    expect(scopeArgs("update", { where: { id: "1" }, data: { included: true } }, ORG)).toEqual({
      where: { id: "1", orgId: ORG },
      data: { included: true },
    });
    expect(scopeArgs("deleteMany", { where: { repoId: "r" } }, ORG).where).toEqual({
      repoId: "r",
      orgId: ORG,
    });
    expect(() => scopeArgs("updateMany", { where: {}, data: { orgId: "org_b" } }, ORG)).toThrow(
      OrgScopeError
    );
  });

  it("scopes all three parts of an upsert", () => {
    const out = scopeArgs(
      "upsert",
      { where: { id: "1" }, create: { name: "n" }, update: { name: "m" } },
      ORG
    );
    expect(out).toEqual({
      where: { id: "1", orgId: ORG },
      create: { name: "n", orgId: ORG },
      update: { name: "m" },
    });
  });

  it("fails closed on unknown operations and empty org ids", () => {
    expect(() => scopeArgs("$queryRaw", {}, ORG)).toThrow(OrgScopeError);
    expect(() => scopeArgs("findMany", {}, "")).toThrow(OrgScopeError);
  });
});

describe("isTenantModel", () => {
  it("knows which models are tenant-scoped", () => {
    expect(isTenantModel("Repo")).toBe(true);
    expect(isTenantModel("Dependency")).toBe(true);
    expect(isTenantModel("BulletinStream")).toBe(true);
    expect(isTenantModel("StreamRepo")).toBe(true);
    expect(isTenantModel("ScanToken")).toBe(true);
    expect(isTenantModel("RepoRuntime")).toBe(true);
    expect(isTenantModel("Package")).toBe(false);
    expect(isTenantModel("Job")).toBe(false);
    expect(isTenantModel(undefined)).toBe(false);
  });
});
