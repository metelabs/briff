import { describe, expect, it } from "vitest";

import { scanDependencySchema } from "./schema";

describe("scanDependencySchema", () => {
  it("accepts a Python package aggregated across many declarations", () => {
    const declarations = Array.from(
      { length: 40 },
      (_, i) => `acme-probe; sys_platform == "plat${i}"\t>=1.0`
    );
    const parsed = scanDependencySchema.safeParse({
      name: "acme-probe",
      version: "1.0.0",
      direct: true,
      ecosystem: "PyPI",
      manager: "uv",
      group: Array.from({ length: 40 }, (_, i) => `group-${i}`).join(","),
      requirement: declarations.join("\n"),
      project: [".", ...Array.from({ length: 40 }, (_, i) => `member-${i}:.`)].join(","),
    });
    expect(parsed.success).toBe(true);
  });
});
