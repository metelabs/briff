import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Let the guard pass loopback so a local server can stand in for a delivery endpoint.
vi.mock("./ssrf-guard", () => ({
  checkUrlSync: (raw: string) => ({ ok: true, url: new URL(raw) }),
  resolvePublicAddresses: async () => ({
    ok: true,
    records: [{ address: "127.0.0.1", family: 4 }],
  }),
}));

const { safeFetch } = await import("./safe-fetch");

describe("safeFetch POST", () => {
  const hits: { method: string; path: string; body: string }[] = [];
  let base = "";
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString()));
    req.on("end", () => {
      hits.push({ method: req.method ?? "", path: req.url ?? "", body });
      if (req.url === "/moved") {
        res.writeHead(302, { Location: "/elsewhere" });
        res.end();
        return;
      }
      res.writeHead(200);
      res.end("ok");
    });
  });

  beforeAll(
    () =>
      new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", () => {
          base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
          resolve();
        })
      )
  );
  afterAll(() => {
    server.close();
  });

  it("sends the body and never follows a redirect", async () => {
    const ok = await safeFetch(`${base}/hook`, { method: "POST", body: '{"a":1}', retries: 0 });
    expect(ok.status).toBe(200);
    expect(hits.at(-1)).toEqual({ method: "POST", path: "/hook", body: '{"a":1}' });
    hits.length = 0;
    const moved = await safeFetch(`${base}/moved`, { method: "POST", body: "{}", retries: 0 });
    expect(moved.status).toBe(302);
    expect(hits.map((h) => h.path)).toEqual(["/moved"]);
  });
});
