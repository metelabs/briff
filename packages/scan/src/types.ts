import type { ActionMetadata } from "./actions";
import type { Ecosystem, PackageManager } from "./ecosystems";

export interface LockedDependency {
  constraint?: boolean;
  metadata?: ActionMetadata;
  name: string;
  version: string;
  direct: boolean;
  /** Absent for npm, so an npm-only upload is the same as before other ecosystems existed. */
  ecosystem?: Exclude<Ecosystem, "npm">;
  /**
   * A direct dependency declared only for development (`require-dev`): its fix command keeps
   * it there. Absent otherwise, and for ecosystems whose install command keeps the section.
   */
  dev?: true;
  /**
   * Where a Python package is declared besides the main list: the dependency group of a
   * development-only package (`dev`, `test`) or an optional extra (`extra:http`), so the
   * command targets it (`poetry add --group test`, `poetry add --optional http`). Absent otherwise.
   */
  group?: string;
  /**
   * A direct Python dependency's requirement as the manifest declares it (PEP 508, extras and
   * markers kept: `acme-http[socks]==2.31.0; python_version >= "3.9"`), so the fix command
   * keeps them and replaces only the version. Absent otherwise.
   */
  requirement?: string;
  /**
   * The uv workspace projects that declare it when that is not only the root: member names,
   * comma-joined, with `.` for the root (`.,acme-api`); each gets `uv add`.
   */
  project?: string;
  /** The Python tool whose lockfile listed it (picks the fix command); absent elsewhere. */
  manager?: PackageManager;
  /**
   * `version` is the requirement as written (`>=2.0,<3`, `*`), not an installed version: a
   * requirements.txt line without an exact `==` pin. Briff matches releases for it but never
   * queries OSV with it. Absent for installed versions.
   */
  unresolved?: true;
}

/**
 * A runtime (language, database, web server) a repo declares. `name` is a
 * canonical id (see RUNTIME_IDS) or `image` for a container image the map does
 * not know yet, in which case `version` is the full image reference.
 */
export interface DetectedRuntime {
  name: string;
  /** Raw text as written: an exact version, a range (`>=8.2`), a major (`22`) or an image tag. */
  version: string;
  /** `major[.minor[.patch]]` derived from `version`, or null when it names no number (`lts/*`, `stable`). */
  normalized: string | null;
  /** Path relative to the repo root, plus the field when the file has several (`package.json engines.node`). */
  source: string;
  /** The version came from a variable (`FROM php:${PHP_VERSION}`) the scanner does not resolve. */
  unresolved: boolean;
  /**
   * The text is a constraint (`>=20`, `^8.3`, `18 || 20`, `3.11.*`), not the version that runs:
   * Briff shows it but never calls a repo end-of-life from it. Absent for concrete versions;
   * older scanners never send it, and the server derives it then (isConstraintRow).
   */
  constraint?: boolean;
  /**
   * Image repository of a Dockerfile/compose entry as written, registry kept and Docker Hub's
   * `library/` dropped (`php`, `mcr.microsoft.com/dotnet/aspnet`); absent for other files.
   */
  image?: string;
}
