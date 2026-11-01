# Public pages: landing and replays

The app serves its own public pages, in the Triage design system, without a session:

| Path                                         | What                                                                                   | Code                                               |
| -------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `/` (no session cookie)                      | Landing page                                                                           | `src/proxy.ts` rewrites to `/landing`              |
| `/` (session cookie)                         | The dashboard, unchanged (a stale cookie still ends at `/login`)                       | `src/app/page.tsx`                                 |
| `/landing`                                   | The landing page itself (canonical `/`, closed in robots.txt)                          | `src/app/landing/page.tsx`                         |
| `/replay/php2shell`, `/replay/node-oct-2026` | The replays, from the same scenarios and engine as `docs/replay/*.html`                | `src/app/replay/[id]/page.tsx`                     |
| `/terms`, `/privacy`, `/refunds`, `/dpa`     | Legal pages of the hosted service (one layout, operator facts in `src/lib/legal.ts`)   | `src/app/<page>/page.tsx`, `src/components/legal/` |
| `/.well-known/security.txt`                  | RFC 9116 contact file, static; renew `Expires` yearly (a test fails 30 days before)    | `public/.well-known/security.txt`                  |
| `/robots.txt`, `/sitemap.xml`                | Allow `/`, `/replay/` and the legal pages, close every app route; list the public URLs | `src/app/robots.ts`, `src/app/sitemap.ts`          |

- The proxy only checks whether Better Auth's session cookie is present; it reads no database.
  It runs for `/` alone (`matcher: "/"`), so no other request (uploads, webhooks) passes it.
- The public routes import nothing that can read a session or tenant data:
  `src/test/public-routes.test.ts` walks their imports and fails on the database client, the auth
  layer, `next/headers` or a Server Action module.
- The replay pages run the committed scenarios through the engine (`src/replay/public.ts`), the
  same output `npm run replay` writes to `docs/replay/*.html`.
- The bulletin sample on the landing page is the PHP2Shell replay's Monday bulletin, rendered by
  the same component as `/b/<id>` (`src/components/bulletin/bulletin-content.tsx`), and its fix
  email in a frame.
