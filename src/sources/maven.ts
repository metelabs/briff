import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import { fetchWithRetry } from "@/lib/platforms/fetch-with-retry";
import type { RegistryLookup } from "./registries";

const responseSchema = z.object({
  response: z.object({ docs: z.array(z.object({ latestVersion: z.string() })) }),
});

export async function fetchMavenPackage(name: string): Promise<RegistryLookup> {
  if (!/^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/.test(name)) return { status: "not_found" };
  const [group, artifact] = name.split(":");
  const query = new URLSearchParams({
    q: `g:"${group}" AND a:"${artifact}"`,
    rows: "1",
    wt: "json",
  });
  const response = await fetchWithRetry(`https://search.maven.org/solrsearch/select?${query}`, {
    timeoutMs: 10_000,
    retries: 2,
  });
  if (!response.ok) throw new Error(`Maven:${name}: HTTP ${response.status}`);
  const body = responseSchema.parse(await response.json());
  const latest = body.response.docs[0];
  if (!latest) return { status: "not_found" };
  let repositoryUrl: string | null = null;
  if (/^[A-Za-z0-9_.+-]+$/.test(latest.latestVersion)) {
    const version = encodeURIComponent(latest.latestVersion);
    const pomResponse = await fetchWithRetry(
      `https://repo.maven.apache.org/maven2/${group.replaceAll(".", "/")}/${artifact}/${version}/${artifact}-${version}.pom`,
      { timeoutMs: 10_000, retries: 2 }
    );
    if (pomResponse.ok) {
      const value: unknown = new XMLParser({
        parseTagValue: false,
        removeNSPrefix: true,
        processEntities: false,
      }).parse(await pomResponse.text());
      const result = z
        .object({
          project: z.object({
            scm: z
              .object({ url: z.string().optional(), connection: z.string().optional() })
              .optional(),
          }),
        })
        .safeParse(value);
      const scm = result.success ? result.data.project.scm : undefined;
      const url = scm?.url ?? scm?.connection;
      if (url) repositoryUrl = url.replace(/^scm:git:/, "");
    } else if (pomResponse.status !== 404)
      throw new Error(`Maven POM:${name}: HTTP ${pomResponse.status}`);
  }
  return {
    status: "ok",
    info: { latestVersion: latest.latestVersion, deprecated: null, repositoryUrl, homepage: null },
  };
}
