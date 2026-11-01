import type { BulletinView, BulletinViewItem } from "@/pipeline/bulletin-model";

// The landing page's "What a bulletin looks like": one Monday bulletin for three fictional
// repos, shaped like a real week (two items that need attention, three good to know, three new
// advisories, five folded minor releases), rendered by the same BulletinContent as /b/<id>.
// Static data: the public page reads no database. Versions follow the fix rules in
// AGENTS.md (one command per installed release line, no major upgrades; an end-of-life line
// gets a migration sentence, never a command); the advisory ids are placeholders.

const BAKERY = "bakery.example";
const GARDEN = "garden.example";
const ORCHID = "orchid-hotel.example";

function item(
  fields: Partial<BulletinViewItem> & Pick<BulletinViewItem, "itemId">
): BulletinViewItem {
  return {
    bucket: "breaking_or_feature",
    headline: "",
    line: "",
    action: "",
    todo: null,
    title: fields.headline ?? "",
    url: "https://example.com/",
    sourceName: "",
    affectedRepos: [],
    dueAt: null,
    folded: [],
    upgrades: [],
    ...fields,
  };
}

function minor(itemId: string, title: string, url: string, repos: string[]): BulletinViewItem {
  return item({
    itemId,
    bucket: "minor",
    headline: title,
    title,
    line: "Patch release, no breaking changes listed.",
    url,
    sourceName: "GitHub releases",
    affectedRepos: repos,
  });
}

export const SAMPLE_BULLETIN: BulletinView = {
  id: "sample",
  orgId: "sample",
  weekLabel: "Week 2026-W44",
  streamId: "sample",
  streamName: "Weekly",
  language: "en",
  subject: "Briff · Weekly · W44: Next.js · PHP 8.2 and more",
  summary:
    "A Next.js security fix for two repos, PHP 8.2's end of life for the hotel site, and three advisories in dependencies.",
  minorCount: 5,
  model: "sample",
  promptVersion: "sample",
  createdAt: new Date("2026-10-26T04:00:00Z"),
  emailStatus: "sent",
  emailSentAt: new Date("2026-10-26T04:02:00Z"),
  preview: false,
  act: [
    item({
      itemId: "next-security",
      bucket: "security",
      headline: "Next.js 16.3.8 and 15.5.12 fix a middleware authorization bypass",
      title: "Next.js security release: middleware authorization bypass",
      line: "A crafted request header can skip middleware checks on self-hosted apps; both repos gate admin pages in middleware.",
      action: `npm i next@16.3.8 (${GARDEN}) · npm i next@15.5.12 (${BAKERY})`,
      url: "https://nextjs.org/blog",
      sourceName: "Next.js blog",
      affectedRepos: [BAKERY, GARDEN],
      folded: [
        {
          title: "vercel/next.js v16.3.8",
          url: "https://github.com/vercel/next.js/releases/tag/v16.3.8",
          release: true,
        },
        {
          title: "vercel/next.js v15.5.12",
          url: "https://github.com/vercel/next.js/releases/tag/v15.5.12",
          release: true,
        },
      ],
      upgrades: [
        { repo: BAKERY, name: "next", installed: ["15.5.9"], target: "15.5.12" },
        { repo: GARDEN, name: "next", installed: ["16.3.5"], target: "16.3.8" },
      ],
    }),
    item({
      itemId: "php-eol",
      bucket: "deadline",
      headline: "PHP 8.2 reaches end of life on 31 December",
      title: "PHP 8.2 security support ends",
      line: "After that date 8.2 gets no security fixes; orchid-hotel.example runs php:8.2-apache.",
      action: "php 8.2 is end-of-life on 31 Dec 2026; move to 8.3 or later before then",
      url: "https://www.php.net/supported-versions.php",
      sourceName: "php.net",
      affectedRepos: [ORCHID],
      dueAt: new Date("2026-12-31T00:00:00Z"),
      upgrades: [
        { repo: ORCHID, name: "php", installed: ["8.2.29"], target: null, source: "Dockerfile" },
      ],
    }),
  ],
  know: [
    item({
      itemId: "vite-72",
      headline: "Vite 7.2 speeds up cold starts and adds a stable environment API",
      line: "Minor release; the changelog lists no breaking changes for plugin authors.",
      todo: "upgrade",
      action: "when convenient",
      url: "https://vite.dev/blog",
      sourceName: "Vite blog",
      affectedRepos: [BAKERY, GARDEN],
      upgrades: [
        { repo: BAKERY, name: "vite", installed: ["7.1.4"], target: "7.2.0" },
        { repo: GARDEN, name: "vite", installed: ["7.1.9"], target: "7.2.0" },
      ],
    }),
    item({
      itemId: "prisma-71",
      headline: "Prisma ORM 7.1 makes the query compiler the default",
      line: "Read the upgrade notes before moving: raw query typing changed.",
      todo: "read",
      action: "before the next Prisma upgrade",
      url: "https://www.prisma.io/blog",
      sourceName: "Prisma blog",
      affectedRepos: [GARDEN],
    }),
    item({
      itemId: "node-26-lts",
      headline: "Node.js 26 enters long-term support",
      line: "Your Node repos are on 22 and 24, both supported until 2027 or later.",
      todo: "wait",
      action: "until 26.1 has settled",
      url: "https://nodejs.org/en/blog",
      sourceName: "Node.js blog",
      affectedRepos: [BAKERY, GARDEN],
    }),
  ],
  rest: [],
  minor: [
    minor("eslint", "eslint v9.39.1", "https://github.com/eslint/eslint/releases", [
      BAKERY,
      GARDEN,
    ]),
    minor("typescript", "TypeScript 5.9.3", "https://github.com/microsoft/TypeScript/releases", [
      BAKERY,
      GARDEN,
    ]),
    minor("zod", "zod v4.1.12", "https://github.com/colinhacks/zod/releases", [GARDEN]),
    minor("prettier", "prettier 3.6.2", "https://github.com/prettier/prettier/releases", [BAKERY]),
    minor("composer", "composer 2.8.12", "https://github.com/composer/composer/releases", [ORCHID]),
  ],
  alerts: [
    {
      packageName: "axios",
      severity: "HIGH",
      osvIds: ["GHSA-0000-0000-0001"],
      repos: [BAKERY],
      fixed: "1.13.2",
      noLineFix: false,
      transitive: false,
      installs: [{ repo: BAKERY, name: "axios", installed: ["1.12.0"], target: "1.13.2" }],
    },
    {
      packageName: "nodemailer",
      severity: "MODERATE",
      osvIds: ["GHSA-0000-0000-0002"],
      repos: [GARDEN],
      fixed: "7.0.11",
      noLineFix: false,
      transitive: false,
      installs: [{ repo: GARDEN, name: "nodemailer", installed: ["7.0.9"], target: "7.0.11" }],
    },
    {
      packageName: "brace-expansion",
      severity: "LOW",
      osvIds: ["GHSA-0000-0000-0003"],
      repos: [BAKERY, GARDEN],
      fixed: null,
      noLineFix: false,
      transitive: true,
      installs: [
        {
          repo: BAKERY,
          name: "brace-expansion",
          installed: ["2.0.1"],
          target: null,
          transitive: true,
        },
        {
          repo: GARDEN,
          name: "brace-expansion",
          installed: ["2.0.1"],
          target: null,
          transitive: true,
        },
      ],
    },
  ],
  backlogAlerts: [],
};
