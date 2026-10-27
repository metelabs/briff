import { IMAGE_RUNTIMES, RUNTIME_IDS } from "@scan/runtimes";

import { repoAliases, type RepoAliases } from "@/llm/pseudonym";

import type { SynthesisInput, SynthesisOutput } from "./bulletin";

// The synthesis request with repo names replaced by aliases, and the way back. Package
// names, versions, advisories and item text go as they are: they are public and they are
// what the model writes about. Fields that carry repo names: `stack[].name`,
// `items[].affected_repos`, `security_alerts[].repos` (structured), and the free text in
// `items[].suggested_action` and `profile.text`.

function packageName(spec: string): string {
  // `@scope/pkg@1.2.3` -> `@scope/pkg`; `pkg@1.2.3` -> `pkg`; `pkg (requires ~=2.0)` -> `pkg`.
  const name = spec.split(" ")[0];
  const at = name.lastIndexOf("@");
  return at > 0 ? name.slice(0, at) : name;
}

/**
 * Package, service, runtime and image names: text tokens that are never rewritten (a repo
 * called `acme/node` must not turn `node:22.23.4-alpine` into `repo-1:22.23.4-alpine`).
 */
function publicNames(input: SynthesisInput): string[] {
  const names = new Set<string>([...RUNTIME_IDS, ...Object.keys(IMAGE_RUNTIMES)]);
  for (const r of input.stack) {
    for (const p of r.packages) names.add(packageName(p));
    for (const s of r.services) names.add(s);
    for (const rt of r.runtimes ?? []) names.add(rt.split(" ")[0]);
  }
  for (const i of input.items) for (const p of i.packages) names.add(p);
  for (const a of input.security_alerts) names.add(a.package);
  // Weighted names (`package:@acme/web-sdk`) can appear in the profile text in any week.
  for (const key of Object.keys(input.profile.weights)) names.add(key.slice(key.indexOf(":") + 1));
  return [...names];
}

export function synthesisRepoNames(input: SynthesisInput): string[] {
  return [
    ...input.stack.map((r) => r.name),
    ...input.items.flatMap((i) => i.affected_repos),
    ...input.security_alerts.flatMap((a) => a.repos),
  ];
}

/**
 * `orgRepoNames` adds every repo of the org: the profile text is org-wide and can name a
 * repo outside this stream's stack.
 */
export function pseudonymiseSynthesisInput(
  input: SynthesisInput,
  orgRepoNames: readonly string[] = [],
  /** More public names, e.g. every direct dependency of the stream (not only those sent). */
  extraPublic: readonly string[] = [],
  privateNames: readonly string[] = []
): {
  input: SynthesisInput;
  aliases: RepoAliases;
} {
  const aliases = repoAliases(
    [...synthesisRepoNames(input), ...orgRepoNames],
    [...publicNames(input), ...extraPublic],
    { avoidIn: JSON.stringify(input), privateNames }
  );
  return {
    aliases,
    input: {
      ...input,
      profile: {
        ...input.profile,
        text: aliases.aliasText(input.profile.text),
        weights: Object.fromEntries(
          Object.entries(input.profile.weights).map(([key, value]) => [
            aliases.aliasText(key),
            value,
          ])
        ),
      },
      stack: input.stack.map((r) => ({
        ...r,
        name: aliases.alias(r.name),
        packages: r.packages.map(aliases.aliasText),
      })),
      items: input.items.map((i) => ({
        ...i,
        affected_repos: i.affected_repos.map(aliases.alias),
        packages: i.packages.map(aliases.aliasText),
        suggested_action:
          i.suggested_action === null ? null : aliases.aliasText(i.suggested_action),
      })),
      security_alerts: input.security_alerts.map((a) => ({
        ...a,
        repos: a.repos.map(aliases.alias),
        package: aliases.aliasText(a.package),
      })),
    },
  };
}

/** Every free-text field of the model output with aliases mapped back to repo names. */
export function restoreSynthesisOutput(
  output: SynthesisOutput,
  aliases: RepoAliases
): SynthesisOutput {
  const r = aliases.restoreText;
  return {
    summary: r(output.summary),
    act: output.act.map((a) => ({
      ...a,
      headline: r(a.headline),
      line: r(a.line),
      action: r(a.action),
    })),
    know: output.know.map((k) => ({
      ...k,
      headline: r(k.headline),
      line: r(k.line),
      what_to_do: { ...k.what_to_do, note: r(k.what_to_do.note) },
    })),
  };
}
