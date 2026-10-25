import "server-only";

import { promises as dns } from "node:dns";
import net from "node:net";

// Two-tier SSRF defense. Sync check runs on every read request (cheap, no
// network). Async check runs once on feed-add (full DNS resolution). Together
// they reject the obvious literal-IP attacks AND the trickier
// hostname-pointing-at-a-private-IP attacks.

const PRIVATE_HOSTNAMES = new Set(["localhost", "ip6-localhost", "ip6-loopback", "0.0.0.0"]);

export type SsrfRejection =
  "invalid_url" | "bad_scheme" | "private_host" | "private_ip" | "dns_failed";

export type SsrfResult = { ok: true; url: URL } | { ok: false; reason: SsrfRejection };

export function checkUrlSync(rawUrl: string): SsrfResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "bad_scheme" };
  }

  const host = url.hostname.toLowerCase();
  if (PRIVATE_HOSTNAMES.has(host)) return { ok: false, reason: "private_host" };

  if (net.isIPv4(host) && isPrivateIPv4(host)) {
    return { ok: false, reason: "private_ip" };
  }
  if (net.isIPv6(host) && isPrivateIPv6(host)) {
    return { ok: false, reason: "private_ip" };
  }

  return { ok: true, url };
}

export async function checkUrlFull(rawUrl: string): Promise<SsrfResult> {
  const sync = checkUrlSync(rawUrl);
  if (!sync.ok) return sync;

  // Hostname may be a literal IP (already checked) or a DNS name we need to
  // resolve. Lookup all records — any one pointing at a private range is
  // grounds for rejection.
  const resolved = await resolvePublicAddresses(sync.url.hostname);
  if (!resolved.ok) return resolved;

  return { ok: true, url: sync.url };
}

export function isPrivateAddress(address: string, family: number): boolean {
  if (family === 4) return isPrivateIPv4(address);
  if (family === 6) return isPrivateIPv6(address);
  return true; // unknown family — treat as unsafe
}

export type ResolvedAddress = { address: string; family: number };

/**
 * Resolve a hostname and reject if ANY resolved record lands in a private /
 * reserved range. Returns the resolved records so a caller can pin its
 * connection to an address that was actually validated (DNS-rebinding defense).
 */
export async function resolvePublicAddresses(
  hostname: string
): Promise<{ ok: true; records: ResolvedAddress[] } | { ok: false; reason: SsrfRejection }> {
  let records: ResolvedAddress[];
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch {
    return { ok: false, reason: "dns_failed" };
  }
  if (records.length === 0) return { ok: false, reason: "dns_failed" };
  for (const { address, family } of records) {
    if (isPrivateAddress(address, family)) {
      return { ok: false, reason: "private_ip" };
    }
  }
  return { ok: true, records };
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return true; // malformed — treat as unsafe
  }
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
  if (lower.startsWith("fe80:")) return true; // link-local
  if (lower.startsWith("ff")) return true; // multicast
  // IPv4-mapped (::ffff:a.b.c.d) — recurse through embedded IPv4.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

export function describeRejection(reason: SsrfRejection): string {
  switch (reason) {
    case "invalid_url":
      return "That doesn't look like a valid URL.";
    case "bad_scheme":
      return "Only http:// and https:// URLs are supported.";
    case "private_host":
    case "private_ip":
      return "That URL points to a private or internal address.";
    case "dns_failed":
      return "Couldn't resolve that hostname.";
  }
}
