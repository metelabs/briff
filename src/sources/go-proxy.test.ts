import { describe, expect, it } from "vitest";

import {
  escapeModulePath,
  goLatestSchema,
  goModDeprecation,
  goProxyUrl,
  goRepositoryUrl,
} from "./go-proxy";

describe("go proxy adapter", () => {
  it("escapes upper case and refuses paths that are no module path", () => {
    expect(escapeModulePath("github.com/Acme/Legacy")).toBe("github.com/!acme/!legacy");
    expect(goProxyUrl("golang.org/x/net", "@latest")).toBe(
      "https://proxy.golang.org/golang.org/x/net/@latest"
    );
    expect(goProxyUrl("github.com/acme/../secret", "@latest")).toBeNull();
    expect(goProxyUrl("https://evil.example/x", "@latest")).toBeNull();
  });

  it("reads @latest", () => {
    const latest = goLatestSchema.parse({
      Version: "v0.33.0",
      Time: "2026-10-01T00:00:00Z",
      Origin: { VCS: "git", URL: "https://go.googlesource.com/net", Ref: "refs/tags/v0.33.0" },
    });
    expect(latest.Version).toBe("v0.33.0");
  });

  it("links GitHub modules to their repo (major suffix dropped) and others to pkg.go.dev", () => {
    expect(goRepositoryUrl("github.com/acme/kit/v2", undefined)).toBe(
      "https://github.com/acme/kit"
    );
    expect(goRepositoryUrl("example.com/acme/kit", "https://github.com/acme/kit-go.git")).toBe(
      "https://github.com/acme/kit-go"
    );
    expect(goRepositoryUrl("golang.org/x/net", "https://go.googlesource.com/net")).toBe(
      "https://pkg.go.dev/golang.org/x/net"
    );
  });

  it("finds the Deprecated paragraph on the module directive", () => {
    expect(
      goModDeprecation(
        "// Package kit does things.\n//\n// Deprecated: use github.com/acme/kit/v3 instead.\n// It will not get fixes.\n\nmodule github.com/acme/kit/v2\n"
      )
    ).toBeNull();
    expect(
      goModDeprecation(
        "// Deprecated: use github.com/acme/kit/v3 instead.\n// It will not get fixes.\nmodule github.com/acme/kit/v2\n\ngo 1.22\n"
      )
    ).toBe("use github.com/acme/kit/v3 instead. It will not get fixes.");
    expect(goModDeprecation("module github.com/acme/kit // Deprecated: moved.\n")).toBe("moved.");
    expect(goModDeprecation("module github.com/acme/kit\n")).toBeNull();
  });
});
