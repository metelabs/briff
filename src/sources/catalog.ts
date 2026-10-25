import type { PrismaClient } from "@/generated/prisma/client";
import { SERVICES } from "@/lib/services";

import { CURATED_SOURCES } from "./curated";

/** Materialises the code-defined service table; returns key -> id. */
export async function syncServices(db: PrismaClient): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const service of SERVICES) {
    const row = await db.service.upsert({
      where: { key: service.key },
      create: { key: service.key, name: service.name, homepage: service.homepage ?? null },
      update: { name: service.name, homepage: service.homepage ?? null },
      select: { id: true },
    });
    ids.set(service.key, row.id);
  }
  return ids;
}

/** Upserts the curated feeds by URL; fetch state (etag, lastFetchedAt) is preserved. */
export async function syncCuratedSources(
  db: PrismaClient,
  serviceIds: Map<string, string>
): Promise<number> {
  for (const source of CURATED_SOURCES) {
    const data = {
      kind: source.kind,
      name: source.name,
      serviceId: source.serviceKey ? (serviceIds.get(source.serviceKey) ?? null) : null,
      keywords: source.traits,
      runtime: source.runtime ?? null,
      class: source.class ?? "news",
    };
    await db.source.upsert({
      where: { url: source.url },
      create: { url: source.url, ...data },
      update: data,
    });
  }
  return CURATED_SOURCES.length;
}
