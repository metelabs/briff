import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { renderBaseImageAlertEmail } from "@/lib/email/alert-email";
import { osvVulnSchema } from "@/sources/osv";
import { baseImagePackages, imageDistro } from "@scan/distros";

import {
  baseImageAction,
  emailsBaseImageGroup,
  fixKey,
  isFixAnnouncement,
  planImageAlerts,
  releaseFixes,
  type ReleaseAdvisory,
} from "./base-images";

const now = new Date("2026-10-30T04:15:00Z");
const DAY = 86_400_000;

describe("base image advice", () => {
  it("rebuilds supported tags and migrates EOL distros without changing the language release line", () => {
    for (const [image, expected] of [
      ["node:22-bookworm-slim", "rebuild on the latest node:22-bookworm-slim tag"],
      ["node:22-alpine3.20", "alpine 3.20 is end-of-life; migrate to alpine 3.21 or later"],
      ["debian:11", "debian 11 is end-of-life; migrate to debian 12 or later"],
      [
        "docker.io/library/debian:11-slim",
        "debian 11 is end-of-life; migrate to debian 12 or later",
      ],
      ["debian:bullseye-slim", "debian 11 is end-of-life; migrate to debian 12 or later"],
    ]) {
      const distro = imageDistro(image);
      if (!distro) throw new Error("Missing fixture distro");
      expect(baseImageAction(distro, now)).toBe(expected);
    }
  });
});

/** Recorded OSV `/v1/query` answer for openssl in Debian:12 (2026-10-30, trimmed). */
function debian12(): Map<string, ReleaseAdvisory> {
  const distro = imageDistro("node:22-bookworm-slim");
  if (!distro) throw new Error("Missing distro");
  const raw = JSON.parse(
    readFileSync(new URL("./__fixtures__/osv-debian12-openssl.json", import.meta.url), "utf8")
  ) as { vulns: unknown[] };
  return new Map(
    raw.vulns.map((v) => {
      const vuln = osvVulnSchema.parse(v);
      const packages = ["openssl"];
      expect(baseImagePackages(distro)).toContain("openssl");
      return [vuln.id, { vuln, packages, fixes: releaseFixes(vuln, distro.ecosystem, packages) }];
    })
  );
}

describe("base image fix window", () => {
  it("reads the release's fixed events only", () => {
    const advisories = debian12();
    expect(advisories.get("DSA-6113-1")?.fixes).toEqual([
      { package: "openssl", version: "3.0.18-1~deb12u2" },
    ]);
    // Open in bookworm: no fix, so never an alert.
    expect(advisories.get("DEBIAN-CVE-2025-27587")?.fixes).toEqual([]);
    expect(isFixAnnouncement("DSA-6113-1")).toBe(true);
    expect(isFixAnnouncement("DLA-4490-1")).toBe(true);
    expect(isFixAnnouncement("USN-8847-1")).toBe(true);
    expect(isFixAnnouncement("DEBIAN-CVE-2025-15467")).toBe(false);
  });

  it("does not alert on fixes from before the window or before the image was seen", () => {
    const advisories = debian12();
    // The old scan alerted on every record the query returned.
    expect(advisories.size).toBe(26);
    const baseline = new Map(
      [...advisories.values()].flatMap((a) => a.fixes.map((f) => [fixKey(f), null] as const))
    );
    expect(planImageAlerts(advisories, baseline, new Date(now.getTime() - 30 * DAY), now)).toEqual(
      []
    );
    const old = new Map([...baseline.keys()].map((k) => [k, new Date(now.getTime() - 20 * DAY)]));
    expect(planImageAlerts(advisories, old, new Date(now.getTime() - 30 * DAY), now)).toEqual([]);
    const recent = new Map([...baseline.keys()].map((k) => [k, new Date(now.getTime() - 3 * DAY)]));
    expect(planImageAlerts(advisories, recent, new Date(now.getTime() - DAY), now)).toEqual([]);
  });

  it("lets an announcement stand for the CVE records it fixes, with their highest severity", () => {
    const advisories = debian12();
    const fixedAt = new Map<string, Date | null>([
      ["openssl\x003.0.18-1~deb12u2", new Date(now.getTime() - 3 * DAY)],
    ]);
    const planned = planImageAlerts(advisories, fixedAt, new Date(now.getTime() - 10 * DAY), now);
    expect(planned.map((p) => [p.osvId, p.severity, p.packages])).toEqual([
      ["DSA-6113-1", "HIGH", ["openssl"]],
    ]);
    expect(planned[0].fixedAt).toEqual(new Date(now.getTime() - 3 * DAY));
  });

  it("emails a group the same day only with a rated critical or high advisory", () => {
    expect(emailsBaseImageGroup(["HIGH", null])).toBe(true);
    expect(emailsBaseImageGroup(["CRITICAL"])).toBe(true);
    expect(emailsBaseImageGroup([null, "MODERATE", "LOW"])).toBe(false);
    expect(emailsBaseImageGroup([])).toBe(false);
  });
});

describe("base image email", () => {
  it("shows one block per image, ten advisories and a link to the rest", () => {
    const advisories = Array.from({ length: 13 }, (_, i) => ({
      osvId: `DEBIAN-CVE-2026-${1000 + i}`,
      severity: i === 0 ? "CRITICAL" : i === 1 ? null : "MODERATE",
      packages: ["openssl"],
    }));
    const email = renderBaseImageAlertEmail(
      "en",
      [
        {
          image: "node:22-bookworm-slim",
          repo: "acme/web",
          action: "rebuild on the latest node:22-bookworm-slim tag",
          advisories,
        },
        {
          image: "debian:11-slim",
          repo: "acme/api",
          action: "debian 11 is end-of-life; migrate to debian 12 or later",
          advisories: [{ osvId: "DLA-4599-1", severity: "HIGH", packages: ["openssl"] }],
        },
      ],
      "https://example.com/"
    );
    expect(email.subject).toBe("Briff · base image fixes: node:22-bookworm-slim +1");
    expect(email.text).toContain("DEBIAN-CVE-2026-1001 · UNKNOWN · openssl");
    expect(email.text).toContain("DEBIAN-CVE-2026-1009");
    expect(email.text).not.toContain("DEBIAN-CVE-2026-1010");
    expect(email.text).toContain("and 3 more: https://example.com/alerts");
    expect(email.text).toContain("To do: debian 11 is end-of-life; migrate to debian 12 or later");
    expect(email.html).toContain("and 3 more");
    expect(email.html.match(/osv\.dev\/vulnerability/g)).toHaveLength(11);
  });
});
