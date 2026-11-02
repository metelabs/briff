# Your first bulletin

Every Monday at 04:00 UTC Briff writes one bulletin for every stream that has at least one repo
and emails it to every member of the organisation. It covers what was published since the
stream's previous bulletin (the last 7 days for the first one): releases, deprecations,
deadlines and security fixes that touch the packages and runtimes those repos run.

All bulletins are listed on **Bulletins**; each one has its own page, which the email links to.
The links in the email open the page without signing in and stay valid for 90 days.

## What is in it

- **Needs your attention**, at most five items: security fixes, deadlines and changes you have
  to act on. Each names the affected repos, the version each one runs, the version to move to,
  and the command to run, with a Copy button. A fix command never crosses the installed major
  version; an end-of-life runtime gets a migration sentence instead.
- **Good to know**, at most five items, each labelled **Read**, **Upgrade** or **Wait**.
- **Also this week**: the rest, counted, and the minor releases folded into one bar.
- **Security advisories**: the new advisories of the week, one line per package with the fix
  for each installed release line. Advisories that the first scan found sit in a collapsed group
  below them.

The **By item / By repo** switch regroups the same bulletin per repo: each repo card lists what
needs attention in that repo and its own command.

## Feedback

The items on the page have **Useful**, **Not useful** and **Less of this**. Feedback shapes the
organisation's interest profile, which is refreshed before the next bulletin when there is new
feedback. The buttons are on the page only, not in the email.

## When it does not arrive

- **No repo is in a stream.** A stream without repos gets no bulletin; see
  [Put repos in a stream](connect-repos.md#put-repos-in-a-stream).
- **The email address is not verified.** Bulletins and alerts stop for an account that has not
  verified its email 7 days after sign-up. The banner at the top of the app resends the link.
- **Self-hosted without an Anthropic key or SMTP.** The bulletin needs `ANTHROPIC_API_KEY`;
  without SMTP it is written but not emailed (it is still on Bulletins). See
  [What works without the optional parts](../SELF-HOSTING.md#what-works-without-the-optional-parts).
  The instance admin can write one at once: Admin → Runs → `weekly-bulletin` → **Run now**.
