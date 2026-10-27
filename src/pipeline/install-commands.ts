import semver from "semver";

import { shapesFor, type Ecosystem, type PackageManager } from "@scan/ecosystems";

// The copyable commands per ecosystem: install a version, and show what pulls a transitive
// package in. The version always comes from the fix rules (fixes.ts), so it stays on the
// installed release line: Composer's caret (`^6.4.3`) cannot leave it, and the Python tools
// and `go get` get an exact version (a Go major above v1 is part of the module path). Python has several tools; `manager` is the one whose lockfile listed the
// package (pip for a requirements file).

/**
 * How a repo installs the package, beyond its ecosystem: `dev` when it declares it only for
 * development (`require-dev`, a Poetry/uv dev group, Pipfile `[dev-packages]`), so the command
 * keeps it there instead of moving it to the production requirements; `manager` is the Python
 * tool whose lockfile listed it.
 */
export interface InstallVariant {
  dev?: boolean;
  actionTags?: Record<string, string>;
  manager?: PackageManager;
  /**
   * Where a Python package is declared when not only in the main list: its sections,
   * comma-joined (`.` the main list, `test` a dependency group, `extra:http` an extra).
   */
  group?: string;
  /**
   * The requirement as the manifest declares it: its extras and markers stay in the command.
   * Go: the replaced `module[@version]` when a `replace` builds this module instead.
   */
  requirement?: string;
  /**
   * uv workspace declarations besides the root's: `.` (the root, in its `group` sections)
   * and `member:section` pairs (`.,acme-api:.,acme-api:test`).
   */
  project?: string;
}

/** A shell word: single-quoted when it holds anything a shell could read (`[`, `;`, spaces). */
function shellWord(word: string): string {
  return /^[A-Za-z0-9._\-=@:^,/+]+$/.test(word) ? word : `'${word.replace(/'/g, "'\\''")}'`;
}

/**
 * The requirement a Python command installs: the declared extras and marker kept
 * (`acme-http[socks]==2.32.0; python_version >= "3.9"`), only the version replaced.
 */
function pythonRequirement(
  pkg: string,
  declaredShape: string | undefined,
  pin: string,
  withMarker: boolean
): string {
  // A multiple-constraint marker (`!`) only matters to Poetry.
  const declared = declaredShape?.replace(/^!/, "");
  const shape = declared ? /^([^\[;]+)(\[[^\]]*\])?(?:;\s*(.+))?$/.exec(declared) : null;
  const extras = shape?.[2] ?? "";
  const marker = withMarker && shape?.[3] ? `; ${shape[3]}` : "";
  return shellWord(`${pkg}${extras}${pin}${marker}`);
}

/** The sections a package is declared in: `.` (main list), a group name, `extra:<name>`. */
function sectionsOf(variant: InstallVariant): string[] {
  if (variant.group) return variant.group.split(",");
  return [variant.dev ? "dev" : "."];
}

function uvSection(section: string): string {
  if (section === ".") return "";
  if (section.startsWith("extra:")) return ` --optional ${shellWord(section.slice(6))}`;
  return section === "dev" ? " --dev" : ` --group ${shellWord(section)}`;
}

function poetrySection(section: string): string {
  if (section === ".") return "";
  if (section.startsWith("extra:")) return ` --optional ${shellWord(section.slice(6))}`;
  return ` --group ${shellWord(section)}`;
}

/**
 * Each tool updates the existing declarations in place: one command per section (and, for a
 * uv workspace, per member) that declares the package, with its extras and markers, the
 * version constraint replaced by the fix. Joined with `&&`, so no declaration keeps the old pin.
 */
