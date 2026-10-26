// CVSS base scores from a vector string, for OSV records that carry a vector but no level
// (PYSEC-*, most native entries). CVSS 3.0/3.1: the FIRST specification's formulas. CVSS 4.0:
// the MacroVector scoring of FIRST's reference calculator (cvss40.js in
// github.com/RedHatProductSecurity/cvss-v4-calculator, which first.org/cvss/calculator/4.0
// serves; BSD-2-Clause, Copyright FIRST, Red Hat, and contributors), whose lookup and max
// tables are reproduced below.

export type SeverityLevel = "LOW" | "MODERATE" | "HIGH" | "CRITICAL";

/** GitHub's bands: low < 4.0 <= moderate < 7.0 <= high < 9.0 <= critical. */
export function levelOfScore(score: number): SeverityLevel {
  if (score >= 9) return "CRITICAL";
  if (score >= 7) return "HIGH";
  if (score >= 4) return "MODERATE";
  return "LOW";
}

/** The base score of a `CVSS:3.0`, `CVSS:3.1` or `CVSS:4.0` vector; null for anything else. */
export function cvssScore(vector: string): number | null {
  const [prefix, ...parts] = vector.trim().split("/");
  const metrics = new Map<string, string>();
  for (const part of parts) {
    const [key, value, extra] = part.split(":");
    if (!key || !value || extra !== undefined || metrics.has(key)) return null;
    metrics.set(key, value);
  }
  const score =
    prefix === "CVSS:3.0" || prefix === "CVSS:3.1"
      ? cvss3(metrics, prefix === "CVSS:3.1")
      : prefix === "CVSS:4.0"
        ? cvss4(metrics)
        : null;
  // An unknown threat or environmental value leaves no number to compare with.
  return score !== null && Number.isFinite(score) ? score : null;
}

/** The level of a vector's score; null when the vector cannot be scored. */
export function cvssLevel(vector: string): SeverityLevel | null {
  const score = cvssScore(vector);
  return score === null ? null : levelOfScore(score);
}

// --- CVSS 3.x ----------------------------------------------------------------------------

const V3 = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
  AC: { L: 0.77, H: 0.44 },
  UI: { N: 0.85, R: 0.62 },
  CIA: { H: 0.56, L: 0.22, N: 0 },
} as const;
const V3_PR = {
  U: { N: 0.85, L: 0.62, H: 0.27 },
  C: { N: 0.85, L: 0.68, H: 0.5 },
} as const;

function pick<T extends Record<string, number>>(
  table: T,
  value: string | undefined
): number | null {
  return value !== undefined && Object.hasOwn(table, value) ? table[value as keyof T] : null;
}

/** 3.1's Roundup (spec appendix A), which avoids floating-point surprises; 3.0's is a plain ceil. */
function roundUp(value: number, v31: boolean): number {
  if (!v31) return Math.ceil(value * 10) / 10;
  const int = Math.round(value * 100_000);
  return int % 10_000 === 0 ? int / 100_000 : (Math.floor(int / 10_000) + 1) / 10;
}

function cvss3(m: ReadonlyMap<string, string>, v31: boolean): number | null {
  const scope = m.get("S");
  if (scope !== "U" && scope !== "C") return null;
  const av = pick(V3.AV, m.get("AV"));
  const ac = pick(V3.AC, m.get("AC"));
  const pr = pick(V3_PR[scope], m.get("PR"));
  const ui = pick(V3.UI, m.get("UI"));
  const c = pick(V3.CIA, m.get("C"));
  const i = pick(V3.CIA, m.get("I"));
  const a = pick(V3.CIA, m.get("A"));
  if (av === null || ac === null || pr === null || ui === null) return null;
  if (c === null || i === null || a === null) return null;
  const iss = 1 - (1 - c) * (1 - i) * (1 - a);
  const impact =
    scope === "U" ? 6.42 * iss : 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15);
  if (impact <= 0) return 0;
  const exploitability = 8.22 * av * ac * pr * ui;
  const sum = scope === "U" ? impact + exploitability : 1.08 * (impact + exploitability);
  return roundUp(Math.min(sum, 10), v31);
}

// --- CVSS 4.0 ----------------------------------------------------------------------------

