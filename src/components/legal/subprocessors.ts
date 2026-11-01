// The companies that process personal data for the hosted service, shown on /privacy and
// /dpa. docs/PRIVACY.md lists every outbound connection; keep the two in step.

export interface Subprocessor {
  name: string;
  purpose: string;
  data: string;
  location: string;
}

export const SUBPROCESSORS: readonly Subprocessor[] = [
  {
    name: "Hetzner Online GmbH",
    purpose: "Servers, database and server snapshots",
    data: "Everything the service stores",
    location: "EU (Germany)",
  },
  {
    name: "Anthropic, PBC",
    purpose: "Language model for triage, the weekly bulletin and the interest profile",
    data: "Public release notes and advisories, package names and versions, profile text, repo aliases (never repo names, emails or names)",
    location: "United States",
  },
  {
    name: "Resend, Inc.",
    purpose: "Email delivery (SMTP relay)",
    data: "Recipient address and the email's content, which names your repos and packages",
    location: "United States",
  },
  {
    name: "Paddle.com Market Ltd",
    purpose: "Payments, as merchant of record (once paid plans open)",
    data: "What you enter at checkout: name, email, billing address, payment details",
    location: "United Kingdom",
  },
  {
    name: "GitHub, Inc.",
    purpose: "The GitHub App, when you connect it",
    data: "API requests for the repos and files you granted, and a one-time check that you can access the installation",
    location: "United States",
  },
  {
    name: "Cloudflare, Inc.",
    purpose: "Off-site backup storage",
    data: "Database backups, encrypted before upload; Cloudflare cannot read them",
    location: "Cloudflare R2 storage",
  },
];

/** Public data sources: they receive no personal data, so they are not sub-processors. */
export const PUBLIC_SOURCES =
  "OSV.dev (advisories), endoflife.date (support dates), npm and the other package registries, and public release feeds";
