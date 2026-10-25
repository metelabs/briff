import { advisoryItems, feedItems, hourly } from "../fixtures";
import type { ReplayItem, ReplayScenario } from "../types";

// PHP2Shell (CVE-2026-109618, CVE-2026-109619), October 2026. Items: the php.net news
// feed and the php/php-src GitHub advisories as fetched on 22 Oct 2026 (PR #11 fixtures).
// php.net dates its 21 Oct release posts 00:05-00:35 UTC, the entry time; the release went
// public at 13:40 UTC (ENISA joint statement), so that is when the feed could show them.

const PHP_NEWS = "PHP news";
const PHP_ADVISORIES = "php/php-src security advisories";
const RELEASE_PUBLIC = new Date("2026-10-21T13:40:00Z");

const at = (iso: string) => new Date(iso);

function withVisibility(items: ReplayItem[]): ReplayItem[] {
  return items.map((i) =>
    i.url.includes("#2026-10-21-") ? { ...i, visibleAt: RELEASE_PUBLIC } : i
  );
}

export const php2shell: ReplayScenario = {
  id: "php2shell",
  title: "PHP2Shell, October 2026",
  summary:
    "Two critical PHP remote code execution flaws leaked before their coordinated release. php.net gave a day's notice, then shipped 8.5.12, 8.4.27, 8.3.36 and 8.2.35. Three sample repos: a floating php:8.3-fpm image, a pinned php:8.1.31-apache image on an end-of-life line, and an api pinned to php 8.4.26 in .tool-versions.",
  repos: [
    {
      name: "garden.example",
      files: {
        Dockerfile: "FROM php:8.3-fpm\n",
        "composer.json": JSON.stringify({ require: { php: "^8.3" } }),
      },
    },
    { name: "legacy-shop", files: { Dockerfile: "FROM php:8.1.31-apache\n" } },
    { name: "api", files: { ".tool-versions": "php 8.4.26\n" } },
  ],
  sources: [
    {
      name: PHP_NEWS,
      kind: "rss",
      url: "https://www.php.net/feed.atom",
      class: "security",
      runtime: "php",
    },
    {
      name: PHP_ADVISORIES,
      kind: "github_advisories",
      url: "https://api.github.com/repos/php/php-src/security-advisories",
      class: "security",
      runtime: "php",
    },
  ],
  items: [
    ...withVisibility(feedItems("php-news.atom", PHP_NEWS)),
    ...advisoryItems("github-advisories-php.json", PHP_ADVISORIES, "php"),
  ],
  world: [
    {
      at: at("2026-10-17T00:00:00Z"),
      dateOnly: true,
      title: "Amazon's MadPot honeypots log a PHP2Shell exploitation attempt",
      detail: "Four days before disclosure, while the flaws were still under embargo.",
      sources: [
        {
          label: "AWS Security Blog",
          url: "https://aws.amazon.com/blogs/security/amazon-threat-intelligence-identifies-php2shell-exploitation-prior-to-public-disclosure-in-madpot/",
        },
      ],
    },
    {
      at: at("2026-10-20T00:00:00Z"),
      dateOnly: true,
      title: "A Hacker News post leaks two critical PHP RCEs ahead of the embargo",
      detail: "It quotes the CVE numbers and a 22 October disclosure date; the post is deleted.",
      sources: [
        {
          label: "BleepingComputer",
          url: "https://www.bleepingcomputer.com/news/security/php-warns-admins-of-two-critical-flaws-emergency-patches-coming-tomorrow/",
        },
        {
          label: "iTnews",
          url: "https://www.itnews.com.au/news/critical-flaws-strike-php-as-disclosure-embargo-is-broken-629794",
        },
      ],
    },
    {
      at: at("2026-10-20T00:01:00Z"),
      dateOnly: true,
      title: "watchTowr confirms the vulnerabilities are real",
      sources: [
        { label: "watchTowr on X", url: "https://x.com/watchtowrcyber/status/2112611507749982605" },
      ],
    },
    {
      at: at("2026-10-20T20:32:00Z"),
      title: "php.net posts advance notice of a critical security release",
      detail:
        "Scheduled for Wednesday 21 October, 14:00 UTC. Two critical vulnerabilities, both CVSS v4.0 9.2; no versions or details yet.",
      sources: [{ label: "php.net", url: "https://www.php.net/archive/2026.php#2026-10-20-1" }],
    },
    {
      at: at("2026-10-21T03:02:00Z"),
      title: "Cloudflare turns on WAF rules for the known exploit paths",
      detail: "For every plan, Free included; described as a stopgap, not a fix.",
      sources: [
        {
          label: "PPC Land",
          url: "https://ppc.land/cloudflare-blocks-php2shell-exploits-9-hours-before-php-flaws-went-public/",
        },
      ],
    },
    {
      at: at("2026-10-21T13:34:13Z"),
      title: "GitHub advisories GHSA-6wmf-4rv5-p3rp and GHSA-w8hw-w9fx-j79w are published",
      detail: "Both critical, CVSS 9.2, patched in 8.2.35, 8.3.36, 8.4.27 and 8.5.12.",
      sources: [
        {
          label: "GHSA-w8hw-w9fx-j79w",
          url: "https://github.com/php/php-src/security/advisories/GHSA-w8hw-w9fx-j79w",
        },
        {
          label: "GHSA-6wmf-4rv5-p3rp",
          url: "https://github.com/php/php-src/security/advisories/GHSA-6wmf-4rv5-p3rp",
        },
      ],
    },
    {
      at: RELEASE_PUBLIC,
      title: "PHP 8.5.12, 8.4.27, 8.3.36 and 8.2.35 are released",
      detail:
        "CVE-2026-109618 and CVE-2026-109619, CVSS 9.2. Every web SAPI is at risk (PHP-FPM, mod_php, php-cgi, FrankenPHP, LiteSpeed); mod_php is the worst. PHP 8.1 and older get no release.",
      sources: [
        { label: "php.net advisory", url: "https://www.php.net/archive/2026.php#2026-10-21-5" },
        {
          label: "ENISA joint statement",
          url: "https://www.enisa.europa.eu/news/joint-statement-on-critical-php-vulnerabilities",
        },
      ],
    },
    {
      at: at("2026-10-21T23:00:00Z"),
      dateOnly: true,
      title: "UK NCSC: take the system offline if you cannot patch",
      sources: [
        {
          label: "NCSC",
          url: "https://www.ncsc.gov.uk/news/critical-security-issue-affecting-php",
        },
      ],
    },
  ],
  clock: hourly("2026-10-17T00:00:00Z", "2026-10-26T04:00:00Z"),
  weekly: [{ at: at("2026-10-26T04:00:00Z"), stream: "Weekly" }],
};
