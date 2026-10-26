import { describe, expect, it } from "vitest";

import { cvssLevel, cvssScore, levelOfScore } from "./cvss";

// Expected scores are FIRST's calculators' (first.org/cvss/calculator/3.1 and /4.0).
describe("cvssScore 3.x", () => {
  it.each([
    ["CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", 9.8],
    ["CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:N/I:H/A:N", 5.5],
    ["CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:N/A:N", 7.7],
    ["CVSS:3.1/AV:P/AC:H/PR:H/UI:R/S:U/C:L/I:N/A:N", 1.6],
    ["CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H", 10],
    ["CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N", 0],
    ["CVSS:3.0/AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:N/A:N", 7.7],
    // Temporal metrics after the base ones are ignored (GHSA-5rcv-m4m3-hfh7).
    ["CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H/E:P/RL:O/RC:C", 7.5],
  ])("%s = %s", (vector, score) => {
    expect(cvssScore(vector)).toBe(score);
  });
});

describe("cvssScore 4.0 (MacroVector scoring)", () => {
  it.each([
    ["CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N", 9.3],
    ["CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:L/VI:H/VA:L/SC:N/SI:H/SA:L", 9.2],
    ["CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:L/VI:L/VA:N/SC:N/SI:L/SA:N", 6.9],
    ["CVSS:4.0/AV:L/AC:L/AT:P/PR:N/UI:A/VC:N/VI:N/VA:L/SC:H/SI:H/SA:H", 5],
    ["CVSS:4.0/AV:P/AC:H/AT:P/PR:H/UI:A/VC:L/VI:L/VA:L/SC:L/SI:L/SA:L", 1],
    // 8.55 in floating point is 8.549999...; the calculator still rounds it up.
    ["CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:P/VC:H/VI:L/VA:N/SC:H/SI:H/SA:H", 8.6],
    // No impact on either system scores 0, whatever else the vector says.
    ["CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:N/VA:N/SC:N/SI:N/SA:N/E:A", 0],
    // Threat, environmental and supplemental metrics.
    ["CVSS:4.0/AV:P/AC:H/AT:P/PR:H/UI:A/VC:H/VI:H/VA:H/SC:H/SI:H/SA:H/E:P", 5.9],
    ["CVSS:4.0/AV:P/AC:H/AT:P/PR:H/UI:A/VC:H/VI:H/VA:H/SC:H/SI:H/SA:H/E:U", 4.1],
    ["CVSS:4.0/AV:P/AC:H/AT:P/PR:H/UI:A/VC:H/VI:H/VA:H/SC:H/SI:H/SA:H/CR:H/IR:H/AR:H", 7.3],
    [
      "CVSS:4.0/AV:P/AC:H/AT:P/PR:H/UI:A/VC:H/VI:H/VA:H/SC:H/SI:H/SA:H/S:N/AU:N/R:A/V:D/RE:L/U:Clear",
      7.3,
    ],
  ])("%s = %s", (vector, score) => {
    expect(cvssScore(vector)).toBe(score);
  });

  it("scores the vectors of the recorded OSV records as GitHub rates them", () => {
    // GHSA-gmj6-6f8f-6699 (jinja2): moderate on GitHub, from this vector.
    expect(cvssLevel("CVSS:4.0/AV:L/AC:L/AT:P/PR:L/UI:P/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N")).toBe(
      "MODERATE"
    );
    // GHSA-2xpw-w6gg-jr37 (urllib3): high.
    expect(cvssLevel("CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:N/VC:N/VI:N/VA:H/SC:N/SI:N/SA:H")).toBe(
      "HIGH"
    );
  });
});

describe("cvssScore input", () => {
  it.each([
    "",
    "AV:N/AC:L/Au:N/C:P/I:P/A:P",
    "CVSS:2.0/AV:N/AC:L/Au:N/C:P/I:P/A:P",
    "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/C:H/I:H/A:H",
    "CVSS:3.1/AV:X/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
    "CVSS:3.1/AV:N/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
    "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N",
    "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N/E:Q",
  ])("cannot score %j", (vector) => {
    expect(cvssScore(vector)).toBeNull();
    expect(cvssLevel(vector)).toBeNull();
  });
});

describe("levelOfScore (GitHub's bands)", () => {
  it.each([
    [0, "LOW"],
    [3.9, "LOW"],
    [4, "MODERATE"],
    [6.9, "MODERATE"],
    [7, "HIGH"],
    [8.9, "HIGH"],
    [9, "CRITICAL"],
    [10, "CRITICAL"],
  ] as const)("%s -> %s", (score, level) => {
    expect(levelOfScore(score)).toBe(level);
  });
});
