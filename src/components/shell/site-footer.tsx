import { DOCS_URL, STATUS_PATH, TRUST_LINKS } from "@/components/landing/links";
import { docsHref } from "@/lib/docs/nav";
import { SUPPORT_EMAIL } from "@/lib/legal";

import packageJson from "../../../package.json";

import { PageContainer } from "./page-container";

const CHANGELOG_PATH = docsHref("project/changelog");

const LINKS = [
  ...TRUST_LINKS.map((link) =>
    link.href === STATUS_PATH ? { ...link, label: `Status · ${packageJson.version}` } : link
  ),
  { href: DOCS_URL, label: "Docs" },
  { href: CHANGELOG_PATH, label: "Changelog" },
  { href: "https://metelabs.dev", label: "Made by Metelabs" },
];

/** One muted line of links under every shell page; `pricing` on the hosted service only. */
export function SiteFooter({ pricing = false }: { pricing?: boolean }) {
  const links = pricing ? [...LINKS, { href: "/pricing", label: "Pricing" }] : LINKS;
  return (
    <footer className="border-line mt-auto border-t">
      <PageContainer className="text-fg-muted flex flex-wrap items-center gap-x-5 gap-y-1 py-5 text-[12.5px]">
        {links.map((link) => (
          <a
            key={link.label}
            href={link.href}
            {...(link.href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}
            className="hover:text-fg underline-offset-4 transition-colors duration-150 hover:underline"
          >
            {link.label}
          </a>
        ))}
        <span>Contact: {SUPPORT_EMAIL}</span>
      </PageContainer>
    </footer>
  );
}
