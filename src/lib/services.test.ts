import { describe, expect, it } from "vitest";

import { SERVICES, serviceForPackage } from "./services";

describe("serviceForPackage", () => {
  it("maps packages to services from the plan", () => {
    expect(serviceForPackage("react-native-purchases")?.key).toBe("revenuecat");
    expect(serviceForPackage("@sentry/react-native")?.key).toBe("sentry");
    expect(serviceForPackage("expo")?.key).toBe("expo");
    expect(serviceForPackage("expo-router")?.key).toBe("expo");
    expect(serviceForPackage("react-native-google-mobile-ads")?.key).toBe("admob");
    expect(serviceForPackage("@anthropic-ai/sdk")?.key).toBe("anthropic");
  });

  it("keeps the Next.js framework and Vercel hosting apart", () => {
    expect(serviceForPackage("next")?.key).toBe("nextjs");
    expect(serviceForPackage("@next/env")?.key).toBe("nextjs");
    expect(serviceForPackage("@vercel/analytics")?.key).toBe("vercel");
  });

  it("does not map unrelated or look-alike packages", () => {
    expect(serviceForPackage("lodash")).toBeNull();
    expect(serviceForPackage("nextjs-toploader")).toBeNull();
    expect(serviceForPackage("react-native-reanimated")).toBeNull();
  });

  it("has unique service keys", () => {
    expect(new Set(SERVICES.map((s) => s.key)).size).toBe(SERVICES.length);
  });
});
