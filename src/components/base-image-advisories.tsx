import { plural } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import type { BaseImageGroup } from "@/security/base-image-view";
import { osvLink, severityLabel } from "@/security/plan";

/** Advisories shown per image before the rest fold away. */
const SHOWN = 10;

export function BaseImageAdvisories({ groups }: { groups: readonly BaseImageGroup[] }) {
  if (!groups.length) return null;
  return (
    <section className="mt-8">
      <SectionHeader title="Base image fixes" count={plural(groups.length, "image")} />
      <p className="text-fg-muted mb-3 max-w-[72ch] text-[13px]">
        Fixes recently published for common base packages in each image&apos;s distro release. Briff
        cannot see the packages inside an image; rebuilding on the latest tag picks these fixes up.
        Older fixes are assumed to be in the image already.
      </p>
      <div className="space-y-3">
        {groups.map((group) => (
          <Card key={`${group.repo}\0${group.image}`} className="p-4">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <h3 className="font-mono font-medium break-all">{group.image}</h3>
              <span className="text-fg-muted text-[13px]">{group.repo}</span>
            </div>
            <p className="my-2 text-[13.5px] font-medium">To do: {group.action}</p>
            <AdvisoryList advisories={group.advisories.slice(0, SHOWN)} />
            {group.advisories.length > SHOWN && (
              <details className="mt-2">
                <summary className="text-brand cursor-pointer text-[13px]">
                  and {plural(group.advisories.length - SHOWN, "more advisory", "more advisories")}
                </summary>
                <AdvisoryList advisories={group.advisories.slice(SHOWN)} />
              </details>
            )}
          </Card>
        ))}
      </div>
    </section>
  );
}

function AdvisoryList({ advisories }: { advisories: BaseImageGroup["advisories"] }) {
  return (
    <ul className="mt-2 space-y-1.5 text-[13px]">
      {advisories.map((a) => (
        <li key={a.osvId} className="break-words">
          <a className="text-brand font-mono hover:underline" href={osvLink(a.osvId)}>
            {a.osvId}
          </a>{" "}
          · {severityLabel(a.severity)}
          {a.packages.length ? ` · ${a.packages.join(", ")}` : ""}
          {a.summary ? <span className="text-fg-muted"> · {a.summary}</span> : null}
        </li>
      ))}
    </ul>
  );
}
