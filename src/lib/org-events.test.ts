import { describe, expect, it } from "vitest";

import { eventSentence } from "./org-events";

const base = { actor: "Ada", targetEmail: "bob@example.com", detail: null };

describe("eventSentence", () => {
  it("words every event type", () => {
    expect(eventSentence({ ...base, type: "member_invited", detail: "member" })).toBe(
      "Ada invited bob@example.com as a member"
    );
    expect(eventSentence({ ...base, type: "member_invited", detail: "resent" })).toBe(
      "Ada sent a new invite link to bob@example.com"
    );
    expect(eventSentence({ ...base, type: "invite_accepted", detail: "owner" })).toBe(
      "bob@example.com joined as an owner"
    );
    expect(eventSentence({ ...base, type: "invite_revoked" })).toBe(
      "Ada revoked the invite for bob@example.com"
    );
    expect(eventSentence({ ...base, type: "member_removed" })).toBe("Ada removed bob@example.com");
    expect(eventSentence({ ...base, type: "member_removed", detail: "left" })).toBe(
      "bob@example.com left"
    );
    expect(eventSentence({ ...base, type: "role_changed", detail: "owner" })).toBe(
      "Ada made bob@example.com an owner"
    );
    expect(
      eventSentence({ ...base, type: "org_renamed", targetEmail: null, detail: "Old → New" })
    ).toBe("Ada renamed the organisation (Old → New)");
    expect(eventSentence({ ...base, type: "org_created", targetEmail: null })).toBe(
      "Ada created the organisation"
    );
  });

  it("names a deleted actor", () => {
    expect(eventSentence({ ...base, actor: null, type: "invite_revoked" })).toBe(
      "A deleted account revoked the invite for bob@example.com"
    );
  });

  it("says who changed the plan: billing or the instance admin", () => {
    expect(
      eventSentence({ ...base, actor: null, type: "plan_changed", detail: "paddle:free:pro" })
    ).toBe("Billing changed the plan from Free to Pro");
    expect(eventSentence({ ...base, type: "plan_changed", detail: "admin:team:unlimited" })).toBe(
      "The instance admin changed the plan from Team to Unlimited"
    );
  });
});
