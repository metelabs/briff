import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import * as legal from "@/lib/legal";
import { placeholdersIn } from "@/lib/legal";

import { DPA } from "./dpa";
import { LegalArticle } from "./legal-page";
import { PRIVACY } from "./privacy";
import { REFUNDS } from "./refunds";
import { TERMS } from "./terms";

// The legal pages name the operator through src/lib/legal.ts. Until the founder fills in the
// bracketed values, vitest.config.mts sets LEGAL_PLACEHOLDERS_ALLOWED=true; remove that line
// once they are filled and this test keeps any placeholder from coming back. Either way, a
// placeholder typed straight into a page (not a legal.ts constant) fails.

const DOCS = [TERMS, PRIVACY, REFUNDS, DPA];
const ALLOWED = process.env.LEGAL_PLACEHOLDERS_ALLOWED === "true";

const constantPlaceholders = new Set(
  Object.values(legal).flatMap((v) => (typeof v === "string" ? placeholdersIn(v) : []))
);

function rendered(doc: (typeof DOCS)[number]): string {
  return renderToStaticMarkup(createElement(LegalArticle, { doc }));
}

describe("legal pages", () => {
  it.each(DOCS.map((d) => [d.path, d] as const))("%s renders its title and sections", (_, doc) => {
    const html = rendered(doc);
    expect(html).toContain(doc.title);
    for (const s of doc.sections) expect(html).toContain(`id="${s.id}"`);
  });

  it.each(DOCS.map((d) => [d.path, d] as const))(
    "%s shows only placeholders defined in src/lib/legal.ts",
    (_, doc) => {
      const stray = placeholdersIn(rendered(doc)).filter((p) => !constantPlaceholders.has(p));
      expect(stray).toEqual([]);
    }
  );

  it.skipIf(ALLOWED).each(DOCS.map((d) => [d.path, d] as const))(
    "%s has every placeholder filled in",
    (_, doc) => {
      expect(placeholdersIn(rendered(doc))).toEqual([]);
    }
  );

  it("the detector finds the placeholder forms legal.ts uses", () => {
    expect(placeholdersIn("By [LEGAL_NAME], [ADDRESS]. [ADDRESS]")).toEqual([
      "[ADDRESS]",
      "[LEGAL_NAME]",
    ]);
    expect(placeholdersIn("see [1], [a], GDPR art. 6(1)(b)")).toEqual([]);
  });

  it("the allowance is only switched on while legal.ts still has placeholders", () => {
    if (!ALLOWED) return;
    expect(constantPlaceholders.size).toBeGreaterThan(0);
  });
});

describe("security.txt", () => {
  const text = readFileSync(
    path.resolve(__dirname, "../../../public/.well-known/security.txt"),
    "utf8"
  );

  it("names the contact, the policy and the languages", () => {
    expect(text).toContain(`Contact: mailto:${legal.SECURITY_EMAIL}`);
    expect(text).toMatch(/^Policy: https:\/\/github\.com\/.+\/SECURITY\.md$/m);
    expect(text).toMatch(/^Preferred-Languages: en, tr$/m);
  });

  it("has an Expires date at least 30 days ahead (renew it yearly, RFC 9116)", () => {
    const expires = /^Expires: (.+)$/m.exec(text)?.[1];
    expect(expires).toBeDefined();
    const days = (Date.parse(expires ?? "") - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(30);
    expect(days).toBeLessThanOrEqual(366);
  });
});
