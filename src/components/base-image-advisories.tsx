import { plural } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import type { BaseImageGroup } from "@/security/base-image-view";
import { osvLink, severityLabel } from "@/security/plan";

export function BaseImageAdvisories({ groups }: { groups: readonly BaseImageGroup[] }) {
  if (!groups.length) return null;
  return (
    <section className="mt-8">
      <SectionHeader title="Base image advisories" />
      <p className="text-fg-muted mb-3 text-[13px]">
        Candidate distro advisories for common base packages. Briff cannot see which OS packages or
        versions the image contains; these are not confirmed vulnerabilities.
      </p>
      <div className="space-y-3">
        {groups.map((group) => (
          <Card key={group.image} className="p-4">
            <h3 className="font-mono font-medium">{group.image}</h3>
            <p className="text-fg-muted mt-1 text-[13px]">{group.repos.join(", ")}</p>
            <p className="my-2 text-[13px]">{group.action}</p>
            <details>
              <summary className="cursor-pointer text-[13px]">
                {plural(group.advisories.length, "candidate advisory", "candidate advisories")}
              </summary>
              <ul className="mt-2 space-y-2 text-[13px]">
                {group.advisories.map((a) => (
                  <li key={a.osvId}>
                    <a className="text-brand hover:underline" href={osvLink(a.osvId)}>
                      {a.osvId}
                    </a>{" "}
                    · {severityLabel(a.severity)}
                    {a.summary ? ` · ${a.summary}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          </Card>
        ))}
      </div>
    </section>
  );
}
