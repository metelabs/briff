import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { baseImagePackages, imageDistro } from "./distros";

const fixture = readFileSync(new URL("./__fixtures__/distros/Dockerfile", import.meta.url), "utf8");

describe("base image distribution evidence", () => {
  it("resolves the explicit and maintained official-image variants", () => {
    expect(
      fixture
        .split("\n")
        .filter(Boolean)
        .map((line) => imageDistro(line.split(" ")[1]))
    ).toEqual(
      [
        ["debian", "12"],
        ["debian", "12"],
        ["ubuntu", "24.04"],
        ["alpine", "3.20"],
        ["debian", "12"],
        ["alpine", "3.20"],
        ["debian", "13"],
        ["debian", "13"],
      ].map(([name, version], i) => ({
        name,
        version,
        ecosystem:
          name === "debian"
            ? `Debian:${version}`
            : name === "ubuntu"
              ? `Ubuntu:${version}:LTS`
              : `Alpine:v${version}`,
        image: fixture.split("\n")[i].split(" ")[1],
      }))
    );
  });
  it("does not infer a distro for private images, digests, variables or floating Alpine variants", () => {
    for (const image of [
      "acme/node:22-bookworm",
      "node:22-alpine",
      "alpine:latest",
      "node:${NODE_VERSION}",
      "debian:12@sha256:abc",
      "node:22",
      "ubuntu:latest",
    ])
      expect(imageDistro(image), image).toBeNull();
  });
  it("uses the distro source package names without pretending to have a package inventory", () => {
    const alpine = imageDistro("alpine:3.20");
    const debian = imageDistro("debian:12");
    if (!alpine || !debian) throw new Error("Missing fixture distro");
    expect(baseImagePackages(alpine)).toContain("musl");
    expect(baseImagePackages(alpine)).not.toContain("glibc");
    expect(baseImagePackages(debian)).toContain("dpkg");
  });
});

it("does not apply current distro defaults to discontinued lines or historical patch tags", () => {
  const historical = readFileSync(
    new URL("./__fixtures__/distros/unqualified.txt", import.meta.url),
    "utf8"
  );
  for (const image of historical.trim().split("\n")) expect(imageDistro(image), image).toBeNull();
  expect(imageDistro("php:7.4-bullseye")?.version).toBe("11");
});