const V4_VALUES: Record<string, readonly string[]> = {
  AV: ["N", "A", "L", "P"],
  AC: ["L", "H"],
  AT: ["N", "P"],
  PR: ["N", "L", "H"],
  UI: ["N", "P", "A"],
  VC: ["H", "L", "N"],
  VI: ["H", "L", "N"],
  VA: ["H", "L", "N"],
  SC: ["H", "L", "N"],
  SI: ["H", "L", "N"],
  SA: ["H", "L", "N"],
};
const V4_BASE = Object.keys(V4_VALUES);

// Severity levels of each metric value, used for the distance to the MacroVector's maximum.
const LEVELS: Record<string, Record<string, number>> = {
  AV: { N: 0, A: 0.1, L: 0.2, P: 0.3 },
  PR: { N: 0, L: 0.1, H: 0.2 },
  UI: { N: 0, P: 0.1, A: 0.2 },
  AC: { L: 0, H: 0.1 },
  AT: { N: 0, P: 0.1 },
  VC: { H: 0, L: 0.1, N: 0.2 },
  VI: { H: 0, L: 0.1, N: 0.2 },
  VA: { H: 0, L: 0.1, N: 0.2 },
  SC: { H: 0.1, L: 0.2, N: 0.3 },
  SI: { S: 0, H: 0.1, L: 0.2, N: 0.3 },
  SA: { S: 0, H: 0.1, L: 0.2, N: 0.3 },
  CR: { H: 0, M: 0.1, L: 0.2 },
  IR: { H: 0, M: 0.1, L: 0.2 },
  AR: { H: 0, M: 0.1, L: 0.2 },
};

// The highest-severity vectors of each EQ level (max_composed.js).
const MAX_COMPOSED = {
  eq1: [
    ["AV:N/PR:N/UI:N/"],
    ["AV:A/PR:N/UI:N/", "AV:N/PR:L/UI:N/", "AV:N/PR:N/UI:P/"],
    ["AV:P/PR:N/UI:N/", "AV:A/PR:L/UI:P/"],
  ],
  eq2: [["AC:L/AT:N/"], ["AC:H/AT:N/", "AC:L/AT:P/"]],
  eq3eq6: [
    [
      ["VC:H/VI:H/VA:H/CR:H/IR:H/AR:H/"],
      ["VC:H/VI:H/VA:L/CR:M/IR:M/AR:H/", "VC:H/VI:H/VA:H/CR:M/IR:M/AR:M/"],
    ],
    [
      ["VC:L/VI:H/VA:H/CR:H/IR:H/AR:H/", "VC:H/VI:L/VA:H/CR:H/IR:H/AR:H/"],
      [
        "VC:L/VI:H/VA:L/CR:H/IR:M/AR:H/",
        "VC:L/VI:H/VA:H/CR:H/IR:M/AR:M/",
        "VC:H/VI:L/VA:H/CR:M/IR:H/AR:M/",
        "VC:H/VI:L/VA:L/CR:M/IR:H/AR:H/",
        "VC:L/VI:L/VA:H/CR:H/IR:H/AR:M/",
      ],
    ],
    [[], ["VC:L/VI:L/VA:L/CR:H/IR:H/AR:H/"]],
  ],
  eq4: [["SC:H/SI:S/SA:S/"], ["SC:H/SI:H/SA:H/"], ["SC:L/SI:L/SA:L/"]],
  eq5: [["E:A/"], ["E:P/"], ["E:U/"]],
} as const;

// Depth of each MacroVector per EQ, in severity steps (+1) (max_severity.js).
const MAX_SEVERITY = {
  eq1: [1, 4, 5],
  eq2: [1, 2],
  eq3eq6: [
    [7, 6],
    [8, 8],
    [Number.NaN, 10],
  ],
  eq4: [6, 5, 4],
} as const;

