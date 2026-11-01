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

const REASON =
  "You got this email because a member of a Briff organisation invited this address. If you did not expect it, ignore it: nothing happens unless the link is opened.";

/** Names come from users; a line break in a subject would start a new mail header. */
function oneLine(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function expiryText(expiresAt: Date): string {
  return expiresAt.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function renderInviteEmail(args: {
  inviterName: string;
  orgName: string;
  role: "owner" | "member";
  url: string;
  expiresAt: Date;
  instanceUrl?: string;
}): RenderedEmail {
  const inviter = oneLine(args.inviterName);
  const org = oneLine(args.orgName);
  const subject = `${inviter} invited you to ${org} on Briff`;
  const lead =
    args.role === "owner"
      ? `Join ${org} as an owner: you get its weekly bulletins and security alerts, and you can manage its members.`
      : `Join ${org} to get its weekly bulletins and same-day security alerts for the repos it watches.`;
  const note = `The invite works once and expires on ${expiryText(args.expiresAt)}. Sign in or create an account with this email address to accept it.`;
  const footer = instanceFooter(REASON, args.instanceUrl);
  const body = [
    emailHeadline(subject),
    emailParagraph(lead),
    primaryButton(args.url, "Accept invite"),
    emailNote(note),
    fallbackUrl(args.url),
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
    text: [
      subject,
      "",
      lead,
      "",
      `Accept invite: ${safeUrl(args.url)}`,
      "",
      note,
      "",
      "--",
      footer,
    ].join("\n"),
  };
}
