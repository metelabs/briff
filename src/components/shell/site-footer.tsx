import packageJson from "../../../package.json";

import { PageContainer } from "./page-container";

const LINKS = [
  { href: "https://www.npmjs.com/package/briff-scan", label: "Docs" },
  { href: "https://github.com/metelabs/briff/releases", label: "Changelog" },
  { href: "/api/health", label: `Status · ${packageJson.version}` },
  { href: "https://metelabs.dev", label: "Made by Metelabs" },
] as const;

/** One muted line of links under every shell page. */
export function SiteFooter() {
  return (
    <footer className="border-line mt-auto border-t">
      <PageContainer className="text-fg-muted flex flex-wrap items-center gap-x-5 gap-y-1 py-5 text-[12.5px]">
        {LINKS.map((link) => (
          <a
            key={link.label}
            href={link.href}
            {...(link.href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}
            className="hover:text-fg underline-offset-4 transition-colors duration-150 hover:underline"
          >
            {link.label}
          </a>
        ))}
      </PageContainer>
    </footer>
  );
}
