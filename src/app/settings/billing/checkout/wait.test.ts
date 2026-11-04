import { describe, expect, it } from "vitest";

import {
  upgradedHref,
  WAIT_FOR_MS,
  WAIT_POLL_MS,
  waitForSubscription,
  waitPhase,
  type CheckoutStatus,
  type WaitDeps,
} from "./wait";

function clock(answers: (CheckoutStatus | Error)[], over: Partial<WaitDeps> = {}) {
  let t = 0;
  let checks = 0;
  const sleeps: number[] = [];
  const deps: WaitDeps = {
    check: async () => {
      const a = answers[Math.min(checks++, answers.length - 1)];
      if (a instanceof Error) throw a;
      return a;
    },
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    now: () => t,
    isActive: () => true,
    ...over,
  };
  return { deps, sleeps, checks: () => checks };
}

const NOT_YET: CheckoutStatus = { ready: false };

describe("waitPhase", () => {
  it("is ready once the subscription is there, even at the deadline", () => {
    expect(waitPhase({ ready: true, plan: "pro" }, 0)).toBe("ready");
    expect(waitPhase({ ready: true, plan: "team" }, WAIT_FOR_MS + 1)).toBe("ready");
  });

  it("waits until the deadline, then times out", () => {
    expect(waitPhase(NOT_YET, 0)).toBe("waiting");
    expect(waitPhase(NOT_YET, WAIT_FOR_MS - 1)).toBe("waiting");
    expect(waitPhase(NOT_YET, WAIT_FOR_MS)).toBe("timed-out");
  });
});

describe("waitForSubscription", () => {
  it("polls every 2 s and stops at the first ready answer", async () => {
    const c = clock([NOT_YET, NOT_YET, { ready: true, plan: "pro" }]);
    expect(await waitForSubscription(c.deps)).toEqual({ phase: "ready", plan: "pro" });
    expect(c.checks()).toBe(3);
    expect(c.sleeps).toEqual([WAIT_POLL_MS, WAIT_POLL_MS]);
  });

  it("times out after a minute of no webhook, without asking again", async () => {
    const c = clock([NOT_YET]);
    expect(await waitForSubscription(c.deps)).toEqual({ phase: "timed-out" });
    expect(c.checks()).toBe(WAIT_FOR_MS / WAIT_POLL_MS + 1);
  });

  it("treats a failed check as not yet", async () => {
    const c = clock([new Error("network"), { ready: true, plan: "team" }]);
    expect(await waitForSubscription(c.deps)).toEqual({ phase: "ready", plan: "team" });
  });

  it("stops quietly once the page is gone", async () => {
    let active = true;
    const c = clock([NOT_YET], {
      sleep: async () => {
        active = false;
      },
      isActive: () => active,
    });
    expect(await waitForSubscription(c.deps)).toBeNull();
    expect(c.checks()).toBe(1);
  });
});

describe("upgradedHref", () => {
  it("lands on Billing with the plan's flash", () => {
    expect(upgradedHref("pro")).toBe("/settings/billing?upgraded=pro");
  });
});
