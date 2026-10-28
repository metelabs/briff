import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { collectFromFiles } from "./collect";
import { parsePubLock } from "./pub-lock";
const fixture = (name: string) =>
  readFileSync(new URL(`./__fixtures__/pub/${name}`, import.meta.url), "utf8");
describe("pub", () => {
  it("reads lock ownership, excludes SDK packages and picks Flutter", async () => {
    const repo = await collectFromFiles(
      "acme/pub",
      { "pubspec.lock": fixture("pubspec.lock"), "pubspec.yaml": fixture("pubspec.yaml") },
      {
        warn: (message) => {
          throw new Error(message);
        },
      }
    );
    expect(repo?.dependencies).toEqual([
      {
        name: "archive",
        version: "3.3.1",
        direct: true,
        dev: true,
        ecosystem: "Pub",
        project: "pubspec.yaml:flutter",
      },
      {
        name: "dio",
        version: "4.0.0",
        direct: true,
        ecosystem: "Pub",
        project: "pubspec.yaml:flutter",
      },
      { name: "path", version: "1.8.0", direct: false, ecosystem: "Pub" },
    ]);
  });
  it("keeps unlocked ranges unresolved and excludes custom registries and path sources", () => {
    expect(
      parsePubLock(
        null,
        "dependencies:\n  dio: ^4.0.0\n  acme_local:\n    path: ../local\n  acme_private:\n    hosted: https://packages.example\n    version: ^1.0.0\n"
      )
    ).toEqual([
      {
        name: "dio",
        version: "^4.0.0",
        direct: true,
        ecosystem: "Pub",
        unresolved: true,
        project: "pubspec.yaml:dart",
      },
    ]);
  });
  it("merges owners of a pin across Dart and Flutter projects", async () => {
    const repo = await collectFromFiles(
      "acme/pub",
      {
        "a/pubspec.lock": fixture("pubspec.lock"),
        "a/pubspec.yaml": fixture("pubspec.yaml"),
        "b/pubspec.lock": fixture("pubspec.lock"),
        "b/pubspec.yaml": "name: acme_cli\ndependencies:\n  dio: ^4.0.0\n",
      },
      { warn: () => {} }
    );
    expect(repo?.dependencies.find((dep) => dep.name === "dio")?.project).toBe(
      "a/pubspec.yaml:flutter,b/pubspec.yaml:dart"
    );
  });
});
