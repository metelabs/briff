"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useTransition, type ReactNode } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CodeBlock, CommandBox } from "@/components/ui/command-box";
import { SecretBox } from "@/components/ui/secret-box";
import { Segmented } from "@/components/ui/segmented";
import { Tag } from "@/components/ui/tag";
import { plural } from "@/lib/format";
import {
  localScanCommands,
  SCANNER_MAJOR,
  scanWorkflowYaml,
  WORKFLOW_PATH,
} from "@/lib/scan/workflow";
import { SCANNER_VERSION } from "@scan/version";

import { ensureOnboardingTokenAction, scanStatusAction } from "./actions";
import {
  type ConnectMethod,
  defaultConnectMethod,
  type GithubAppState,
  ONBOARDING_TOKEN_NAMES,
  type OnboardingToken,
  type ScanMethod,
  scanStepOf,
  type ScanStatus,
  type TokenState,
} from "./scan-status";

// The "connect repos" steps (token, BRIFF_TOKEN secret, workflow, local CLI), shared by the
// first-run onboarding page and the Connect repos sheet in the top bar.

const POLL_MS = 5000;

/** Keeps polling while mounted: a scan can add repos at any time. */
export function useScanStatus(initial: ScanStatus): ScanStatus {
  const [status, setStatus] = useState(initial);
  useEffect(() => {
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        setStatus(await scanStatusAction());
      } catch {
        // Offline or signed out: the next tick tries again.
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, []);
  return status;
}

function OStep({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="border-line grid grid-cols-[26px_minmax(0,1fr)] gap-3 border-t py-4 first:border-t-0 first:pt-1">
      <i className="bg-surface-2 border-line grid size-[26px] place-items-center rounded-full border text-[12.5px] font-semibold not-italic">
        {n}
      </i>
      <div className="min-w-0">
        <h4 className="mt-0.5 mb-1.5 text-[15px] font-semibold">{title}</h4>
        {children}
      </div>
    </div>
  );
}

const Inline = ({ children }: { children: ReactNode }) => (
  <code className="bg-surface border-line rounded-[5px] border px-[5px] font-mono text-[12.5px]">
    {children}
  </code>
);

const METHOD_HINT: Record<ConnectMethod, string> = {
  app: "No token, no workflow; scans on every push",
  action: "Scans on every push to main",
  local: "Works for any folder of repos",
};

/** The ways to connect (GitHub App / GitHub Action / Local scanner) as tabs, with their steps. */
export function ConnectRepos({
  stream,
  apiUrl,
  status,
  initialTokens,
  github,
  className,
  onNavigate,
}: {
  stream: { id: string; name: string } | null;
  apiUrl: string;
  status: ScanStatus;
  initialTokens: TokenState;
  github: GithubAppState;
  className?: string;
  /** Called when a link inside is followed; the sheet closes so the target is not covered. */
  onNavigate?: () => void;
}) {
  const [method, setMethod] = useState<ConnectMethod>(defaultConnectMethod(github));
  const [tokens, setTokens] = useState<TokenState>(initialTokens);
  const scanMethod: ScanMethod = method === "local" ? "local" : "action";

  const tokenStep = (
    <TokenStep
      method={scanMethod}
      token={tokens[scanMethod]}
      onToken={(token) => setTokens((prev) => ({ ...prev, [scanMethod]: token }))}
      onNavigate={onNavigate}
    />
  );
  const tokenValue = tokens[scanMethod]?.secret ?? "<token>";

  return (
    <div className={className}>
      <div className="rise mb-4 flex flex-wrap items-center justify-between gap-3 [--i:3]">
        <Segmented
          label="How to connect"
          value={method}
          onChange={setMethod}
          options={[
            { value: "app", label: "GitHub App" },
            { value: "action", label: "GitHub Action" },
            { value: "local", label: "Local scanner" },
          ]}
        />
        <span className="text-fg-muted hidden text-[13px] min-[560px]:inline">
          {METHOD_HINT[method]}
        </span>
      </div>
      <Card className="rise p-[18px] [--i:4]">
        {method === "app" ? (
          <>
            <OStep n={1} title="Install the Briff GitHub App">
              <GithubAppStep github={github} />
            </OStep>
            <OStep n={2} title="Add the repos to your stream">
              <ScanState status={status} stream={stream} onNavigate={onNavigate} />
            </OStep>
          </>
        ) : method === "action" ? (
          <>
            <OStep n={1} title="Create a token for the Action">
              {tokenStep}
            </OStep>
            <OStep n={2} title="Add it to the repo as BRIFF_TOKEN">
              <p className="text-fg-muted mb-2.5 text-[13.5px]">
                On GitHub: the repo → Settings → Secrets and variables → Actions → New repository
                secret. Name <Inline>BRIFF_TOKEN</Inline>, value the token. Or with the GitHub CLI
                in the repo (it asks for the value):
              </p>
              <CommandBox command="gh secret set BRIFF_TOKEN" />
            </OStep>
            <OStep n={3} title="Add the workflow">
              <p className="text-fg-muted mb-2.5 text-[13.5px]">
                Commit this file. It scans the repo on every push to <Inline>main</Inline> and on
                Mondays before the bulletin, with <Inline>briff-scan@{SCANNER_MAJOR}</Inline> from
                npm (currently {SCANNER_VERSION}). One workflow per repo; the token can be shared.
              </p>
              <CodeBlock label={WORKFLOW_PATH} code={scanWorkflowYaml(apiUrl)} />
            </OStep>
            <OStep n={4} title="Add the repos to your stream">
              <ScanState status={status} stream={stream} onNavigate={onNavigate} />
            </OStep>
          </>
        ) : (
          <>
            <OStep n={1} title="Create a token for the scanner">
              {tokenStep}
            </OStep>
            <OStep n={2} title="Run the scanner">
              <p className="text-fg-muted mb-2.5 text-[13.5px]">
                Node 20 or later. Inside a repo it scans that repo; start with a dry run, which
                lists what it found and sends nothing.
              </p>
              <div className="grid gap-2">
                <CommandBox command={localScanCommands(apiUrl, tokenValue).dryRun} />
                <CommandBox command={localScanCommands(apiUrl, tokenValue).upload} />
              </div>
              <p className="text-fg-muted mt-2.5 mb-2 text-[13.5px]">
                For a folder of repos, one Briff repo per git repo:
              </p>
              <CommandBox command={localScanCommands(apiUrl, tokenValue).allRepos} />
              <p className="text-fg-muted mt-2.5 text-[12.5px]">
                Run it again after dependency changes, or daily from cron.
              </p>
            </OStep>
            <OStep n={3} title="Add the repos to your stream">
              <ScanState status={status} stream={stream} onNavigate={onNavigate} />
            </OStep>
          </>
        )}
      </Card>
    </div>
  );
}

function GithubAppStep({ github }: { github: GithubAppState }) {
  if (!github.configured) {
    return (
      <p className="text-fg-muted text-[13.5px]">
        The GitHub App is not set up on this instance yet. Use the GitHub Action or the local
        scanner; the operator can enable the app (docs/GITHUB-APP.md).
      </p>
    );
  }
  return (
    <>
      <p className="text-fg-muted mb-2.5 text-[13.5px]">
        Recommended. Pick the repos on GitHub; Briff scans them right away and again after every
        push that changes a lockfile, manifest or runtime file. It reads only those files (Contents
        and Metadata, read-only), never your code.
      </p>
      {github.installations.length > 0 && (
        <ul className="mb-3 grid gap-1.5">
          {github.installations.map((i) => (
            <li key={i.accountLogin} className="flex flex-wrap items-center gap-2 text-[13.5px]">
              <Tag kind={i.suspended ? "wait" : "ok"}>
                {i.suspended ? "Suspended" : "Connected"}
              </Tag>
              <span className="font-medium">{i.accountLogin}</span>
              <span className="text-fg-muted text-[12.5px]">
                {i.accountType === "Organization" ? "organisation" : "personal account"}
              </span>
            </li>
          ))}
        </ul>
      )}
      {/* A route, not a Link: it redirects to github.com. */}
      <a href="/api/github/install" className={buttonVariants({ variant: "secondary" })}>
        {github.installations.length > 0 ? "Connect another account" : "Connect GitHub"}
      </a>
      <p className="text-fg-muted mt-2.5 text-[12.5px]">
        GitHub asks you to pick the repos, then to confirm it is you. Change the repo selection
        later on GitHub; Briff follows.
      </p>
    </>
  );
}

function TokenStep({
  method,
  token,
  onToken,
  onNavigate,
}: {
  method: ScanMethod;
  token: OnboardingToken | null;
  onToken: (token: OnboardingToken) => void;
  onNavigate?: () => void;
}) {
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  if (token?.secret) return <SecretBox secret={token.secret} />;
  if (token) {
    return (
      <>
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <Tag kind="ok">Token created</Tag>
          <Inline>{token.name}</Inline>
          <span className="text-fg-muted font-mono text-[12.5px]">{token.prefix}…</span>
        </div>
        <p className="text-fg-muted text-[13.5px]">
          Its secret was shown when it was created. Lost it? Revoke it in{" "}
          <Link
            href="/settings#scan-tokens"
            onClick={onNavigate}
            className="text-brand underline-offset-4 hover:underline"
          >
            Settings → Scan tokens
          </Link>{" "}
          and create a new one there.
        </p>
      </>
    );
  }
  return (
    <>
      <p className="text-fg-muted mb-2.5 text-[13.5px]">
        The scanner sends a token of this org with every upload. This creates one named{" "}
        <Inline>{ONBOARDING_TOKEN_NAMES[method]}</Inline>; you manage tokens in Settings → Scan
        tokens.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              try {
                onToken(await ensureOnboardingTokenAction(method));
                setFailed(false);
              } catch {
                setFailed(true);
              }
            })
          }
        >
          Create token
        </Button>
        {failed && (
          <span role="status" className="text-upgrade text-[13px]">
            Could not create the token. Try again.
          </span>
        )}
      </div>
    </>
  );
}

