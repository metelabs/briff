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

// Account emails (password reset, email verification). English only, like every other
// email (bulletin.md §15). The link is Better Auth's, built from BETTER_AUTH_URL.

const REASON =
  "You got this email because someone used this address on a Briff account. If it was not you, ignore it: nothing changes until the link is opened.";

function accountEmail(args: {
  subject: string;
  heading: string;
  lead: string;
  action: string;
  url: string;
  note: string;
  instanceUrl?: string;
}): RenderedEmail {
  const footer = instanceFooter(REASON, args.instanceUrl);
  const body = [
    emailHeadline(args.heading),
    emailParagraph(args.lead),
    primaryButton(args.url, args.action),
    emailNote(args.note),
    fallbackUrl(args.url),
  ].join("\n");
  return {
    subject: args.subject,
    html: emailShell({
      language: "en",
      title: args.subject,
      body,
      footer,
      assetBaseUrl: args.instanceUrl,
    }),
    text: [
      args.heading,
      "",
      args.lead,
      "",
      `${args.action}: ${safeUrl(args.url)}`,
      "",
      args.note,
      "",
      "--",
      footer,
    ].join("\n"),
  };
}

export function renderPasswordResetEmail(url: string, instanceUrl?: string): RenderedEmail {
  return accountEmail({
    subject: "Briff · reset your password",
    heading: "Reset your password",
    lead: "Someone asked to reset the password of your Briff account. Choose a new one with the button below.",
    action: "Choose a new password",
    url,
    note: "The link works once and expires in one hour.",
    instanceUrl,
  });
}

export function renderVerificationEmail(
  url: string,
  kind: "sign-up" | "change-email",
  instanceUrl?: string
): RenderedEmail {
  const change = kind === "change-email";
  return accountEmail({
    subject: change
      ? "Briff · confirm your new email address"
      : "Briff · verify your email address",
    heading: change ? "Confirm your new email address" : "Verify your email address",
    lead: change
      ? "You asked to sign in to Briff with this address. Confirm it and it replaces the old one."
      : "Confirm this address so bulletins and security alerts keep reaching you.",
    action: change ? "Confirm new address" : "Verify email address",
    url,
    note: "The link expires in 24 hours.",
    instanceUrl,
  });
}
