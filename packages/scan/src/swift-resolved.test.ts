import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { collectFromFiles } from "./collect";
import { parseSwiftResolved } from "./swift-resolved";
import { swiftPackageName } from "./swift-url";
const fixture = (path: string) =>
  readFileSync(new URL(`./__fixtures__/${path}`, import.meta.url), "utf8");
it("reads SwiftPM v1, v2 and v3 pins, direct literal URLs and skips non-releases", async () => {
  const manifest = fixture("swiftpm/Package.swift");
  for (const version of [1, 2, 3]) {
    const lock = fixture(`${version === 3 ? "swiftpm" : `swiftpm-v${version}`}/Package.resolved`);
    const rows = parseSwiftResolved(lock, manifest);
    expect(rows[0]).toEqual({
      name: "github.com/vapor/vapor",
      version: "4.50.0",
      direct: true,
      ecosystem: "SwiftURL",
      project: "Package.swift",
    });
    expect(rows).toHaveLength(version === 3 ? 2 : 1);
  }
  const repo = await collectFromFiles(
    "acme/swift",
    { "Package.swift": manifest, "Package.resolved": fixture("swiftpm/Package.resolved") },
    {
      warn: (message) => {
        throw new Error(message);
      },
    }
  );
  expect(repo?.dependencies.map((row) => [row.name, row.direct])).toEqual([
    ["github.com/apple/swift-nio", false],
    ["github.com/vapor/vapor", true],
  ]);
});
it("normalizes transport suffixes and GitHub case while preserving other hosts' paths", () => {
  expect(swiftPackageName("git@github.com:acme/Kit.git")).toBe("github.com/acme/kit");
  expect(swiftPackageName("https://www.github.com/Acme/Kit/")).toBe("github.com/acme/kit");
  expect(swiftPackageName("https://git.example/acme/Kit.git")).toBe("git.example/acme/Kit");
  expect(swiftPackageName("https://user:password@github.com/acme/kit")).toBeNull();
});
it("ignores commented declarations and retains owning manifests for nested locks", async () => {
  const repo = await collectFromFiles(
    "acme/swift",
    {
      "Package.swift":
        fixture("swiftpm/Package.swift") +
        '\n// .package(url: "https://github.com/apple/swift-nio.git", from: "2.0.0")\n',
      "Acme.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved": fixture(
        "swiftpm/Package.resolved"
      ),
    },
    { warn: () => {} }
  );
  expect(repo?.dependencies.find((row) => row.name === "github.com/vapor/vapor")?.project).toBe(
    "Package.swift"
  );
  expect(repo?.dependencies.find((row) => row.name === "github.com/apple/swift-nio")?.direct).toBe(
    false
  );
});