- The file list under "How it reads your repos" is `SCANNED_FILE_NAMES` / `SCANNED_NAME_PATTERNS`
  from `packages/scan/src/files.ts`, the lists `isScannedPath` (the GitHub App's filter) uses. A
  scanner change shows up in `src/components/landing/__snapshots__/scanned-files.test.ts.snap`.
- Legal pages: the operator's legal name, address, registration number and the backup and log
  retention are placeholders in `src/lib/legal.ts` (`[LEGAL_NAME]`, ...). Fill them there once;
  then remove `LEGAL_PLACEHOLDERS_ALLOWED` from `vitest.config.mts`, and
  `src/components/legal/legal-placeholders.test.ts` fails if a placeholder comes back. The
  sub-processor list (`src/components/legal/subprocessors.ts`) must stay in step with
  docs/PRIVACY.md. Both footers (public pages and the app shell) start with Terms, Privacy,
  Pricing, Security, Status and the support address (`TRUST_LINKS` in `links.ts`); the sign-up
  form says that creating an account accepts the Terms and Privacy Policy (not on the first,
  instance-owning account).
- Links to the repository (Self-host, Docs, Source, Security) are built from `SOURCE_URL` in
  `src/components/landing/links.ts`. The repository is private, so they 404 for visitors until
  it is opened; change that one constant if the source moves.
- Every page stays rendered per request: the root layout reads the theme cookie (no inline
  script, DESIGN.md §10). The replays run once per process (`publicReplay` caches the result);
  the landing page does no I/O. The replays read `src/sources/__fixtures__` at runtime, which
  `next.config.ts` traces into the standalone output.

## briff.dev: recommendation

**Keep one host.** The app stays on `app.briff.dev`, and `briff.dev` (today the old feed site)
becomes a permanent redirect to it, path included. A visitor to `briff.dev` lands on
`app.briff.dev/`, which shows the landing page until they sign in.

Why not serve the landing on `briff.dev` and the app on `app.briff.dev` from the same container:

- **Sessions.** Better Auth's cookie is host-only. A sign-in on `briff.dev` and one on
  `app.briff.dev` would be two separate sessions; every email link, the GitHub App callback and
  the scanner point at `app.briff.dev`.
- **Better Auth origin check.** `baseURL` is `BETTER_AUTH_URL` (`https://app.briff.dev`) and is
  the only trusted origin. Sign-in on `briff.dev` would need `trustedOrigins` (a config change and
  a second env variable) or would fail with "Invalid origin".
- **Everything else that names the host.** `BETTER_AUTH_URL` builds the email links and the
  signed feedback links; the GitHub App's Callback, Setup and Webhook URLs are registered at
  `app.briff.dev` (docs/GITHUB-APP.md); `briff-scan` uploads to `https://app.briff.dev` by default
  (`packages/scan/src/args.ts`). None of these change with a redirect.
- There is no `NEXT_PUBLIC_APP_URL` (or any `NEXT_PUBLIC_*`) in this app; all URLs are runtime
  env, so nothing needs rebuilding either way.

If the marketing URL must stay `briff.dev` in the address bar later, the app needs a host rule
in `src/proxy.ts` (public paths on `briff.dev`, a 308 to `app.briff.dev` for everything else) and
the `/login` links on the public pages made absolute. That is not built; the redirect below needs
no code.

## Runbook: point briff.dev at the app

Prerequisite: the release that contains the landing page is deployed. Check in a private window:
`https://app.briff.dev/` shows the landing page (headline "A weekly briefing of what changed in
the packages and runtimes your repos actually run, ..."), and `https://app.briff.dev/robots.txt`
lists `Allow: /`.

1. **Free the domain from the old feed site.** Dokploy → Projects → the project holding the old
   feed site → its application → **Domains** tab → the row `briff.dev` → trash icon → confirm.
   Do the same for `www.briff.dev` if it is listed.
   _You should see:_ `https://briff.dev` stops serving the feed (Traefik answers 404 for a minute).
   If the old feed site must stay reachable, give it another domain on the same tab first (e.g.
   `feed.briff.dev`) and add that DNS record as in step 4.

2. **Attach briff.dev to the Briff web service.** Dokploy → Projects → `briff` → `web` →
   **Domains** → **Add Domain**:
   - Host: `briff.dev`
   - Path: `/`
   - Container Port: `3000`
   - HTTPS: on, Certificate Provider: `Let's Encrypt`
   - **Create**. Repeat with Host `www.briff.dev`.
     Do not touch the existing `app.briff.dev` row.

3. **Redirect it to the app.** Same service: Dokploy → Projects → `briff` → `web` → **Advanced**
   → **Redirects** → **Add Redirect**:
   - Regex: `^https?://(www\.)?briff\.dev/(.*)`
   - Replacement: `https://app.briff.dev/${2}`
   - Permanent: on
   - **Create**. Dokploy writes the Traefik middleware at once; no redeploy is needed (if the
     next check still shows the old behaviour, click **Deploy** on the service).
     The regex names `briff.dev` with its scheme, so `app.briff.dev` never matches it: no loop.

4. **DNS (only if needed).** The old feed site already serves `briff.dev` from the Dokploy server, so
   the records should be right. Check:

   ```bash
   dig +short briff.dev
   dig +short www.briff.dev
   dig +short app.briff.dev
   ```

   _You should see:_ the same server IP three times. If `briff.dev` or `www` differs or is empty:
   at the registrar's DNS panel, set `A briff.dev → <that IP>` and `CNAME www → briff.dev`
   (TTL 300), wait for `dig` to agree, then on the Domains tab of step 2 open the domain and save
   it again so Let's Encrypt retries.

5. **Verify.**
   ```bash
   curl -sI https://briff.dev/ | grep -iE '^(HTTP|location)'
   # HTTP/2 308 (or 301) and location: https://app.briff.dev/
   curl -sI https://www.briff.dev/replay/php2shell | grep -i '^location'
   # location: https://app.briff.dev/replay/php2shell
   curl -s https://app.briff.dev/sitemap.xml | grep -c '<loc>'
   # 7
   ```
   Then in a private window open `https://briff.dev`: you end on `https://app.briff.dev/` with
   the landing page. In your normal window (signed in) the same URL shows your dashboard.

Common problems:

- **Browser warns about the certificate on briff.dev**: Let's Encrypt has not issued yet (DNS
  was not pointing at the server when the domain was added). Fix DNS (step 4), then re-save the
  domain in Dokploy; issuance takes about a minute.
- **briff.dev still shows the old feed**: the domain is still attached to the old feed site (step 1),
  or the browser cached it; check with `curl -sI`, not the browser.
- **`ERR_TOO_MANY_REDIRECTS`**: the regex was entered without `briff\.dev` (e.g. a catch-all
  `^https?://(.*)`), so it also matches `app.briff.dev`. Use the regex from step 3 exactly.
- **Sign-in fails with "Invalid origin"**: someone reached `/login` on `briff.dev` without the
  redirect. Step 3 is missing; nothing in the app config needs to change.

Nothing in the env changes: `BETTER_AUTH_URL` stays `https://app.briff.dev`.