function ScanState({
  status,
  stream,
  onNavigate,
}: {
  status: ScanStatus;
  stream: { id: string; name: string } | null;
  onNavigate?: () => void;
}) {
  const box =
    "bg-surface-2 border-line flex items-center gap-3 rounded-[12px] border px-4 py-3.5 text-[13.5px]";
  const step = scanStepOf(status);
  if (step === "waiting") {
    return (
      <div className={box} role="status">
        <i aria-hidden className="border-brand size-2.5 shrink-0 rounded-full border-2" />
        <div>
          <b className="font-medium">Waiting for the first scan</b>
          <div className="text-fg-muted text-[12.5px]">
            Nothing received yet. This updates by itself.
          </div>
        </div>
      </div>
    );
  }
  const href = stream ? `/streams?stream=${encodeURIComponent(stream.id)}` : "/streams";
  const unassigned = status.repos - status.included;
  return (
    <div className={box} role="status">
      <Check aria-hidden className="text-ok size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <b className="font-medium">{plural(status.repos, "repo")} received</b>
        <div className="text-fg-muted text-[12.5px]">
          {step === "done"
            ? "Every repo is in a stream. You are set."
            : `${unassigned === 1 ? "1 repo is" : `${unassigned} repos are`} in no stream yet. Pick the ones this stream should cover.`}
        </div>
      </div>
      {step === "pick" && (
        <Link
          href={href}
          onClick={onNavigate}
          className={buttonVariants({ variant: "secondary", size: "sm" })}
        >
          Pick repos
        </Link>
      )}
    </div>
  );
}
