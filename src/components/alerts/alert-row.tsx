import { ecosystemLabel } from "@scan/ecosystems";
import type { ReactNode } from "react";

import { CopyButton, InlineCopy } from "@/components/ui/command-box";
import { EcosystemTag } from "@/components/ui/ecosystem-tag";
import { severityKind, Tag } from "@/components/ui/tag";
import { Tooltip, TruncatedText } from "@/components/ui/tooltip";
import { UpgradeList } from "@/components/ui/upgrade-list";
import type { AlertPackageGroup } from "@/pipeline/alert-groups";
import type { FixHint } from "@/pipeline/alert-sections";

const OSV = "https://osv.dev/vulnerability/";

const APP_HINT = "Resolves after you push the fix (Briff rescans on push).";

/** How Briff notices the fix, by how the package's repos are connected. */
function FixHintLine({ hint, scanCommand }: { hint: FixHint; scanCommand?: string }) {
  const scanner = (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
      {hint === "mixed" ? "briff-scan repos resolve" : "Resolves"} on the next upload (nightly)
      {scanCommand ? ", or now in the repo with a scan token from Settings:" : "."}
      {scanCommand && <InlineCopy text={scanCommand} command />}
    </span>
  );
  return (
    <div className="text-fg-muted grid gap-1 text-[12px]">
      {hint !== "scanner" && (
        <span>
          {hint === "mixed"
            ? "GitHub App repos resolve after you push the fix (Briff rescans on push)."
            : APP_HINT}
        </span>
      )}
      {hint !== "app" && scanner}
    </div>
  );
}

/**
 * One package on the Alerts page: severity counts, the fix per installed release line and the
 * advisory ids and, with `hint`, how Briff notices the fix. `action` sits under the severities
 * (the page's "Mark reviewed"); the landing page's sample renders the row without one.
 */
export function AlertRow({
  group: g,
  action,
  hint = null,
  scanCommand,
}: {
  group: AlertPackageGroup;
  action?: ReactNode;
  hint?: FixHint | null;
  scanCommand?: string;
}) {
  const ids = g.advisories.slice(0, 3);
  return (
    <div className="border-line grid items-start gap-x-4 gap-y-2.5 border-t px-[18px] py-3.5 first:border-t-0 md:grid-cols-[190px_minmax(0,1fr)_auto]">
      <div className="flex min-w-0 flex-col items-start gap-1.5">
        <TruncatedText as="b" className="max-w-full font-mono text-[14.5px] font-medium">
          {g.packageName}
        </TruncatedText>
        <div className="flex flex-wrap items-center gap-1.5">
          <Tag kind={g.direct ? "direct" : "transitive"}>{g.direct ? "Direct" : "Transitive"}</Tag>
          {g.ecosystem && <EcosystemTag>{ecosystemLabel(g.ecosystem)}</EcosystemTag>}
        </div>
      </div>
      <div className="grid min-w-0 gap-1.5">
        {g.fixes.length === 0 && (
          <p className="text-fg-muted text-[13px]">
            The installed versions are already past the fix.
          </p>
        )}
        {g.fixes.map((f, i) => (
          <div key={i} className="grid gap-1 text-[13px]">
            {(f.text || f.command) && (
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                {f.text && <span>{f.text}</span>}
                {f.command && (
                  <span className="bg-surface-2 border-line inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-[6px] border py-0.5 pr-0.5 pl-[7px]">
                    <code className="no-scrollbar min-w-0 overflow-x-auto font-mono text-[12px] whitespace-nowrap">
                      {f.command}
                    </code>
                    <CopyButton text={f.command} className="px-2 py-0.5 text-[11.5px]" />
                  </span>
                )}
              </span>
            )}
            <UpgradeList upgrades={f.installs} className="text-[12px]" />
          </div>
        ))}
        <span className="text-fg-muted font-mono text-[11.5px]">
          {ids.map((a, i) => (
            <span key={a.osvId}>
              {i > 0 && ", "}
              <Tooltip content={a.summary} disabled={!a.summary}>
                <a
                  href={OSV + encodeURIComponent(a.osvId)}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-fg underline-offset-2 hover:underline"
                >
                  {a.osvId}
                </a>
              </Tooltip>
              {a.aliases.length > 0 && ` (also ${a.aliases.join(", ")})`}
            </span>
          ))}
          {g.advisories.length > ids.length && ` +${g.advisories.length - ids.length} more`}
        </span>
        {hint && <FixHintLine hint={hint} scanCommand={scanCommand} />}
      </div>
      <div className="flex flex-col items-start gap-2 md:items-end">
        <div className="flex flex-wrap gap-1 md:justify-end">
          {g.severities.map(([label, n]) => (
            <Tag key={label} kind={severityKind(label === "UNKNOWN" ? null : label)}>
              {`${n} ${label.toLowerCase()}`}
            </Tag>
          ))}
        </div>
        {action}
      </div>
    </div>
  );
}