// MacroVector (EQ1..EQ6) -> score of its highest-severity vector (cvss_lookup.js).
const LOOKUP: Record<string, number> = {
  "000000": 10,
  "000001": 9.9,
  "000010": 9.8,
  "000011": 9.5,
  "000020": 9.5,
  "000021": 9.2,
  "000100": 10,
  "000101": 9.6,
  "000110": 9.3,
  "000111": 8.7,
  "000120": 9.1,
  "000121": 8.1,
  "000200": 9.3,
  "000201": 9,
  "000210": 8.9,
  "000211": 8,
  "000220": 8.1,
  "000221": 6.8,
  "001000": 9.8,
  "001001": 9.5,
  "001010": 9.5,
  "001011": 9.2,
  "001020": 9,
  "001021": 8.4,
  "001100": 9.3,
  "001101": 9.2,
  "001110": 8.9,
  "001111": 8.1,
  "001120": 8.1,
  "001121": 6.5,
  "001200": 8.8,
  "001201": 8,
  "001210": 7.8,
  "001211": 7,
  "001220": 6.9,
  "001221": 4.8,
  "002001": 9.2,
  "002011": 8.2,
  "002021": 7.2,
  "002101": 7.9,
  "002111": 6.9,
  "002121": 5,
  "002201": 6.9,
  "002211": 5.5,
  "002221": 2.7,
  "010000": 9.9,
  "010001": 9.7,
  "010010": 9.5,
  "010011": 9.2,
  "010020": 9.2,
  "010021": 8.5,
  "010100": 9.5,
  "010101": 9.1,
  "010110": 9,
  "010111": 8.3,
  "010120": 8.4,
  "010121": 7.1,
  "010200": 9.2,
  "010201": 8.1,
  "010210": 8.2,
  "010211": 7.1,
  "010220": 7.2,
  "010221": 5.3,
  "011000": 9.5,
  "011001": 9.3,
  "011010": 9.2,
  "011011": 8.5,
  "011020": 8.5,
  "011021": 7.3,
  "011100": 9.2,
  "011101": 8.2,
  "011110": 8,
  "011111": 7.2,
  "011120": 7,
  "011121": 5.9,
  "011200": 8.4,
  "011201": 7,
  "011210": 7.1,
  "011211": 5.2,
  "011220": 5,
  "011221": 3,
  "012001": 8.6,
  "012011": 7.5,
  "012021": 5.2,
  "012101": 7.1,
  "012111": 5.2,
  "012121": 2.9,
  "012201": 6.3,
  "012211": 2.9,
  "012221": 1.7,
  "100000": 9.8,
  "100001": 9.5,
  "100010": 9.4,
  "100011": 8.7,
  "100020": 9.1,
  "100021": 8.1,
  "100100": 9.4,
  "100101": 8.9,
  "100110": 8.6,
  "100111": 7.4,
  "100120": 7.7,
  "100121": 6.4,
  "100200": 8.7,
  "100201": 7.5,
  "100210": 7.4,
  "100211": 6.3,
  "100220": 6.3,
  "100221": 4.9,
  "101000": 9.4,
  "101001": 8.9,
  "101010": 8.8,
  "101011": 7.7,
  "101020": 7.6,
  "101021": 6.7,
  "101100": 8.6,
  "101101": 7.6,
  "101110": 7.4,
  "101111": 5.8,
  "101120": 5.9,
  "101121": 5,
  "101200": 7.2,
  "101201": 5.7,
  "101210": 5.7,
  "101211": 5.2,
  "101220": 5.2,
  "101221": 2.5,
  "102001": 8.3,
  "102011": 7,
  "102021": 5.4,
  "102101": 6.5,
  "102111": 5.8,
  "102121": 2.6,
  "102201": 5.3,
  "102211": 2.1,
  "102221": 1.3,
  "110000": 9.5,
  "110001": 9,
  "110010": 8.8,
  "110011": 7.6,
  "110020": 7.6,
  "110021": 7,
  "110100": 9,
  "110101": 7.7,
  "110110": 7.5,
  "110111": 6.2,
  "110120": 6.1,
  "110121": 5.3,
  "110200": 7.7,
  "110201": 6.6,
  "110210": 6.8,
  "110211": 5.9,
  "110220": 5.2,
  "110221": 3,
  "111000": 8.9,
  "111001": 7.8,
  "111010": 7.6,
  "111011": 6.7,
  "111020": 6.2,
  "111021": 5.8,
  "111100": 7.4,
  "111101": 5.9,
  "111110": 5.7,
  "111111": 5.7,
  "111120": 4.7,
  "111121": 2.3,
  "111200": 6.1,
  "111201": 5.2,
  "111210": 5.7,
  "111211": 2.9,
  "111220": 2.4,
  "111221": 1.6,
  "112001": 7.1,
  "112011": 5.9,
  "112021": 3,
  "112101": 5.8,
  "112111": 2.6,
  "112121": 1.5,
  "112201": 2.3,
  "112211": 1.3,
  "112221": 0.6,
  "200000": 9.3,
  "200001": 8.7,
  "200010": 8.6,
  "200011": 7.2,
  "200020": 7.5,
  "200021": 5.8,
  "200100": 8.6,
  "200101": 7.4,
  "200110": 7.4,
  "200111": 6.1,
  "200120": 5.6,
  "200121": 3.4,
  "200200": 7,
  "200201": 5.4,
  "200210": 5.2,
  "200211": 4,
  "200220": 4,
  "200221": 2.2,
  "201000": 8.5,
  "201001": 7.5,
  "201010": 7.4,
  "201011": 5.5,
  "201020": 6.2,
  "201021": 5.1,
  "201100": 7.2,
  "201101": 5.7,
  "201110": 5.5,
  "201111": 4.1,
  "201120": 4.6,
  "201121": 1.9,
  "201200": 5.3,
  "201201": 3.6,
  "201210": 3.4,
  "201211": 1.9,
  "201220": 1.9,
  "201221": 0.8,
  "202001": 6.4,
  "202011": 5.1,
  "202021": 2,
  "202101": 4.7,
  "202111": 2.1,
  "202121": 1.1,
  "202201": 2.4,
  "202211": 0.9,
  "202221": 0.4,
  "210000": 8.8,
  "210001": 7.5,
  "210010": 7.3,
  "210011": 5.3,
  "210020": 6,
  "210021": 5,
  "210100": 7.3,
  "210101": 5.5,
  "210110": 5.9,
  "210111": 4,
  "210120": 4.1,
  "210121": 2,
  "210200": 5.4,
  "210201": 4.3,
  "210210": 4.5,
  "210211": 2.2,
  "210220": 2,
  "210221": 1.1,
  "211000": 7.5,
  "211001": 5.5,
  "211010": 5.8,
  "211011": 4.5,
  "211020": 4,
  "211021": 2.1,
  "211100": 6.1,
  "211101": 5.1,
  "211110": 4.8,
  "211111": 1.8,
  "211120": 2,
  "211121": 0.9,
  "211200": 4.6,
  "211201": 1.8,
  "211210": 1.7,
  "211211": 0.7,
  "211220": 0.8,
  "211221": 0.2,
  "212001": 5.3,
  "212011": 2.4,
  "212021": 1.4,
  "212101": 2.4,
  "212111": 1.2,
  "212121": 0.5,
  "212201": 1,
  "212211": 0.3,
  "212221": 0.1,
};

