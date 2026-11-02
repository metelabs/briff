# Alerts and re-check

Security does not wait for Monday. Briff checks the installed versions of every repo in a stream
against [OSV](https://osv.dev) daily at 04:00 UTC, and the runtimes' own security feeds (Node.js,
PHP, Python and the others) every hour.

## Same-day email

- A **new critical or high** advisory for a version you run is emailed the same day, once per
  repo. An advisory without a severity counts as high.
- **Moderate and low** advisories are not emailed one by one; they appear on Alerts and in the
  next bulletin.
- A critical, high or unrated **runtime security release** that affects a runtime version a repo
  runs gets its own email within the hour, with what each repo runs and what to move to. When the fix is published after an advance notice, or a
  newly scanned repo turns out to be affected, a short follow-up says so.

## The first scan

Advisories a repo already had when it was first scanned are not news, so they are not emailed
one by one. You get one summary email (how many, how many critical or high, which repos), and
the advisories are listed on Alerts under **First-scan backlog** and on the next bulletin's page.

When you have looked through them, **Mark backlog as reviewed** hides the backlog of every stream
from Alerts and the home counts; **Mark reviewed** does the same for one package. Reviewed
advisories stay listed under `/alerts?reviewed=1`. New advisories are never hidden.

## The Alerts page

Alerts lists open advisories one group per package: the highest severity, the affected repos,
the number of advisories and the fix for each installed release line, with a step per repo and a
Copy button. The page follows the stream chosen in the top bar.

- A package that a repo only has **transitively** is labelled as such and gets no install
  command: update the package that pulls it in (`npm ls <package>` shows which).
- When no fixed version exists on the installed release line, the group says so instead of
  suggesting a higher major version.

## Fixed advisories

Briff does not wait for you to mark anything fixed. When a scan no longer finds an affected
version of the package, the alert is resolved and leaves the lists and counts. Alerts shows how
many were resolved this week, and a **Fixed since your last visit** group per section.

**Re-check now** asks for that scan at once: for repos connected through the GitHub App, Briff
re-scans every installation of the organisation (at most once every 10 minutes) and reloads the
page when the scans are done. Repos scanned by the Action or the CLI cannot be reached from the
server; the page shows the scanner command to run in the repo instead.
