// Where the GitHub App flow sends the browser back to (`/repos?github=<status>`) and the line
// the Repos page shows for it. Pure: shared by the routes and the page.

export const GITHUB_FLOW_STATUSES = [
  "connected",
  "updated",
  "requested",
  "not-configured",
  "invalid-state",
  "forbidden",
  "other-org",
  "failed",
] as const;
export type GithubFlowStatus = (typeof GITHUB_FLOW_STATUSES)[number];

export function isGithubFlowStatus(value: unknown): value is GithubFlowStatus {
  return (GITHUB_FLOW_STATUSES as readonly unknown[]).includes(value);
}

export const GITHUB_FLOW_MESSAGES: Record<GithubFlowStatus, { ok: boolean; text: string }> = {
  connected: {
    ok: true,
    text: "GitHub connected. Briff is scanning your repos; they appear here within a minute.",
  },
  updated: {
    ok: true,
    text: "Repo selection updated. Briff scans the repos you added as soon as GitHub reports them.",
  },
  requested: {
    ok: true,
    text: "Install requested. Once an owner of the GitHub organisation approves it, connect GitHub again.",
  },
  "not-configured": {
    ok: false,
    text: "The GitHub App is not set up on this instance. Use the GitHub Action or the local scanner.",
  },
  "invalid-state": {
    ok: false,
    text: "That GitHub link expired or was started in another session. Connect GitHub again from here.",
  },
  forbidden: {
    ok: false,
    text: "Could not confirm that your GitHub account can access that installation. Sign in to GitHub as an account that can, then connect again.",
  },
  "other-org": {
    ok: false,
    text: "That GitHub installation is already connected to another Briff organisation.",
  },
  failed: { ok: false, text: "Connecting GitHub failed. Try again in a minute." },
};