function cvss4(given: ReadonlyMap<string, string>): number | null {
  for (const key of V4_BASE) {
    const value = given.get(key);
    if (value === undefined || !V4_VALUES[key].includes(value)) return null;
  }
  // The effective value: X defaults to the worst case for E/CR/IR/AR, a modified metric
  // (MAV, MSI, ...) overrides its base metric (cvss_score.js `m`).
  const m = (metric: string): string => {
    const selected = given.get(metric) ?? "X";
    if (selected === "X" && metric === "E") return "A";
    if (selected === "X" && (metric === "CR" || metric === "IR" || metric === "AR")) return "H";
    const modified = given.get(`M${metric}`);
    if (modified !== undefined && modified !== "X") return modified;
    return selected;
  };
  if (["VC", "VI", "VA", "SC", "SI", "SA"].every((metric) => m(metric) === "N")) return 0;

  const av = m("AV");
  const pr = m("PR");
  const ui = m("UI");
  const eq1 =
    av === "N" && pr === "N" && ui === "N"
      ? 0
      : (av === "N" || pr === "N" || ui === "N") && av !== "P"
        ? 1
        : 2;
  const eq2 = m("AC") === "L" && m("AT") === "N" ? 0 : 1;
  const vc = m("VC");
  const vi = m("VI");
  const va = m("VA");
  const eq3 = vc === "H" && vi === "H" ? 0 : vc === "H" || vi === "H" || va === "H" ? 1 : 2;
  const eq4 =
    m("MSI") === "S" || m("MSA") === "S"
      ? 0
      : m("SC") === "H" || m("SI") === "H" || m("SA") === "H"
        ? 1
        : 2;
  const e = m("E");
  const eq5 = e === "A" ? 0 : e === "P" ? 1 : e === "U" ? 2 : null;
  if (eq5 === null) return null;
  const eq6 =
    (m("CR") === "H" && vc === "H") ||
    (m("IR") === "H" && vi === "H") ||
    (m("AR") === "H" && va === "H")
      ? 0
      : 1;

  const macro = (a: number, b: number, c: number, d: number, f: number, g: number) =>
    `${a}${b}${c}${d}${f}${g}`;
  const value = LOOKUP[macro(eq1, eq2, eq3, eq4, eq5, eq6)];
  if (value === undefined) return null;
  const score = (key: string): number => LOOKUP[key] ?? Number.NaN;

  const lowerEq1 = score(macro(eq1 + 1, eq2, eq3, eq4, eq5, eq6));
  const lowerEq2 = score(macro(eq1, eq2 + 1, eq3, eq4, eq5, eq6));
  let lowerEq3Eq6: number;
  if (eq3 === 0 && eq6 === 0) {
    // Two paths down (00 -> 01, 00 -> 10): the higher one.
    const left = score(macro(eq1, eq2, eq3, eq4, eq5, eq6 + 1));
    const right = score(macro(eq1, eq2, eq3 + 1, eq4, eq5, eq6));
    lowerEq3Eq6 = left > right ? left : right;
  } else if (eq3 === 1 && eq6 === 0) {
    lowerEq3Eq6 = score(macro(eq1, eq2, eq3, eq4, eq5, eq6 + 1));
  } else if (eq3 === 2 && eq6 === 1) {
    lowerEq3Eq6 = Number.NaN;
  } else {
    lowerEq3Eq6 = score(macro(eq1, eq2, eq3 + 1, eq4, eq5, eq6));
  }
  const lowerEq4 = score(macro(eq1, eq2, eq3, eq4 + 1, eq5, eq6));
  const lowerEq5 = score(macro(eq1, eq2, eq3, eq4, eq5 + 1, eq6));

  // The first of the MacroVector's highest vectors that the scored vector does not exceed.
  const metricOf = (metric: string, vector: string): string => {
    const start = vector.indexOf(`${metric}:`) + metric.length + 1;
    const end = vector.indexOf("/", start);
    return vector.slice(start, end < 0 ? undefined : end);
  };
  const distanceMetrics = [
    "AV",
    "PR",
    "UI",
    "AC",
    "AT",
    "VC",
    "VI",
    "VA",
    "SC",
    "SI",
    "SA",
    "CR",
    "IR",
    "AR",
  ];
  let distance: Record<string, number> = {};
  for (const e1 of MAX_COMPOSED.eq1[eq1]) {
    for (const e2 of MAX_COMPOSED.eq2[eq2]) {
      for (const e36 of MAX_COMPOSED.eq3eq6[eq3][eq6]) {
        for (const e4 of MAX_COMPOSED.eq4[eq4]) {
          for (const e5 of MAX_COMPOSED.eq5[eq5]) {
            const max = e1 + e2 + e36 + e4 + e5;
            distance = Object.fromEntries(
              distanceMetrics.map((metric) => [
                metric,
                LEVELS[metric][m(metric)] - LEVELS[metric][metricOf(metric, max)],
              ])
            );
            if (Object.values(distance).every((d) => d >= 0)) return finish();
          }
        }
      }
    }
  }
  // As the reference: without an exact max, the last one compared is used.
  return finish();

  function finish(): number {
    const d = distance;
    const step = 0.1;
    const parts: [number, number, number][] = [
      [lowerEq1, d.AV + d.PR + d.UI, MAX_SEVERITY.eq1[eq1] * step],
      [lowerEq2, d.AC + d.AT, MAX_SEVERITY.eq2[eq2] * step],
      [lowerEq3Eq6, d.VC + d.VI + d.VA + d.CR + d.IR + d.AR, MAX_SEVERITY.eq3eq6[eq3][eq6] * step],
      [lowerEq4, d.SC + d.SI + d.SA, MAX_SEVERITY.eq4[eq4] * step],
      // EQ5's proportion is always 0, but an existing lower MacroVector still counts.
      [lowerEq5, 0, 1],
    ];
    let total = 0;
    let existing = 0;
    for (const [lower, current, depth] of parts) {
      const available = value - lower;
      if (Number.isNaN(available)) continue;
      existing++;
      total += available * (current / depth);
    }
    const mean = existing === 0 ? 0 : total / existing;
    const result = Math.min(10, Math.max(0, value - mean));
    // Round half up, nudged by 1e-6 so that 8.55 stored as 8.5499999 still rounds up.
    return Math.round((result + 1e-6) * 10) / 10;
  }
}
