import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components/ui/toast";
import { resetEnvCache } from "@/lib/env";

import LandingPage from "../landing/page";
import { PricingCards } from "../pricing/_client";

// Every "Create an account" on the public pages opens /signup, never the sign-in form.

describe("public sign-up links", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it("point the landing page and the pricing cards at /signup", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://synthetic@localhost/none");
    vi.stubEnv("BETTER_AUTH_SECRET", "synthetic-test-secret-of-at-least-32-characters");
    vi.stubEnv("BETTER_AUTH_URL", "https://briff.example.com");
    vi.stubEnv("BRIFF_CLOUD", "true");
    resetEnvCache();
    const html = renderToStaticMarkup(
      createElement(ToastProvider, null, LandingPage(), createElement(PricingCards))
    );
    expect(html).toContain('href="/signup"');
    expect(html).not.toContain("mode=sign-up");
  });
});
