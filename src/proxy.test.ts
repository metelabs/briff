import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { proxy } from "./proxy";

// `/` serves the landing page to anonymous requests and the dashboard to a session.

const REWRITE = "x-middleware-rewrite";

function get(path: string, cookie?: string): NextRequest {
  return new NextRequest(new URL(path, "https://app.briff.dev"), {
    headers: cookie ? { cookie } : {},
  });
}

describe("proxy: /", () => {
  it("rewrites an anonymous request to the landing page, keeping the URL", () => {
    const res = proxy(get("/"));
    expect(res.headers.get(REWRITE)).toBe("https://app.briff.dev/landing");
    expect(res.headers.get("location")).toBeNull();
  });

  it("ignores cookies that are not the session (theme, stream)", () => {
    const res = proxy(get("/", "briff-theme=dark; briff-stream=abc"));
    expect(res.headers.get(REWRITE)).toBe("https://app.briff.dev/landing");
  });

  it("lets a session through to the dashboard", () => {
    for (const cookie of [
      "better-auth.session_token=abc.def",
      "__Secure-better-auth.session_token=abc.def",
    ]) {
      const res = proxy(get("/", cookie));
      expect(res.headers.get(REWRITE), cookie).toBeNull();
      expect(res.headers.get("x-middleware-next"), cookie).toBe("1");
    }
  });

  it("keeps the query string on the rewrite", () => {
    const res = proxy(get("/?utm_source=x"));
    expect(res.headers.get(REWRITE)).toBe("https://app.briff.dev/landing?utm_source=x");
  });

  it("leaves other paths alone", () => {
    const res = proxy(get("/bulletins"));
    expect(res.headers.get(REWRITE)).toBeNull();
  });
});
