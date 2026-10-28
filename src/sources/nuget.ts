import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import { fetchWithRetry } from "@/lib/platforms/fetch-with-retry";
import type { RegistryLookup } from "./registries";

const stableVersion = (version: string) => /^\d+(?:\.\d+){0,3}(?:\+[A-Za-z0-9.-]+)?$/.test(version);
const compareVersions = (a: string, b: string) => {
  const parts = (value: string) => value.split("+")[0].split(".").map(Number);
  const left = parts(a),
    right = parts(b);
  for (let i = 0; i < 4; i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference) return difference;
  }
  return 0;
};

const leaf = z.object({
  catalogEntry: z.object({
    version: z.string(),
    listed: z.boolean().optional(),
    projectUrl: z.string().nullish(),
    deprecation: z
      .object({ message: z.string().optional(), reasons: z.array(z.string()).optional() })
      .nullish(),
  }),
});
const page = z.object({ "@id": z.string().optional(), items: z.array(leaf).optional() });
const index = z.object({ items: z.array(page) });

export async function fetchNugetPackage(name: string): Promise<RegistryLookup> {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) return { status: "not_found" };
  const key = name.toLowerCase();
  const base = `https://api.nuget.org/v3/registration5-gz-semver2/${key}/`;
  const fetch = (url: string) => fetchWithRetry(url, { timeoutMs: 10_000, retries: 2 });
  const response = await fetch(`${base}index.json`);
  if (response.status === 404) return { status: "not_found" };
  if (!response.ok) throw new Error(`NuGet:${name}: HTTP ${response.status}`);
  const registration = index.parse(await response.json());
  const flat = await fetch(`https://api.nuget.org/v3-flatcontainer/${key}/index.json`);
  if (!flat.ok) throw new Error(`NuGet versions:${name}: HTTP ${flat.status}`);
  const versions = z.object({ versions: z.array(z.string()) }).parse(await flat.json()).versions;
  const available = new Set(versions.map((v) => v.toLowerCase()));
  let latest: z.infer<typeof leaf>["catalogEntry"] | undefined;
  for (const entry of [...registration.items].reverse()) {
    let items = entry.items;
    if (!items && entry["@id"]) {
      const url = entry["@id"];
      if (!url.startsWith(base)) throw new Error("Unexpected NuGet registration page URL");
      const response = await fetch(url);
      if (!response.ok) throw new Error(`NuGet page:${name}: HTTP ${response.status}`);
      items = page.parse(await response.json()).items;
    }
    const candidates = (items ?? [])
      .map((v) => v.catalogEntry)
      .filter(
        (v) =>
          v.listed !== false && available.has(v.version.toLowerCase()) && stableVersion(v.version)
      );
    candidates.sort((a, b) => compareVersions(b.version, a.version));
    if (candidates[0] && (!latest || compareVersions(candidates[0].version, latest.version) > 0))
      latest = candidates[0];
  }
  if (!latest)
    return {
      status: "ok",
      info: { latestVersion: null, deprecated: null, repositoryUrl: null, homepage: null },
    };
  const version = latest.version.toLowerCase();
  let repositoryUrl: string | null = null;
  const nuspec = await fetch(
    `https://api.nuget.org/v3-flatcontainer/${key}/${encodeURIComponent(version)}/${key}.nuspec`
  );
  if (nuspec.ok) {
    const parsed: unknown = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "",
      parseTagValue: false,
      processEntities: false,
      removeNSPrefix: true,
    }).parse(await nuspec.text());
    const metadata = z
      .object({
        package: z.object({
          metadata: z.object({ repository: z.object({ url: z.string().optional() }).optional() }),
        }),
      })
      .safeParse(parsed);
    if (metadata.success) repositoryUrl = metadata.data.package.metadata.repository?.url ?? null;
  } else if (nuspec.status !== 404) throw new Error(`NuGet nuspec:${name}: HTTP ${nuspec.status}`);
  return {
    status: "ok",
    info: {
      latestVersion: latest.version,
      deprecated: latest.deprecation
        ? latest.deprecation.message || latest.deprecation.reasons?.join(", ") || "Deprecated."
        : null,
      repositoryUrl: repositoryUrl ?? latest.projectUrl ?? null,
      homepage: latest.projectUrl ?? null,
    },
  };
}
