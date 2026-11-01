import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PublicFooter, PublicHeader } from "@/components/landing/public-chrome";
import { SiteFooter } from "@/components/shell/site-footer";
import { Accordion } from "@/components/ui/accordion";
import { resetEnvCache } from "@/lib/env";
import { PRICED_PLANS } from "@/lib/plans";

import robots from "../robots";
import sitemap from "../sitemap";

import PricingPage from "./page";
import { PricingCards } from "./_client";
import { FAQ } from "./faq";

// Self-hosters never see plans or prices: with BRIFF_CLOUD off the pricing page is a 404 and
// no public page, sitemap or robots file names it.

function useCloud(value: "true" | "false") {
  vi.stubEnv("BRIFF_CLOUD", value);
  resetEnvCache();
}

describe("pricing on the hosted service only", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "postgresql://synthetic@localhost/none");
    vi.stubEnv("BETTER_AUTH_SECRET", "synthetic-test-secret-of-at-least-32-characters");
    vi.stubEnv("BETTER_AUTH_URL", "https://briff.example.com");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it("is a 404 and absent from sitemap and robots when self-hosted", () => {
    useCloud("false");
    expect(() => PricingPage()).toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
    expect(sitemap().map((e) => e.url)).not.toContain("https://briff.example.com/pricing");
    expect(JSON.stringify(robots().rules)).not.toContain("/pricing");
  });

  it("is listed in the sitemap and allowed in robots on the hosted service", () => {
    useCloud("true");
    expect(sitemap().map((e) => e.url)).toContain("https://briff.example.com/pricing");
    expect(robots().rules).toMatchObject({ allow: expect.arrayContaining(["/pricing"]) });
  });

  it("links from the public header and footer only when asked to", () => {
    const html = (pricing: boolean) =>
      renderToStaticMarkup(createElement(PublicHeader, { pricing })) +
      renderToStaticMarkup(createElement(PublicFooter, { pricing }));
    expect(html(false)).not.toContain('href="/pricing"');
    expect(html(true).match(/href="\/pricing"/g)).toHaveLength(2);
    const shell = (pricing: boolean) =>
      renderToStaticMarkup(createElement(SiteFooter, { pricing }));
    expect(shell(false)).not.toContain('href="/pricing"');
    expect(shell(true)).toContain('href="/pricing"');
  });

  it("prices every card from PLANS", () => {
    const html = renderToStaticMarkup(createElement(PricingCards)).replace(/<[^>]+>/g, " ");
    for (const plan of PRICED_PLANS) {
      expect(html).toContain(plan.name);
      expect(html).toContain(`$${plan.monthlyUsd}`);
    }
    expect(html).toContain("Unlimited repos");
    expect(html).toContain("10 members");
  });
});

describe("pricing questions", () => {
  it("asks about the free plan first and lists the questions in visitor order", () => {
    expect(FAQ.map((f) => f.id)).toEqual([
      "free",
      "limits",
      "repo",
      "cancel",
      "self-hosting",
      "invoices",
      "tax",
    ]);
  });

  it("renders the first answer open and the rest closed but in the page", () => {
    const html = renderToStaticMarkup(
      createElement(Accordion, {
        defaultOpen: [FAQ[0].id],
        entries: FAQ.map((f) => ({ id: f.id, title: f.q, body: f.a })),
      })
    );
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(1);
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(FAQ.length - 1);
    for (const f of FAQ) expect(html).toContain(f.q);
  });
});
