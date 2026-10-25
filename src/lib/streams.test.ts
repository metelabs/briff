import { describe, expect, it } from "vitest";

import type { OrgDb } from "@/lib/db/with-org";

import { setRepoInStream, setStreamRepos, slugify, uniqueSlug } from "./streams";

describe("stream slugs", () => {
  it("makes URL-safe slugs, also from Turkish names", () => {
    expect(slugify("Work")).toBe("work");
    expect(slugify("Acme işleri / müşteri")).toBe("acme-isleri-musteri");
    expect(slugify("!!!")).toBe("stream");
  });

  it("numbers taken slugs", () => {
    expect(uniqueSlug("work", new Set())).toBe("work");
    expect(uniqueSlug("work", new Set(["work", "work-2"]))).toBe("work-3");
  });
});

describe("membership writes", () => {
  type Call = [string, string, unknown];

  // A transaction client with one repo in one stream; the outer client refuses
  // every model call, so any write outside the transaction fails the test.
  function fakeDb() {
    const calls: Call[] = [];
    let members = [{ streamId: "s1", repoId: "r1" }];
    const record = (model: string, op: string, args: unknown) => calls.push([model, op, args]);
    const tx = {
      bulletinStream: {
        findFirst: async (a: unknown) => (record("stream", "findFirst", a), { id: "s1" }),
        updateMany: async (a: unknown) => (record("stream", "updateMany", a), { count: 1 }),
      },
      streamRepo: {
        findMany: async (a: unknown) => (
          record("streamRepo", "findMany", a),
          members.map((m) => ({ repoId: m.repoId }))
        ),
        deleteMany: async (a: unknown) => {
          record("streamRepo", "deleteMany", a);
          members = [];
          return { count: 1 };
        },
        createMany: async (a: unknown) => (record("streamRepo", "createMany", a), { count: 1 }),
      },
      repo: {
        findFirst: async (a: unknown) => (record("repo", "findFirst", a), { id: "r1" }),
        findMany: async (a: unknown) => {
          record("repo", "findMany", a);
          const select = (a as { select?: { _count?: unknown } }).select;
          return select?._count
            ? [{ id: "r1", included: true, _count: { streams: members.length } }]
            : [];
        },
        updateMany: async (a: unknown) => (record("repo", "updateMany", a), { count: 1 }),
      },
    };
    const outside = () => {
      throw new Error("model call outside the transaction");
    };
    const db = {
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
      repo: new Proxy({}, { get: outside }),
      streamRepo: new Proxy({}, { get: outside }),
      bulletinStream: new Proxy({}, { get: outside }),
    };
    return { db: db as unknown as OrgDb, calls };
  }

  it("removing the last membership sets included = false inside the same transaction", async () => {
    const { db, calls } = fakeDb();
    expect(await setRepoInStream(db, "o1", "s1", "r1", false)).toBe(true);
    const ops = calls.map(([model, op]) => `${model}.${op}`);
    // Lock first, then the membership write, then the recount and its write.
    expect(ops.indexOf("repo.updateMany")).toBeLessThan(ops.indexOf("streamRepo.deleteMany"));
    expect(ops.indexOf("streamRepo.deleteMany")).toBeLessThan(ops.lastIndexOf("repo.findMany"));
    const last = calls.at(-1);
    expect(last?.[0]).toBe("repo");
    expect(last?.[2]).toMatchObject({ where: { id: "r1" }, data: { included: false } });
  });

  it("replacing a stream's repos recounts inside the transaction too", async () => {
    const { db, calls } = fakeDb();
    expect(await setStreamRepos(db, "o1", "s1", [])).toBe(true);
    expect(calls.at(-1)?.[2]).toMatchObject({ data: { included: false } });
  });
});
