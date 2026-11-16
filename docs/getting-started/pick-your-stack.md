# Watch a stack without a repo

If you cannot share your repos and cannot run the scanner, pick your stack by hand. Briff then
watches the releases and security advisories of what you picked, exactly as it does for a
scanned repo: weekly bulletin, same-day security alerts, email, Slack and webhook delivery.

Open **Stack → Pick a stack**, or **Pick your stack** on the onboarding page and in Connect
repos. Nothing is installed and Briff never sees your code.

## What you can pick

| Kind                  | Examples                                                                                                                                        | Followed through                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Runtimes & platforms  | Node.js, Bun, PHP, Python, Go, Java, .NET, PostgreSQL, Redis, nginx                                                                             | The runtime's security and release channels, end-of-life dates |
| Packages & frameworks | React, Next.js, Laravel, Django, Spring Boot, or any package of npm, Composer, PyPI, Go, RubyGems, crates.io, Maven, NuGet, Pub, SwiftPM or Hex | The package's release feed and OSV advisories                  |
| Tools                 | Dokploy, Coolify, Traefik, Grafana, Supabase, or any public GitHub repository (`owner/repo`)                                                    | The repository's GitHub releases and security advisories       |

A package that is not in the list can be typed: names Briff already watches are suggested
first, and the registry confirms that a new name exists. A GitHub repository is checked against
the GitHub API; when GitHub does not answer (rate limit) it is added unverified.

## Versions are optional

| You give                     | Briff stores                      | What you get                                                        |
| ---------------------------- | --------------------------------- | ------------------------------------------------------------------- |
| Nothing (`any`)              | a requirement `*`                 | every release and security item of the item; no version check       |
| A range (`^19`, `>=5.0`)     | the range as a requirement        | the same; the range is shown, not judged                            |
| An exact version (`19.2.1`)  | an installed version, like a scan | OSV advisories for that version, the fix on its release line, drift |
| A runtime line (`22`, `8.3`) | the release line                  | end-of-life dates and "update to 22.x.y or later" in alerts         |

Without a version an advisory cannot tell whether you are affected, so a security release of a
package you picked reaches you as a security item ("check which version runs"), never as an
alert with an installed version. Give the exact version when you know it.

## Streams and cadence

A stack counts as one repo. New stacks go into the stream you choose (the onboarding puts it in
the first stream); a stack in no stream gets nothing. Each stream sends a **weekly bulletin**
and **security alerts**, and either can be turned off on the Streams page (one stays on). A
stack gets same-day alerts while any of its streams has them on.

## Limits

On the hosted service the items of all your stacks together count toward a plan limit; every
stack also counts as one repo. Self-hosted instances have no limits.

| Plan | Stack items |
| ---- | ----------- |
| Free | 25          |
| Pro  | 150         |
| Team | unlimited   |

Only owners create, edit and delete stacks; every change is in the organisation's activity log.
