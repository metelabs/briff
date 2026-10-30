import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";

// Replaces RLS: every tenant-scoped model goes through this layer, which pins
// `orgId` into every where/data clause. Use `withOrg(db, orgId)` for any code
// that reads or writes tenant data; raw `getDb()` is for global catalog tables
// (packages, sources, items, advisories, jobs) and system code only.

export const TENANT_MODELS = [
  "OrgMember",
  "Repo",
  "Dependency",
  "RepoRuntime",
  "ItemMatch",
  "Alert",
  "BaseImageAlert",
  "BaseImageWatch",
  "Bulletin",
  "BulletinItem",
  "Feedback",
  "InterestProfile",
  "Deadline",
  "BulletinStream",
  "StreamRepo",
  "ScanToken",
  "GithubInstallation",
] as const;

export type TenantModel = (typeof TENANT_MODELS)[number];

const TENANT_MODEL_SET: ReadonlySet<string> = new Set(TENANT_MODELS);

export function isTenantModel(model: string | undefined): model is TenantModel {
  return model !== undefined && TENANT_MODEL_SET.has(model);
}

export class OrgScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrgScopeError";
  }
}

type Args = Record<string, unknown>;

function isRecord(value: unknown): value is Args {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scopeWhere(where: unknown, orgId: string): Args {
  const base = isRecord(where) ? where : {};
  if ("orgId" in base && base.orgId !== orgId) {
    throw new OrgScopeError("where.orgId conflicts with the scoped org");
  }
  return { ...base, orgId };
}

function scopeCreateData(data: unknown, orgId: string): Args {
  if (!isRecord(data)) throw new OrgScopeError("create data must be an object");
  if ("org" in data) {
    throw new OrgScopeError("use orgId, not the org relation, when creating tenant rows");
  }
  if ("orgId" in data && data.orgId !== orgId) {
    throw new OrgScopeError("data.orgId conflicts with the scoped org");
  }
  return { ...data, orgId };
}

function guardUpdateData(data: unknown, orgId: string): unknown {
  if (isRecord(data)) {
    if ("org" in data) throw new OrgScopeError("tenant rows cannot be moved between orgs");
    if ("orgId" in data && data.orgId !== orgId) {
      throw new OrgScopeError("tenant rows cannot be moved between orgs");
    }
  }
  return data;
}

const WHERE_OPERATIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "delete",
  "deleteMany",
]);

const UPDATE_OPERATIONS = new Set(["update", "updateMany", "updateManyAndReturn"]);
const CREATE_MANY_OPERATIONS = new Set(["createMany", "createManyAndReturn"]);

/** Pure argument rewrite; exported for unit tests. Throws on unknown operations. */
export function scopeArgs(operation: string, args: Args | undefined, orgId: string): Args {
  if (!orgId) throw new OrgScopeError("orgId is required");
  const input: Args = args ?? {};

  if (WHERE_OPERATIONS.has(operation)) {
    return { ...input, where: scopeWhere(input.where, orgId) };
  }
  if (UPDATE_OPERATIONS.has(operation)) {
    return {
      ...input,
      where: scopeWhere(input.where, orgId),
      data: guardUpdateData(input.data, orgId),
    };
  }
  if (operation === "create") {
    return { ...input, data: scopeCreateData(input.data, orgId) };
  }
  if (CREATE_MANY_OPERATIONS.has(operation)) {
    const rows = Array.isArray(input.data) ? input.data : [input.data];
    return { ...input, data: rows.map((row) => scopeCreateData(row, orgId)) };
  }
  if (operation === "upsert") {
    return {
      ...input,
      where: scopeWhere(input.where, orgId),
      create: scopeCreateData(input.create, orgId),
      update: guardUpdateData(input.update, orgId),
    };
  }
  throw new OrgScopeError(`operation ${operation} is not supported on tenant models`);
}

export function withOrg(db: PrismaClient, orgId: string) {
  if (!orgId) throw new OrgScopeError("orgId is required");
  return db.$extends({
    name: "withOrg",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!isTenantModel(model)) return query(args);
          return query(scopeArgs(operation, args as Args, orgId) as typeof args);
        },
      },
    },
  });
}

export type OrgDb = ReturnType<typeof withOrg>;
