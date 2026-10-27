import type { DetectedRuntime } from "./types";

export interface ImageDistro {
  name: "debian" | "ubuntu" | "alpine";
  version: string;
  ecosystem: string;
  image: string;
}

// Checked against docker-library/official-images library/python and library/php on
// 2026-10-27. Recheck when official images change their unqualified Debian variant.
export const IMAGE_DISTROS = {
  debian: { buster: "10", bullseye: "11", bookworm: "12", trixie: "13" },
  defaultDebian: {
    python: { "3.11": "13", "3.12": "13", "3.13": "13", "3.14": "13" },
    php: { "8.2": "13", "8.3": "13", "8.4": "13", "8.5": "13" },
  },
} as const;

export function imageDistro(reference: string): ImageDistro | null {
  if (reference.includes("$") || reference.includes("@")) return null;
  const normalized = reference
    .replace(/^(?:docker\.io\/)?library\//, "")
    .replace(/^docker\.io\//, "");
  const match = /^([a-z]+):([\w.-]+)$/.exec(normalized);
  if (!match) return null;
  const [, image, tag] = match;
  let name: ImageDistro["name"] | undefined;
  let version: string | undefined;
  if (image === "ubuntu" && /^\d{2}\.\d{2}$/.test(tag)) {
    name = "ubuntu";
    version = tag;
  } else if (image === "alpine" && /^\d+\.\d+(?:\.\d+)?$/.test(tag)) {
    name = "alpine";
    version = tag.split(".").slice(0, 2).join(".");
  } else if (
    ["debian", "node", "python", "php", "ruby", "golang", "postgres", "redis", "nginx"].includes(
      image
    )
  ) {
    const alpine = /(?:^|-)alpine(\d+\.\d+)(?:$|-)/.exec(tag);
    const codename = Object.entries(IMAGE_DISTROS.debian).find(([key]) =>
      new RegExp(`(?:^|-)${key}(?:-|$)`).test(tag)
    );
    if (alpine) {
      name = "alpine";
      version = alpine[1];
    } else if (codename) {
      name = "debian";
      version = codename[1];
    } else if (image === "debian" && /^\d+(?:-slim)?$/.test(tag)) {
      name = "debian";
      version = tag.split("-")[0];
    } else if (!tag.includes("alpine") && /^\d+\.\d+(?:-(?:slim|cli|fpm|apache|zts))?$/.test(tag)) {
      if (image === "python" || image === "php") {
        name = "debian";
        version = (IMAGE_DISTROS.defaultDebian[image] as Readonly<Record<string, string>>)[
          tag.split("-")[0]
        ];
      }
    }
  }
  if (!name || !version) return null;
  const ecosystem =
    name === "debian"
      ? `Debian:${version}`
      : name === "ubuntu"
        ? `Ubuntu:${version}${["20.04", "22.04", "24.04", "26.04"].includes(version) ? ":LTS" : ""}`
        : `Alpine:v${version}`;
  return { name, version, ecosystem, image: reference };
}

export function distroRuntime(reference: string, source: string): DetectedRuntime[] {
  const distro = imageDistro(reference);
  return distro
    ? [
        {
          name: distro.name,
          version: distro.version,
          normalized: distro.version,
          image: reference,
          source: `${source} base image ${reference}`,
          unresolved: false,
        },
      ]
    : [];
}

// Candidate source packages only. A tag reveals neither presence nor installed versions;
// these advisories are prompts to check/rebuild the base image, not confirmed findings.
const COMMON = ["openssl", "zlib", "libxml2", "curl", "expat", "sqlite3", "gnutls28", "libtasn1-6"];
export function baseImagePackages(distro: ImageDistro): readonly string[] {
  return distro.name === "alpine"
    ? [
        "openssl",
        "zlib",
        "musl",
        "libxml2",
        "curl",
        "expat",
        "sqlite",
        "gnutls",
        "libtasn1",
        "busybox",
      ]
    : [...COMMON, "glibc", "apt", "dpkg"];
}
