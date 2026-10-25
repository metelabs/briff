import { z } from "zod";

import { fetchWithRetry } from "@/lib/platforms/fetch-with-retry";
import { normalizeVersion } from "@scan/ecosystems";

import type { RegistryInfo } from "./registries";

// Packagist metadata (Composer v2 API): `p2/<vendor>/<package>.json` lists the tagged
// releases, newest first, in Composer's minified form (each entry only carries the keys that
// changed since the previous one; `__unset` removes a key). Dev branches live in a separate
// `~dev.json` file that Briff never reads.

const REPO = "https://repo.packagist.org";

// Composer's own package-name rule (composer/composer src/Composer/Package/Loader/ValidatingArrayLoader.php).
const NAME_RE = /^[a-z0-9](?:[_.-]?[a-z0-9]+)*\/[a-z0-9](?:(?:[_.]|-{1,2})?[a-z0-9]+)*$/;

const UNSET = "__unset";

const entrySchema = z.record(z.string(), z.unknown());

export const packagistResponseSchema = z
  .object({
    packages: z.record(z.string(), z.array(entrySchema)),
    minified: z.string().optional(),
  })
  .loose();

/** The p2 URL, or null for a name Composer would not accept (it never reaches the URL). */
export function packagistUrl(name: string): string | null {
  return NAME_RE.test(name) ? `${REPO}/p2/${name}.json` : null;
}

/** Composer's MetadataMinifier::expand: every entry with the keys it inherits. */
export function expandMinified(
  entries: readonly Record<string, unknown>[]
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const entry of entries) {
    const previous = out.at(-1);
    if (!previous) {
      out.push({ ...entry });
      continue;
    }
    const next: Record<string, unknown> = { ...previous };
    for (const [key, value] of Object.entries(entry)) {
      if (value === UNSET) delete next[key];
      else next[key] = value;
    }
    out.push(next);
  }
  return out;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** A release without a stability suffix (`7.1.3.0`, not `7.2.0.0-RC1`). */
function isStable(entry: Record<string, unknown>): boolean {
  const normalized = text(entry.version_normalized) ?? text(entry.version) ?? "";
  return normalized !== "" && !normalized.includes("-");
}

export function toPackagistInfo(
  name: string,
  body: z.infer<typeof packagistResponseSchema>
): RegistryInfo | null {
  const raw = body.packages[name];
  if (!raw || raw.length === 0) return null;
  const entries = body.minified ? expandMinified(raw) : raw;
  const latest = entries.find(isStable) ?? entries[0];
  const version = text(latest.version);
  if (!version) return null;
  const abandoned = latest.abandoned;
  const replacement = text(abandoned);
  const source = latest.source as { url?: unknown } | undefined;
  return {
    latestVersion: normalizeVersion("Packagist", version),
    deprecated: replacement
      ? `Abandoned; use ${replacement} instead.`
      : abandoned === true
        ? "Abandoned."
        : null,
    repositoryUrl: text(source?.url),
    homepage: text(latest.homepage),
  };
}

export type PackagistLookup = { status: "ok"; info: RegistryInfo } | { status: "not_found" };

/** Newest stable release, abandonment and source repository; `not_found` for private or unknown names. */
export async function fetchPackagistPackage(name: string): Promise<PackagistLookup> {
  const url = packagistUrl(name);
  if (!url) return { status: "not_found" };
  const res = await fetchWithRetry(url, {
    headers: { Accept: "application/json" },
    timeoutMs: 10_000,
    retries: 2,
  });
  if (res.status === 404) return { status: "not_found" };
  if (!res.ok) throw new Error(`packagist:${name}: HTTP ${res.status}`);
  const parsed = packagistResponseSchema.safeParse(await res.json());
  if (!parsed.success) throw new Error(`packagist:${name}: invalid metadata`);
  const info = toPackagistInfo(name, parsed.data);
  return info ? { status: "ok", info } : { status: "not_found" };
}
