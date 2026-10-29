import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchRssFeed } from "./fetcher";
import { safeFetch } from "./safe-fetch";

vi.mock("./safe-fetch", () => ({ safeFetch: vi.fn() }));

const pythonFeed = readFileSync(
  new URL("./__fixtures__/python-insider.xml", import.meta.url),
  "utf8"
);

function response(body: string, contentType = "application/octet-stream") {
  vi.mocked(safeFetch).mockResolvedValue({
    status: 200,
    contentType,
    body,
    etag: '"synthetic-etag"',
    lastModified: null,
  });
}

afterEach(() => vi.resetAllMocks());

describe("fetchRssFeed", () => {
  it("reads the recorded Python Insider RSS body served as octet-stream", async () => {
    response(pythonFeed);
    const result = await fetchRssFeed("https://blog.python.org/feeds/posts/default");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("feed was rejected");
    expect(result.parsed.title).toBe("Python Insider");
    expect(result.parsed.items).toHaveLength(1);
    expect(result.etag).toBe('"synthetic-etag"');
  });

  it("accepts Atom with a generic binary content type", async () => {
    response(
      '<feed xmlns="http://www.w3.org/2005/Atom"><title>Acme</title></feed>',
      "application/octet-stream; charset=utf-8"
    );
    expect((await fetchRssFeed("https://example.com/feed")).status).toBe("ok");
  });

  it.each(["binary data", "<html><rss></rss></html>", "<rss-other />"])(
    "rejects a non-feed octet-stream body: %s",
    async (body) => {
      response(body);
      expect(await fetchRssFeed("https://example.com/feed")).toMatchObject({
        status: "error",
        error: "content-type application/octet-stream",
      });
    }
  );
});
