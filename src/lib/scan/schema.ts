import { z } from "zod";

import { ECOSYSTEMS, PACKAGE_MANAGERS } from "@scan/ecosystems";

const actionEvidenceSchema = z.object({
  source: z.string().max(500),
  ref: z.string().max(256),
  subpath: z.string().max(500).optional(),
  sha: z
    .string()
    .regex(/^[a-f0-9]{40}$/i)
    .optional(),
});

export const scanDependencySchema = z.object({
  constraint: z.boolean().optional(),
  metadata: actionEvidenceSchema
    .extend({ occurrences: z.array(actionEvidenceSchema).max(1000).optional() })
    .optional(),
  // npm names stop at 214 characters; Go module paths and Composer names can be longer.
  name: z.string().min(1).max(300),
  version: z.string().min(1).max(256),
  direct: z.boolean(),
  // Absent: npm (every scanner before other ecosystems, and npm rows of newer ones).
  ecosystem: z.enum(ECOSYSTEMS).optional(),
  // A direct dependency declared only for development (`require-dev`).
  dev: z.boolean().optional(),
  // Python rows: the tool whose lockfile listed the package.
  manager: z.enum(PACKAGE_MANAGERS).optional(),
  // A development-only Python package's dependency group (`test`).
  group: z.string().min(1).max(5_000).optional(),
  // Python declarations (extras and markers), one `target<TAB>shape` line per declaration:
  // a package declared in many groups or per platform makes it long.
  requirement: z.string().min(1).max(20_000).optional(),
  // The uv workspace member that declares it (not the workspace root).
  project: z.string().min(1).max(5_000).optional(),
  // `version` is a requirement as written (`>=2.0`), not an installed version.
  unresolved: z.boolean().optional(),
});

/** Runtime ids are open-ended (the scanner's map grows); only their shape is checked. */
export const scanRuntimeSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z][a-z0-9-]*$/),
  version: z.string().min(1).max(512),
  normalized: z
    .string()
    .max(40)
    .regex(/^\d+(\.\d+){0,2}$/)
    .nullish(),
  source: z.string().min(1).max(500),
  unresolved: z.boolean().optional(),
  // Image repository of Dockerfile/compose entries; older scanners omit it.
  image: z.string().min(1).max(300).optional(),
  // The version is a range, not what runs; older scanners omit it (derived on ingest).
  constraint: z.boolean().optional(),
});

export const scanRepoSchema = z.object({
  name: z.string().min(1).max(200),
  path: z.string().max(1000).optional(),
  // Legacy repo-level field (always "npm"); each dependency carries its own ecosystem.
  ecosystem: z.literal("npm"),
  dependencies: z.array(scanDependencySchema).max(50_000),
  // Optional: scanners from before runtime detection omit it, and then the
  // repo's stored runtimes are left as they are.
  runtimes: z.array(scanRuntimeSchema).max(1000).optional(),
});

export const scanBodySchema = z.object({
  // `github`: briff-scan inside GitHub Actions (repo named owner/repo).
  source: z.enum(["local", "github"]),
  repos: z.array(scanRepoSchema).min(1).max(500),
  // Scan session: every upload of one scanner run carries the same id, the last one
  // `final: true`, so the runtime urgent pass runs once after the whole run. Scanners
  // from before sessions send neither (see scanFollowUp).
  scanId: z.string().min(1).max(100).optional(),
  final: z.boolean().optional(),
});

export type ScanBody = z.infer<typeof scanBodySchema>;
export type ScanRepo = z.infer<typeof scanRepoSchema>;
export type ScanDependency = z.infer<typeof scanDependencySchema>;
export type ScanRuntime = z.infer<typeof scanRuntimeSchema>;
