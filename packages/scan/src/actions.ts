import { isScalar, parseDocument, visit } from "yaml";

/** The sole exception to the scanner's dot-directory exclusion. */
export const WORKFLOW_PATH = /^\.github\/workflows\/[^/]+\.ya?ml$/;

export interface ActionEvidence {
  source: string;
  ref: string;
  subpath?: string;
  sha?: string;
}

export type ActionMetadata = ActionEvidence & { occurrences?: ActionEvidence[] };

export function mergeActionMetadata(
  a: ActionMetadata | undefined,
  b: ActionMetadata | undefined
): ActionMetadata | undefined {
  if (!a || !b) return a ?? b;
  const occurrences = [
    ...new Map(
      [...(a.occurrences ?? [a]), ...(b.occurrences ?? [b])].map((entry) => [
        JSON.stringify(entry),
        entry,
      ])
    ).values(),
  ];
  return { ...a, occurrences };
}

export interface ActionReference {
  name: string;
  version: string;
  constraint: boolean;
  metadata: ActionMetadata;
}

/** Reads only literal uses lines; local actions, images and expressions are not packages. */
export function parseActions(content: string, source: string): ActionReference[] {
  const rows: ActionReference[] = [];
  const document = parseDocument(content);
  if (document.errors.length > 0) throw new Error("Invalid workflow YAML");
  visit(document, {
    Pair(_, pair) {
      if (!isScalar(pair.key) || pair.key.value !== "uses" || !isScalar(pair.value)) return;
      if (typeof pair.value.value !== "string") return;
      const value = pair.value.value;
      const comment = pair.value.comment?.trim() ?? "";
      const ref = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(\/[^@\s]+)?@([^\s@]+)$/.exec(value);
      if (!ref || ref[4].includes("${{")) return;
      const [, owner, repo, path, revision] = ref;
      const sha = /^[a-f\d]{40}$/i.test(revision) ? revision : undefined;
      const annotated = sha ? /^v?\d+\.\d+\.\d+(?:-[\w.-]+)?\b/.exec(comment)?.[0] : undefined;
      const version = annotated ?? revision;
      rows.push({
        name: `${owner}/${repo}`.toLowerCase(),
        version,
        constraint: /^v?\d+(?:\.\d+)?$/.test(version),
        metadata: {
          source,
          ref: revision,
          ...(path ? { subpath: path.slice(1) } : {}),
          ...(sha ? { sha } : {}),
        },
      });
    },
  });
  return rows;
}
