import { describe, it, expect, vi, afterEach } from "vitest";
import { promises as dns } from "node:dns";
import {
  checkUrlSync,
  describeRejection,
  isPrivateAddress,
  resolvePublicAddresses,
} from "./ssrf-guard";

describe("checkUrlSync", () => {
  it("accepts public http(s) URLs", () => {
    expect(checkUrlSync("https://example.com/feed.xml").ok).toBe(true);
    expect(checkUrlSync("http://news.ycombinator.com").ok).toBe(true);
  });

  it("rejects non-http schemes", () => {
    const r = checkUrlSync("ftp://example.com");
    expect(r).toEqual({ ok: false, reason: "bad_scheme" });
  });

  it("rejects malformed URLs", () => {
    expect(checkUrlSync("not a url")).toEqual({ ok: false, reason: "invalid_url" });
  });

  it("rejects private hostnames", () => {
    expect(checkUrlSync("http://localhost/x")).toEqual({ ok: false, reason: "private_host" });
    expect(checkUrlSync("http://0.0.0.0/")).toEqual({ ok: false, reason: "private_host" });
  });

  it("rejects private / reserved IPv4 literals", () => {
    for (const ip of [
      "http://10.0.0.1",
      "http://127.0.0.1",
      "http://192.168.1.1",
      "http://169.254.169.254", // cloud metadata
      "http://172.16.0.1",
      "http://100.64.0.1", // CGNAT
      "http://224.0.0.1", // multicast
    ]) {
      expect(checkUrlSync(ip)).toEqual({ ok: false, reason: "private_ip" });
    }
  });

  it("allows a public IPv4 literal", () => {
    expect(checkUrlSync("http://8.8.8.8").ok).toBe(true);
  });
});

describe("isPrivateAddress", () => {
  it("flags private v4, private v6, and unknown families", () => {
    expect(isPrivateAddress("10.0.0.1", 4)).toBe(true);
    expect(isPrivateAddress("8.8.8.8", 4)).toBe(false);
    expect(isPrivateAddress("::1", 6)).toBe(true);
    expect(isPrivateAddress("2606:4700:4700::1111", 6)).toBe(false);
    expect(isPrivateAddress("whatever", 0)).toBe(true);
  });
});

describe("resolvePublicAddresses (DNS-rebinding defense)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("accepts a hostname resolving to a public IP", async () => {
    vi.spyOn(dns, "lookup").mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
    const res = await resolvePublicAddresses("example.com");
    expect(res.ok).toBe(true);
  });

  it("rejects a hostname that resolves to a private IP at read time", async () => {
    // Rebinding: add-time the name is public, read-time it flips to metadata IP.
    const spy = vi
      .spyOn(dns, "lookup")
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }] as never)
      .mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }] as never);

    const first = await resolvePublicAddresses("rebind.evil.test");
    expect(first.ok).toBe(true);

    const second = await resolvePublicAddresses("rebind.evil.test");
    expect(second).toEqual({ ok: false, reason: "private_ip" });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("rejects when any one of several records is private", async () => {
    vi.spyOn(dns, "lookup").mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "10.1.2.3", family: 4 },
    ] as never);
    expect(await resolvePublicAddresses("split.test")).toEqual({ ok: false, reason: "private_ip" });
  });

  it("rejects when DNS resolution fails", async () => {
    vi.spyOn(dns, "lookup").mockRejectedValue(new Error("ENOTFOUND"));
    expect(await resolvePublicAddresses("nope.test")).toEqual({ ok: false, reason: "dns_failed" });
  });
});

describe("describeRejection", () => {
  it("returns a human message for each reason", () => {
    expect(describeRejection("bad_scheme")).toMatch(/http/i);
    expect(describeRejection("private_ip")).toMatch(/private|internal/i);
    expect(describeRejection("invalid_url")).toMatch(/valid/i);
    expect(describeRejection("dns_failed")).toMatch(/resolve/i);
  });
});