function pythonInstall(variant: InstallVariant, pkg: string, version: string): string {
  const sections = sectionsOf(variant);
  // Each declaration's own shape (extras, marker); a target can hold several (one pin
  // declared per platform), each updated. No shape on record: the bare requirement.
  const declared = (target: string): (string | undefined)[] => {
    const shapes = shapesFor(variant.requirement, target);
    return shapes.length > 0 ? shapes : [undefined];
  };
  switch (variant.manager ?? "pip") {
    case "uv": {
      // `project` lists `.` (the root, in `sections`) and `member:section` pairs.
      const targets = (variant.project ?? ".").split(",").flatMap((token) => {
        if (token === ".") {
          return sections.map((section) => ({ flags: uvSection(section), target: section }));
        }
        // Member names have no colon; the section can (`acme-api:extra:http`).
        const at = token.indexOf(":");
        const member = at === -1 ? token : token.slice(0, at);
        const section = at === -1 ? "." : token.slice(at + 1);
        return [{ flags: ` --package ${shellWord(member)}${uvSection(section)}`, target: token }];
      });
      const edits = [
        ...new Set(
          targets.flatMap((t) =>
            declared(t.target).map(
              (shape) => `${t.flags} ${pythonRequirement(pkg, shape, `==${version}`, true)}`
            )
          )
        ),
      ];
      if (edits.length === 1) return `uv add${edits[0]}`;
      // Several declarations pin it: each edit alone would resolve against the others' old
      // pins and fail. Edit them all without locking, then lock once.
      return [...edits.map((e) => `uv add --frozen${e}`), "uv lock"].join(" && ");
    }
    case "poetry": {
      const edits = sections.flatMap((section) =>
        declared(section).map((shape) => ({ section, shape }))
      );
      // Several declarations: each `poetry add` resolves against the others' old pins and
      // fails, so the step is to edit them all, then lock once.
      if (edits.length > 1) {
        // Name each affected declaration (section and condition): other alternatives of the
        // same entry pin other versions and must stay as they are.
        const which = edits.map((e) => {
          const section = e.section === "." ? "main" : e.section;
          const marker = e.shape ? /;\s*(.+)$/.exec(e.shape)?.[1] : undefined;
          return marker ? `${section} for ${marker}` : section;
        });
        return `set the ${pkg} declarations in pyproject.toml (${[...new Set(which)].join("; ")}) to ${version}, then run poetry lock`;
      }
      return sections
        .flatMap((section) =>
          declared(section).map((shape) => {
            // One alternative of a multiple-constraint list: `poetry add` would replace the
            // whole list, so the step is an edit of that entry, then a lock.
            if (shape?.startsWith("!")) {
              const marker = /;\s*(.+)$/.exec(shape)?.[1];
              const which = marker ? ` entry for ${marker}` : " entry";
              return `set the ${pkg}${which} in pyproject.toml to ${version}, then run poetry lock`;
            }
            // Poetry takes a PEP 508 requirement when it carries a marker, else `name[extras]@X`.
            const spec = shape?.includes(";")
              ? pythonRequirement(pkg, shape, `==${version}`, true)
              : pythonRequirement(pkg, shape, `@${version}`, false);
            return `poetry add${poetrySection(section)} ${spec}`;
          })
        )
        .join(" && ");
    }
    case "pipenv": {
      // A Pipfile has [packages] and [dev-packages] only.
      const commands = sections.flatMap((section) => {
        const target = section === "." ? "." : "dev";
        const flag = section === "." ? "" : " --dev";
        return declared(target).map(
          (shape) => `pipenv install${flag} ${pythonRequirement(pkg, shape, `==${version}`, true)}`
        );
      });
      return [...new Set(commands)].join(" && ");
    }
    case "maven":
    case "gradle":
    case "pip":
      // A requirements file has no sections; pip installs into the environment.
      return `pip install ${pythonRequirement(pkg, declared(".")[0], `==${version}`, false)}`;
  }
}

