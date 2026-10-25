import { feedItems, hourly, postBody } from "../fixtures";
import type { ReplayScenario } from "../types";

// Node.js security releases of 21 October 2026. The vulnerability feed has titles only;
// Briff reads the body from the post's Markdown source on nodejs/nodejs.org main (PR #13
// fixtures). That file was merged at 14 Oct 14:05 UTC (98eab92, the pre-announcement; front
// matter date 14 Oct 03:00) and rewritten in place at 21 Oct 12:07 UTC (b58692e, with
// 22.23.4, 24.22.1 and 26.12.1; front matter date 21 Oct 22:00). The merge times are when
// Briff could read them: the item appears then, and the rewrite is the in-place update
// refreshOpenAnnouncements picks up. The feed's item date moves to the release day with the
// rewrite; the replay keeps the announcement's own date.
// Repos: the node repos of the production email of 22 Oct 2026.

const NODE_VULN = "Node.js vulnerability blog";
const POST_URL = "https://nodejs.org/en/blog/vulnerability/october-2026-security-releases";
const COMMITS = "https://github.com/nodejs/nodejs.org/commit";
const ANNOUNCED = new Date("2026-10-14T03:00:00Z");
const ANNOUNCEMENT_MERGED = new Date("2026-10-14T14:05:20Z");
const RELEASE_MERGED = new Date("2026-10-21T12:07:59Z");

const feed = feedItems("nodejs-vulnerability.xml", NODE_VULN).map((i) =>
  i.url === POST_URL
    ? {
        ...i,
        publishedAt: ANNOUNCED,
        visibleAt: ANNOUNCEMENT_MERGED,
        body: postBody("nodejs-october-2026-security-releases.pre.md"),
        updates: [
          { at: RELEASE_MERGED, body: postBody("nodejs-october-2026-security-releases.post.md") },
        ],
      }
    : i
);

const dockerfile = (tag: string) => ({ Dockerfile: `FROM node:${tag}\n` });

export const nodeOct2026: ReplayScenario = {
  id: "node-oct-2026",
  title: "Node.js security releases, October 2026",
  summary:
    "Node.js pre-announced security releases for the 26.x, 24.x and 22.x lines a week ahead, then rewrote the same post on release day with 22.23.4, 24.22.1 and 26.12.1. Six repos from a real stack: floating and pinned images, an engines range, and two end-of-life lines (node 18, node 14).",
  repos: [
    {
      name: "briff",
      files: {
        ...dockerfile("22-alpine"),
        "package.json": JSON.stringify({ engines: { node: ">=22.12" } }),
      },
    },
    { name: "garden.example", files: dockerfile("22.17.0-alpine") },
    { name: "sigma/forms-web", files: dockerfile("24.15.0-alpine") },
    { name: "sigma/budget", files: dockerfile("24-slim") },
    { name: "bakery.example", files: dockerfile("18-alpine") },
    { name: "orchid-hotel.example", files: { ".nvmrc": "v14.15.0\n" } },
  ],
  sources: [
    {
      name: NODE_VULN,
      kind: "rss",
      url: "https://nodejs.org/en/feed/vulnerability.xml",
      class: "security",
      runtime: "node",
    },
  ],
  items: feed,
  world: [
    {
      at: ANNOUNCEMENT_MERGED,
      title: "Node.js pre-announces security releases for 26.x, 24.x and 22.x",
      detail:
        "Highest severity HIGH on every line, release on or shortly after Wednesday 21 October. End-of-life lines are always affected.",
      sources: [
        { label: "nodejs.org", url: POST_URL },
        { label: "commit 98eab92", url: `${COMMITS}/98eab92` },
      ],
    },
    {
      at: RELEASE_MERGED,
      title: "Node.js 22.23.4, 24.22.1 and 26.12.1 are out",
      detail:
        "Ten CVEs, four rated high, among them a Brotli decoder out-of-bounds write (CVE-2026-111497) and TLS hostname bypasses. The announcement post is rewritten in place.",
      sources: [
        { label: "nodejs.org", url: POST_URL },
        { label: "commit b58692e", url: `${COMMITS}/b58692e` },
      ],
    },
  ],
  clock: hourly("2026-10-14T00:00:00Z", "2026-10-22T06:00:00Z"),
  weekly: [{ at: new Date("2026-10-19T04:00:00Z"), stream: "Weekly" }],
};
