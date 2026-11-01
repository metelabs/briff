import { PLANS, type PlanId } from "@/lib/plans";

import type { RenderedEmail } from "./bulletin-email";
import {
  emailHeadline,
  emailNote,
  emailParagraph,
  fallbackUrl,
  instanceFooter,
  primaryButton,
} from "./components";
import { emailShell, safeUrl } from "./layout";

// Billing emails to an org's owners (billing-notify job, src/lib/billing/jobs.ts). English
// only. Links go to Settings -> Billing, which opens a fresh Paddle portal session on demand:
// portal URLs are one-time and expire, so an email never carries one.

export type BillingEmail =
  | { kind: "plan-changed"; from: PlanId; to: PlanId }
  | { kind: "payment-failed"; plan: PlanId; graceEndsAt: Date | null }
  | { kind: "canceled"; plan: PlanId; endsAt: Date };

const REASON =
  "You get this because you are an owner of this organisation on Briff. Payments are handled by Paddle, our merchant of record.";

/** Names come from users; a line break in a subject would start a new mail header. */
function oneLine(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function longDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function copy(
  email: BillingEmail,
  org: string
): { subject: string; lead: string; note: string; action: string } {
  switch (email.kind) {
    case "plan-changed": {
      const to = PLANS[email.to].name;
      const from = PLANS[email.from].name;
      return email.to === "free"
        ? {
            subject: `${org} is on the Free plan now`,
            lead: `The paid plan of ${org} ended, so it moved from ${from} to Free. Nothing was deleted: past the Free limits, new repos and streams are refused until you upgrade again.`,
            note: "You can pick a plan again at any time on the billing page.",
            action: "Open billing",
          }
        : {
            subject: `${org} is on the ${to} plan`,
            lead: `${org} moved from ${from} to ${to}. The new limits apply now: ${limits(email.to)}.`,
            note: "Paddle sends the receipt and invoice separately.",
            action: "Open billing",
          };
    }
    case "payment-failed": {
      const plan = PLANS[email.plan].name;
      const until = email.graceEndsAt
        ? ` ${org} keeps ${plan} until ${longDate(email.graceEndsAt)} while Paddle retries the payment; after that it moves to Free.`
        : "";
      return {
        subject: `Payment failed for ${org}`,
        lead: `The latest payment for the ${plan} plan of ${org} did not go through.${until}`,
        note: "Update the payment method from the billing page (Manage payment method and invoices). Paddle retries the charge on its own.",
        action: "Update payment method",
      };
    }
    case "canceled": {
      const plan = PLANS[email.plan].name;
      return {
        subject: `${org}: ${plan} ends on ${longDate(email.endsAt)}`,
        lead: `The ${plan} subscription of ${org} was canceled. It stays active until ${longDate(email.endsAt)}, then the organisation moves to Free. Nothing is deleted.`,
        note: "Changed your mind? Resume the subscription on the billing page before that date.",
        action: "Open billing",
      };
    }
  }
}

function limits(plan: PlanId): string {
  const p = PLANS[plan];
  const n = (v: number | null, noun: string) =>
    v === null ? `unlimited ${noun}s` : `${v} ${noun}${v === 1 ? "" : "s"}`;
  return `${n(p.repos, "repo")}, ${n(p.streams, "stream")}, ${n(p.members, "member")}`;
}

export function renderBillingEmail(
  email: BillingEmail,
  args: { orgName: string; instanceUrl: string }
): RenderedEmail {
  const org = oneLine(args.orgName, 60);
  const { subject, lead, note, action } = copy(email, org);
  const url = `${args.instanceUrl.replace(/\/$/, "")}/settings/billing`;
  const footer = instanceFooter(REASON, args.instanceUrl);
  const body = [
    emailHeadline(subject),
    emailParagraph(lead),
    primaryButton(url, action),
    emailNote(note),
    fallbackUrl(url),
  ].join("\n");
  return {
    subject,
    html: emailShell({
      language: "en",
      title: subject,
      body,
      footer,
      assetBaseUrl: args.instanceUrl,
    }),
    text: [subject, "", lead, "", `${action}: ${safeUrl(url)}`, "", note, "", "--", footer].join(
      "\n"
    ),
  };
}