/**
 * `npm i next@16.3.8`, `composer require symfony/http-kernel:^6.4.3`, `uv add httpx==0.28.1`,
 * `poetry add httpx@0.28.1`, `pipenv install httpx==0.28.1`, `pip install httpx==0.28.1`,
 * `go get golang.org/x/net@v0.33.0` (Go versions are stored without the `v`; a replaced module
 * gets `go mod edit -replace=old=new@v1.0.4 && go mod tidy`); development-only
 * packages keep their section (`composer require --dev`, `poetry add --group test`).
 */
export function installCommand(
  ecosystem: Ecosystem | undefined,
  pkg: string,
  version: string,
  variant: InstallVariant = {}
): string {
  switch (ecosystem ?? "npm") {
    case "NuGet":
      return (variant.project?.split(",") ?? ["<project.csproj>"])
        .map(
          (project) =>
            `dotnet add ${shellWord(project)} package ${shellWord(pkg)} --version ${shellWord(version)}`
        )
        .join(" && ");
    case "Maven":
      return `set ${pkg} in ${variant.project ?? (variant.manager === "gradle" ? "build.gradle" : "pom.xml")} to ${version}, then resolve dependencies`;
    case "GitHub Actions": {
      const tag = Object.entries(variant.actionTags ?? {}).find(
        ([name]) => semver.valid(name) === semver.valid(version)
      );
      return tag
        ? `pin ${pkg} to ${tag[0]} (sha ${tag[1]})`
        : `read the advisory for the ${pkg} ${version} release tag`;
    }

    case "crates.io":
      return `cargo update -p ${shellWord(`${pkg}${variant.requirement ? `@${variant.requirement}` : ""}`)} --precise ${shellWord(version)}`;

    case "RubyGems":
      return `set ${pkg} in Gemfile to "~> ${version}", then run bundle update ${shellWord(pkg)} --conservative`;
    case "Packagist":
      return `composer require${variant.dev ? " --dev" : ""} ${pkg}:^${version}`;
    case "PyPI":
      return pythonInstall(variant, pkg, version);
    case "Go":
      // A replaced module is built from its replacement, which `go get` leaves as it is;
      // `go mod edit` reads only go.mod, so tidy fetches the new version and its go.sum lines.
      if (variant.requirement)
        return `go mod edit -replace=${variant.requirement}=${pkg}@v${version} && go mod tidy`;
      // go.mod has no development section; `go get` keeps the requirement where it is.
      return `go get ${pkg}@v${version}`;
    case "npm":
      // npm updates a package in the section that declares it.
      return `npm i ${pkg}@${version}`;
  }
}

/**
 * The command that shows which packages pull `pkg` in: `npm ls undici`, `composer why
 * psr/log`, `uv tree --invert --package idna`, `pipdeptree -r -p idna`, `go mod why -m
 * golang.org/x/text`.
 */
export function whyCommand(
  ecosystem: Ecosystem | undefined,
  pkg: string,
  manager?: PackageManager,
  project?: string
): string {
  switch (ecosystem ?? "npm") {
    case "NuGet":
      return (project?.split(",") ?? ["<project.csproj>"])
        .map((file) => `dotnet nuget why ${shellWord(file)} ${shellWord(pkg)}`)
        .join(" && ");
    case "Maven":
      return manager === "gradle"
        ? "./gradlew dependencies --configuration runtimeClasspath"
        : "mvn dependency:tree";
    case "GitHub Actions":
      return `inspect uses: ${pkg} in .github/workflows`;

    case "crates.io":
      return `cargo tree -i ${shellWord(pkg)}`;

    case "RubyGems":
      return `bundle exec gem dependency ${shellWord(pkg)} --reverse-dependencies`;
    case "Packagist":
      return `composer why ${pkg}`;
    case "PyPI":
      return manager === "uv" ? `uv tree --invert --package ${pkg}` : `pipdeptree -r -p ${pkg}`;
    case "Go":
      return `go mod why -m ${pkg}`;
    case "npm":
      return `npm ls ${pkg}`;
  }
}
