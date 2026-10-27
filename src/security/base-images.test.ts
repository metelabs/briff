import { describe, expect, it } from "vitest";

import { imageDistro } from "@scan/distros";

import { baseImageAction } from "./base-images";

const now = new Date("2026-10-26T12:00:00Z");
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
