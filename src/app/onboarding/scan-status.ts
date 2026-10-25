export interface ScanStatus {
  repos: number;
  /** Repos in at least one stream (`Repo.included`). */
  included: number;
  lastScannedAt: string | null;
}

export type ScanStep = "waiting" | "pick" | "done";

/**
 * Step 3 of onboarding: nothing scanned yet, scanned repos still in no stream (also for a
 * returning org whose new scan brought new repos), or every repo is in a stream.
 */
export function scanStepOf(status: ScanStatus): ScanStep {
  if (status.repos === 0) return "waiting";
  return status.repos > status.included ? "pick" : "done";
}

export type ScanMethod = "action" | "local";

/** Onboarding creates one token per method under these names (reused while active). */
export const ONBOARDING_TOKEN_NAMES: Record<ScanMethod, string> = {
  action: "GitHub Action",
  local: "Local scanner",
};

export interface OnboardingToken {
  name: string;
  prefix: string;
  /** Only right after creation; null for a token created earlier. */
  secret: string | null;
}

export type TokenState = Record<ScanMethod, OnboardingToken | null>;

/** Ways to connect: the GitHub App, or a scanner with a token (Action, local CLI). */
export type ConnectMethod = "app" | ScanMethod;

export interface GithubAppState {
  /** The instance has the app's env; otherwise the App tab says so. */
  configured: boolean;
  installations: { accountLogin: string; accountType: string; suspended: boolean }[];
}

/** The recommended way first; the App only when this instance has it. */
export function defaultConnectMethod(github: GithubAppState): ConnectMethod {
  return github.configured ? "app" : "action";
}

/** What the connect steps need: the first stream, the API origin, scan status, tokens. */
export interface ConnectData {
  stream: { id: string; name: string } | null;
  apiUrl: string;
  status: ScanStatus;
  tokens: TokenState;
  github: GithubAppState;
}
