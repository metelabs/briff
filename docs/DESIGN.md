# Briff design system: Triage

This document is the source of truth for Briff's dashboard UI. If something is not covered here, follow the
closest existing pattern rather than inventing one. Reference mocks: `docs/design/triage-pages.html` (every page,
light and dark; open it in a browser and switch pages, states and themes from its top bar). The logo and its rules
are in §12.

Where this document and the repo rules differ, the repo rules win (they are restated here):

- Fonts are self-hosted with `next/font/local` (`src/app/fonts.ts`, files and OFL licences in
  `src/app/fonts/`); never `next/font/google` or a Google Fonts `<link>`.
- Upper-cased labels are written with `caps()` (`src/lib/i18n.ts`), never CSS `text-transform` or
  Tailwind `uppercase`. "Uppercase" in the tables below means `caps()`.
- The theme preference is a cookie (`briff-theme`) read by the root layout, so the server renders
  `data-theme` and there is no inline script.
- The mocks invent a few features the data model does not have (GitHub sign-in, magic links, a
  delivery time picker, weight sliders). The app implements the real behaviour in the same visual
  language instead.

## 1. Identity in one paragraph

Briff answers one question per visit: _is anything in my stack on fire, and where?_ The UI is therefore
**counts first, then a pivot** (by item, or by repo). It is calm by default and loud only for security. One
brand colour (petrol), one alarm colour (coral), three quiet "good to know" labels (blue for read, ochre for
upgrade, grey for wait). Display type is Bricolage Grotesque, set large and tight. Everything technical
(repo names, versions, commands) is Geist Mono. The interface should feel like a well-edited
bulletin, not like a monitoring console.

## 2. App shell (decision)

**One shell for every signed-in page: a sticky top bar with a pill nav.** No sidebar.

Why:

- Six destinations fit on one line, so a sidebar's main benefit (room for many items) doesn't apply here.
- The widest pages (Stack repo cards, By-repo grid) need the 220–240px a sidebar would use up on every page.
- Briff is visited weekly, not all day. Its chrome should be light and step back for the bulletin.
- The stream is a _scope_, not a destination. It sits at the top right as a picker (like an org switcher), and
  every page reads it.

Structure (desktop, ≥ 768px):

```
[logo briff] [Bulletins Alerts Stack Repos Streams Settings]          [Stream ▾ Acme] [avatar]
──────────────────────────────────────────────────────────────────────────────────────────────
  page header: eyebrow · H1 · one-line sub · page actions (right)
  page body (the same 1200px container as the bar's inner row, on every page)
```

Mobile (< 768px): row 1 is logo + stream picker + avatar. Row 2 is the pill nav, which scrolls horizontally
inside itself (never the page) and keeps the active pill scrolled into view.

Pages outside the shell: **Login**, **Onboarding** and a bulletin opened from an email link without a session use
a minimal header (`MinimalHeader`: logo only, plus a "Sign out" link on onboarding) in the same container as the
shell's bar, so the logo sits in the same place on every page. The public pages (landing, `/replay/<id>`) use the same
header position with a few section links and a secondary "Sign in" button, and the footer line
with Terms, Privacy, Security, Status, the support address, Docs, Source, Made by Metelabs
and the version (docs/LANDING.md). The legal pages (`/terms`, `/privacy`, `/refunds`, `/dpa`) put
a 72ch prose column (15px/1.6 body, H2 per section) under that header, with a table of contents
for long pages: sticky in a 220px column from 980px, a card above the text below that. Login and onboarding are centred single columns,
max-width 560px (login 400px), below that header.

Bar: background `--bg` at 85% with `backdrop-filter: blur(12px)`, 1px bottom `--line` that appears only after
scrolling 8px. Height 64px desktop; 104px on mobile (two rows).

## 3. Colour tokens

Raw tokens live on `:root` and `[data-theme="dark"]` (plus `prefers-color-scheme` when no explicit choice). Tailwind v4 maps
them through `@theme inline`, so utilities like `bg-surface`, `text-fg-muted`, `border-line`, `bg-sec-soft` work.

| Token            | Role                                                     | Light                 | Dark               |
| ---------------- | -------------------------------------------------------- | --------------------- | ------------------ |
| `--bg`           | Page background                                          | `#f2f5f7`             | `#0a1115`          |
| `--surface`      | Cards, bar pills, inputs                                 | `#ffffff`             | `#111a20`          |
| `--surface-2`    | Inset areas inside cards (fix box, table header, chips)  | `#f2f5f7`             | `#0d161b`          |
| `--line`         | Borders, dividers                                        | `#dde4e9`             | `#21303a`          |
| `--line-strong`  | Hover borders, input borders on focus-within             | `#b9c5ce`             | `#34495a`          |
| `--fg`           | Primary text, headings                                   | `#0d1b24`             | `#e5edf1`          |
| `--fg-muted`     | Secondary text, meta                                     | `#566874`             | `#8d9faa`          |
| `--fg-subtle`    | Placeholder, disabled, decorative only (never body text) | `#8a99a3`             | `#5d6f7a`          |
| `--brand`        | Petrol: primary buttons, active tab, links, focus ring   | `#0b6b67`             | `#3ccfc2`          |
| `--brand-soft`   | Brand tint: selected rows, week pill                     | `#d9eeec`             | `#0e2e2d`          |
| `--on-brand`     | Text on `--brand`                                        | `#ffffff`             | `#04201e`          |
| `--sec`          | Security coral: security labels, counts, card top rule   | `#b93522`             | `#ff7b64`          |
| `--sec-soft`     | Security tint                                            | `#fde6e0`             | `#3a1912`          |
| `--read`         | "Read" label                                             | `#3659b8`             | `#8eaaff`          |
| `--read-soft`    |                                                          | `#e3eafb`             | `#192343`          |
| `--upgrade`      | "Upgrade" label (ochre)                                  | `#8a560a`             | `#f1b85b`          |
| `--upgrade-soft` |                                                          | `#fbefd9`             | `#32260f`          |
| `--wait`         | "Wait" label (grey)                                      | `#5a6973`             | `#93a3ad`          |
| `--wait-soft`    |                                                          | `#e8edf0`             | `#1b252c`          |
| `--ok`           | Up to date, success toast, "connected"                   | `#1a6b43`             | `#4cc98a`          |
| `--ok-soft`      |                                                          | `#dcf1e4`             | `#10291c`          |
| `--code`         | Command background                                       | `#ffffff`             | `#0d161b`          |
| `--shadow`       | Shadow colour                                            | `rgb(13 27 36 / .07)` | `rgb(0 0 0 / .35)` |

```css
/* app/globals.css */
@import "tailwindcss";
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

:root {
  --bg: #f2f5f7;
  --surface: #ffffff; /* …all light values above… */
}
[data-theme="dark"] {
  --bg: #0a1115;
  --surface: #111a20; /* …all dark values… */
  color-scheme: dark;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    /* dark values */
  }
}

@theme inline {
  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-surface-2: var(--surface-2);
  --color-line: var(--line);
  --color-line-strong: var(--line-strong);
  --color-fg: var(--fg);
  --color-fg-muted: var(--fg-muted);
  --color-fg-subtle: var(--fg-subtle);
  --color-brand: var(--brand);
  --color-brand-soft: var(--brand-soft);
  --color-on-brand: var(--on-brand);
  --color-sec: var(--sec);
  --color-sec-soft: var(--sec-soft);
  --color-read: var(--read);
  --color-read-soft: var(--read-soft);
  --color-upgrade: var(--upgrade);
  --color-upgrade-soft: var(--upgrade-soft);
  --color-wait: var(--wait);
  --color-wait-soft: var(--wait-soft);
  --color-ok: var(--ok);
  --color-ok-soft: var(--ok-soft);
  --color-code: var(--code);
  --font-display: "Bricolage Grotesque", ui-sans-serif, system-ui, sans-serif;
  --font-sans: "Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
```

shadcn: map `--background`→`--bg`, `--card`/`--popover`→`--surface`, `--primary`→`--brand`,
`--primary-foreground`→`--on-brand`, `--destructive`→`--sec`, `--border`/`--input`→`--line`,
`--ring`→`--brand`, `--muted`→`--surface-2`, `--muted-foreground`→`--fg-muted`. Never use shadcn's default zinc palette.

### Colour rules

- **Coral means security, nothing else.** It is not used for destructive buttons in normal flows, form errors or
  decoration. Destructive actions (delete account) use `--sec` only inside a confirm dialog.
- **Petrol means "you can act here"**: primary button, active tab or pill, links, focus ring. At most **one** filled
  petrol button per view; on Settings, where each section holds its own forms, one per form.
- Severity in tables: CRITICAL/HIGH use `--sec`; MODERATE uses `--upgrade`; LOW uses `--wait`. These labels are
  always text, never colour alone.
- Drift cells: current = `--ok` text; minor behind = `--fg`; major behind = `--upgrade` on `--upgrade-soft`;
  EOL = `--sec` on `--sec-soft` with the word "EOL".
- No gradients, glows or glassmorphism, except the bar's blur.

## 4. Typography

Self-hosted (latin subsets of the Google Fonts files): Bricolage Grotesque (opsz 12–96, 500–700), Geist (400–600),
Geist Mono (400–500).

| Role                   | Font    | Size / line-height              | Weight  | Tracking         | Notes                                           |
| ---------------------- | ------- | ------------------------------- | ------- | ---------------- | ----------------------------------------------- |
| Hero H1 (bulletin)     | Display | clamp(34px, 5vw, 56px) / 1.0    | 600     | -0.035em         | One per page; can colour its count span `--sec` |
| Page H1                | Display | clamp(28px, 3.6vw, 40px) / 1.05 | 600     | -0.03em          |                                                 |
| Section H2             | Display | 19px / 1.2                      | 600     | -0.02em          | Followed by a count badge                       |
| Card title H3          | Display | 21px / 1.2 (19px mobile)        | 600     | -0.02em          | `text-wrap: balance`                            |
| Stat number            | Display | 34px / 1                        | 600     | -0.03em          | `tabular-nums`                                  |
| Body                   | Sans    | 14px / 1.5                      | 400     | 0                | Max 72ch                                        |
| Lead / summary         | Sans    | 16px / 1.5                      | 400     | 0                | `--fg-muted`, max 56ch                          |
| Row title              | Sans    | 15px / 1.35                     | 500     | 0                |                                                 |
| Meta / caption         | Sans    | 12.5–13px / 1.4                 | 400–500 | 0                | `--fg-muted`                                    |
| Label (tag)            | Sans    | 11.5px / 1                      | 600     | 0.04em, `caps()` |                                                 |
| Repo, version, package | Mono    | 12–13px / 1.4                   | 400–500 | 0                |                                                 |
| Command                | Mono    | 13px / 1.4                      | 400     | 0                | Single line, scrolls inside its box             |

Numbers in tables and tiles are always `tabular-nums`. Do not use Bricolage below 17px or for body text.

## 5. Space, radius, elevation

- **Spacing scale (px):** 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 56. Card padding 18 (15 mobile). Gap between cards 12.
  Gap between columns 18. Section spacing 32. Page side gutter `max(16px, env(safe-area-inset-*))`, 24px ≥ 1024px.
- **Radius:** chip 7, label 6, input/button 10, inset box 12, tile 14, card 16, pill/segmented 999.
- **Elevation:** there are only two levels. Rest = 1px `--line` border, no shadow. Raised (hover, dropdown,
  dialog) = `0 10px 28px var(--shadow)`. Dialogs add a scrim `rgb(10 17 21 / .45)`.

## 6. Layout grid

- **One container for everything:** max-width 1200px, centred, with the page gutter from §5. The top bar's inner
  row, every page body and the minimal header all use it (`PageContainer` / `PAGE_CONTAINER` in
  `src/components/shell/page-container.tsx`); never set a page's own max-width or gutter. Content wider than the
  container (long commands) scrolls inside its card; the container never widens.
- `html` has `scrollbar-gutter: stable`, so a short page and a long page centre at the same x with classic
  scrollbars.
- The bulletin hero is 2 columns (1.25fr / 1fr): headline + summary, then the 4 stat tiles. It stacks below 980px.
- The bulletin body is 2 columns (1.35fr / 1fr): attention cards, then know list + advisories + folded bar. It stacks
  below 980px, in that order.
- Repo grid (By repo): at most 2 columns (1 below 768px), cards top-aligned. A card has a header (repo
  name, "N need attention" coral when security, "N to know"), then "Needs your attention" and "Good to know"
  sections; each section shows 5 items and folds the rest behind "Show N more". Every item carries that
  repo's own command or step with a small Copy button. A jump from a repo chip highlights the card for 3s
  (brand outline + `--brand-soft`, fading; reduced motion: no fade).
- Stack: a summary strip (repos scanned, end-of-life runtimes, packages a major behind, repos up to
  date), filter chips + search, then one card per repo, most urgent first (end of life > majors behind
  > minor behind > current), a masonry of at most 2 columns (1 below 980px; `Masonry` in `src/components/ui/masonry.tsx`: each card keeps its natural height and goes to the shortest column in urgency order; the cards stay in DOM order, so focus and screen readers follow urgency). A card lists only what the repo uses:
  > one row per runtime, then its key packages, each with version, source, a status label ("EOL since
  > 2025-04-30", "Supported until 2027-04-30", "Current", "Behind" + "2 majors behind") and the target
  > line ("Move to 22.x (LTS, supported until 2027-04)", "Latest in your line: 20.19.4"). Rows wrap;
  > nothing scrolls sideways.
- List pages (Bulletins, Alerts, Repos) use a single column of rows inside a card. Filters sit above the card.
- Settings: 220px section index on the left (sticky) + 1 form column (max 640px); the index becomes a pill row on mobile.

## 7. Motion

| Thing                       | Duration                 | Easing                     | Notes                                                                                                                                               |
| --------------------------- | ------------------------ | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entrance (page, sections)   | 400–500ms                | `cubic-bezier(.2,.7,.2,1)` | rise 10px + fade; stagger 55ms per item, cap at 10 items                                                                                            |
| Count-up (stat tiles)       | 500ms (<20), 900ms (≥20) | ease-out cubic             | First paint of a bulletin only, not on revisit within session                                                                                       |
| Tab indicator / segmented   | 300ms                    | `cubic-bezier(.3,.8,.2,1)` | Indicator slides; labels only change colour                                                                                                         |
| Hover on cards/tiles        | 200–250ms                | same entrance easing       | translateY(-1 to -2px) + raised shadow                                                                                                              |
| Hover on pills, chips, rows | 120–150ms                | ease                       | colour/background only                                                                                                                              |
| Theme change                | 200ms                    | ease-out                   | View Transitions crossfade of the page; element transitions off while `<html data-theme-switching>`; instant without the API or with reduced motion |
| Copy button                 | 1400ms state             | none                       | label becomes "Copied" and toast appears                                                                                                            |
| Dialog                      | 180ms in, 120ms out      | ease-out                   | scale .98→1 + fade; scrim fade                                                                                                                      |
| Tooltip                     | 300ms delay, 120ms fade  | ease-out                   | scale .98→1 + fade                                                                                                                                  |
| Toast                       | 180ms in and out, 5s     | ease-out                   | slide 8px (down from the top on phones, up from the bottom ≥ 768px); `opacity` + `translate` only, absolutely placed so removal never reflows       |
| Expand/collapse             | 280ms                    | entrance easing            | `grid-template-rows: 0fr → 1fr`                                                                                                                     |

- Animate only `opacity`, `transform`, and colour properties. Never animate layout size, except grid-row expand.
- **Reduced motion:** with `prefers-reduced-motion: reduce`, every animation and transition is ~0ms, count-up
  shows final values, and smooth scroll becomes instant.
- In-page scrolls (section index, count tiles, repo chips) are smooth and stop 12px below the sticky bar
  (64px, 104px on mobile), never under it.
- Nothing loops. No skeleton shimmer; use a static `--surface-2` block.

## 8. Components

States for every interactive component: default, hover, focus-visible, active/pressed, disabled. Selected
states are noted where they apply.

- **Top bar nav (pills):** container `--surface` + `--line`, radius 999, padding 3. Pill 6×13px, 14px/500,
  `--fg-muted`. Hover: `--fg` on `--bg`. Current: `--fg` background, `--surface` text (an inverted pill), with `aria-current="page"`.
  Alerts pill may carry a coral dot when there are new alerts the member has not seen since their last
  visit to Alerts (dot, not a number).
- **Connect repos:** secondary pill button left of the stream picker (icon only below 1100px). It opens a
  side sheet (Base UI dialog: full height, right edge, max 620px, `--bg` with the onboarding card inside,
  scrim) with the same GitHub Action / Local scanner tabs as onboarding. Onboarding itself is first run only.
- **Footer:** one muted 12.5px line under every shell page (Terms, Privacy, Security,
  Status with the version, Docs, Changelog, Made by Metelabs, then "Contact: support@briff.dev" as
  text), 1px top `--line`. Nothing else goes there.
- **Stream picker:** pill button with a brand dot + stream name + chevron. Opens a popover listing streams with
  repo counts, a check on the current one, and a "Manage streams" link. Hover: border `--brand`.
- **Count tile:** surface card, radius 14, number (display 34) + caption (12px muted). Security-related numbers
  are coral. It is a button: it jumps to the relevant section. Hover lifts 2px.
- **Section header:** H2 + count badge (12px, pill, surface + line) + optional right-aligned action link.
- **Security card:** surface, radius 16, 3px coral top border. It holds: label, H3 title, repo chips (buttons → repo
  view), context line (muted), fix box, then a footer with source + feedback trio. There is no hover colour change; it lifts 1px.
- **Know row:** a row inside a shared card. Label + repos (mono, muted) on line 1, title (15px/500) on line 2,
  feedback trio at 50% opacity that becomes 100% on row hover or focus-within (always 100% on touch).
- **Label/tag:** `caps()` 11.5px/600, 6px dot of currentColor, soft background of its kind. Kinds: Security,
  Upgrade, Read, Wait, plus OK and EOL in tables.
- **Repo chip:** mono 12px, `--surface-2` + `--line`, radius 7. As a button: hover border `--brand`, background
  `--brand-soft`.
- **Runtime chip:** like a repo chip, with a source: `node 22 · Dockerfile`. EOL variant: coral text on
  `--sec-soft` with "EOL" suffix.
- **Fix box:** `--surface-2`, radius 12. Eyebrow "FIX" (brand, 11.5px/600 uppercase), optional prose with
  inline code, then a command row: `--code` + `--line`, radius 9, mono command, primary **Copy** button
  (small). Copied: button turns `--fg`/`--surface` and says "Copied", and a toast says "Copied to clipboard".
- **Feedback trio:** "Useful", "Not useful", "Less of this". Pill buttons, 12px, with an exclusive selection. Pressed:
  `--brand-soft` background, `--brand` text and border, `aria-pressed="true"`.
- **Advisory row:** package (mono 500) · meta (transitive/direct, count, repos) · severity label right-aligned.
  Expanded (Alerts page): advisory IDs, affected repos, one fix line per repo.
- **Folded-away bar:** full-width dashed `--line` border, radius 16, big number + "updates folded away" +
  "Open Stack →" in brand. Hover: border `--brand`.
- **Tabs (segmented):** surface + line, radius 10, padding 3, a sliding brand indicator, and active text `--on-brand`.
  Use them only for switching _views of the same data_ (By item/By repo). Use pills for navigation.
- **Filter chips:** pill, surface + line. Active: `--brand-soft` + `--brand` text. They show counts.
- **Table:** a surface card. Header row `--surface-2`, 12px/600 muted uppercase. Rows 44px min with 1px dividers.
  The first column is sticky on horizontal scroll. Tables scroll inside their card, never the page.
- **Buttons:** sizes sm 30px / md 36px / lg 44px. Radius 10. Variants:
  - Primary: `--brand` bg, `--on-brand` text. Hover brightness 1.08, active scale .97.
  - Secondary: `--surface` + `--line`. Hover border `--line-strong`.
  - Ghost: text only, `--fg-muted`. Hover `--fg` on `--surface-2`.
  - Danger: `--sec` text on `--surface` with `--sec` border. It is filled only as the confirm button in a dialog.
  - Disabled: 45% opacity, no hover.
- **Form field:** label 13px/500 above; input 40px, `--surface`, `--line`, radius 10; focus: border `--brand` +
  3px `--brand-soft` ring. Help text 12.5px muted below. Error: coral border is _not_ used. Use `--upgrade` border +
  message, to keep coral for security.
- **Toggle:** 36×20 track, `--line-strong` off, `--brand` on.
- **No native form controls:** never a bare `<select>`, `<input type="checkbox|radio">` or `<progress>`; they draw
  the browser's chrome. Use the primitives in `src/components/ui/`: `Select` (trigger styled as a form field,
  popup like the account menu, a check on the chosen item), `Checkbox` (16px, radius 5, `--brand` when ticked),
  `Accordion` (rows in one card, the chevron turns; open the item that answers the page's first question).
  `<details>` summaries draw their own indicator (the browser marker is hidden globally).
  `src/test/no-native-controls.test.ts` fails on a native control outside `src/components/ui/`.
- **Empty state:** centred in its card, 40px line icon in `--fg-subtle`, display 19px title, one muted sentence,
  one primary action. The copy says what will appear here and what to do, e.g. "No bulletin yet. Your first one
  arrives Monday after your repos are scanned."
- **Tooltip:** the only way to show text that does not fit or is abbreviated (a cut repo name, "4 repos", a
  drift cell's source). Never the browser's `title=` attribute. Inverted: `--fg` background, `--surface` text,
  radius 8, 12.5px, padding 6×10, max-width 320px, raised shadow, 6px from its trigger (top by default). It opens
  after 300ms on hover, at once on keyboard focus, and on touch a tap toggles it (a tap elsewhere closes it).
  `src/components/ui/tooltip.tsx`: `Tooltip` for any trigger, `TruncatedText` for single-line text that gets the
  tooltip (and a tab stop) only when it is actually cut or abbreviated. Inside a menu popup or a link,
  `TruncatedText` stays out of the tab order. Icon-only buttons keep `aria-label` (and may keep `title` as a fallback)
  next to the tooltip.
- **Callout:** a status that replaces a finished form when the page has nothing else to show (forgot password:
  "we sent a link" plus the spam hint and "try again"). `Callout` in `src/components/ui/callout.tsx`: radius 12,
  12×14px padding, 13.5px `--fg` text with the first sentence semibold, an 18px icon. Success: `--ok-soft` with a
  `--ok` border at 30% and a check icon (`role="status"`). Failure: `--upgrade-soft`, `--upgrade` border at 30%
  and an alert icon (`role="alert"`); never coral. Everything else goes to a toast.
- **Account menu theme row:** one line: "Theme" label (12.5px muted) and three 32px icon buttons in a
  `--surface-2` pill (System `Monitor`, Light `Sun`, Dark `Moon`). The current one is `--brand-soft` with
  `--brand` icon; each has an `aria-label` and a tooltip.
- **Form fields and autofill:** `globals.css` overrides `:-webkit-autofill` (inset `--surface` shadow,
  `-webkit-text-fill-color: var(--fg)`), so an autofilled field keeps the theme's colours instead of the browser's
  blue.
- **Settings account forms:** fields and the primary button share one row from 560px, the button at the right,
  bottom-aligned with the inputs (40px tall), help text under the fields. Below 560px: one column, the button full
  width under the fields.
- **Toast:** the result of every action on the auth and Settings pages (sign-in or reset errors, link sent,
  password or email changed, profile and delivery saved, verification resent), instead of a line under the inputs.
  Top-centre on phones, bottom-right ≥ 768px; radius 12, 13.5px, raised shadow, an 18px icon and a dismiss button.
  Kinds (`useToast`, `src/components/ui/toast.tsx`): ok = `--ok-soft` + `--ok` border at 30% + check; error =
  `--upgrade-soft` + `--upgrade` border at 30% + alert icon (never coral), announced assertively; info = surface +
  line + brand icon. One at a time, 5s. Server Action results go through `useResultToast(state, …)` (fires once per
  returned state). Redirects that carry a message in the query (`/settings?verified=1[&error=…]`,
  `?password=changed`, `/login?reset=1`, `?deleted=1`) are mapped in `src/lib/flash.ts`; `<FlashToast />` in the root
  layout shows the toast once and strips those params with `router.replace`, so a refresh does not repeat it. A
  URL yields one message: an `error=` code wins over the success. Dialog forms keep their inline `FormStatus` line.
- **Dialog:** surface, radius 16, max-width 440px, raised shadow + scrim. Title display 19px, body 14px, actions
  right-aligned (secondary, then primary or danger). Esc and scrim click close it. Focus is trapped and returns to the trigger on close.

## 9. Responsive

Breakpoints are 560, 768, 980 and 1200px.

- < 980: all 2-column layouts stack (main content first).
- < 768: top bar becomes two rows; Settings index becomes a scrolling pill row; tables keep their sticky first column
  and scroll horizontally inside the card.
- < 560: stat tiles become 2×2; card padding 15; feedback trios are always fully visible; hint texts are hidden.
- Never horizontal page scroll at 360px. Long mono strings (commands, repo names) scroll or wrap inside their box.

## 10. Accessibility

- Text contrast ≥ 4.5:1 on its own background, including labels on their soft tints (light values above were
  tuned for this; e.g. coral on its tint is 4.9:1, ochre 5.4:1, grey 4.8:1). `--fg-subtle` is decorative only.
- Focus ring: `outline: 2px solid var(--brand); outline-offset: 2px` on `:focus-visible`, everywhere,
  never removed.
- Colour is never the only signal. Every label has a word, and severity and drift have text.
- Keyboard: everything is reachable by Tab. Segmented tabs and filter chips use arrow keys (roving tabindex). `/` focuses
  search where one exists. `Esc` closes popovers and dialogs. Copy buttons announce "Copied" via `aria-live="polite"` on the toast.
- Hit targets ≥ 36px on desktop, ≥ 40px on touch (pad small pills with an invisible hit area).
- The theme setting is System / Light / Dark, in the account menu. It is stored in a cookie and the server renders
  `data-theme` on `<html>`, so there is no flash.

## 11. Do / Don't (keeping it Triage, not generic SaaS)

Do:

- Lead every page with the answer (a count or sentence), then the detail.
- Put the _command_ next to every problem. If there is no command, give a one-line action.
- Use real names everywhere: repo, package, version, file (`Dockerfile`, `docker-compose.yml`).
- Use Bricolage only for headlines and numbers. Keep it large and tight.
- Keep cards white on a grey-blue page (dark: lifted navy on near-black). Use borders for structure and shadows only on hover.
- Let empty states teach the next step.

Don't:

- No sidebar, no breadcrumb trail, no avatar stacks, no "welcome back" banners.
- No purple, no gradients, no glow, no glass cards, no emoji, no illustrations of people.
- No icon on every heading. Icons only where they carry meaning (nav on mobile, empty states, toasts, callouts).
- No coral outside security. No second accent colour.
- No charts for the sake of charts. Briff's data is lists and versions; a number beats a donut.
  The two charts that earn a place are on Home: a 12-week "needs your attention" sparkline per stream
  (2px brand line, gaps for weeks without a bulletin, the current week marked, first/last week and the
  max labelled, a hover tooltip per week and a hidden table) and the backlog's severity bar (stacked,
  2px gaps, text legend with counts). Inline SVG/HTML with the tokens, no chart library.
- No more than 5 items in "Needs your attention" or "Good to know". Fold the rest; never paginate a bulletin.
- No hidden actions. Copy and feedback are always present; hover only raises their opacity.
- Don't use Inter, system-ui-only stacks, or shadcn's default look (zinc, 6px radius, shadow-sm on everything).

## 12. Logo

The Briff logo is the **Offset** mark (a disc cut once, top half shifted right) with the word **briff**
in Figtree 600, converted to outlines (no font needed). Files: `public/brand/` (SVG lockup / mark /
wordmark in light, dark and mono; favicons; app icons; `og-image.png`; Figtree's OFL). Component:
`src/components/logo/Logo.tsx` (`variant` lockup | mark | wordmark, `size` = height in px, `tone` auto |
light | dark | mono; `auto` takes the disc from `--brand` and the word from `currentColor`).

- Colours: disc petrol `#0b6b67` / teal `#3ccfc2` on dark, word ink `#141b1e` / paper `#e6ecee`, or
  white on a petrol tile. **Coral never appears in the logo.**
- Clear space: half the disc's diameter on every side (about 11px around a 24px-tall lockup).
- Minimum size: lockup 20px tall; mark 16px, and below 24px use `mark-favicon.svg` / `favicon.svg`.
- Lockup wherever the name is not already next to it (app top bar at 24px, login, email header at
  20px as an image); the mark alone where the name is present or the space is square (favicon, app
  icon, avatar). The email header uses the white-on-petrol tile `lockup-email-tile.png` (88x40,
  transparent corners, the 20px lockup with its clear space): Gmail's dark mode never inverts
  images, so an ink lockup would vanish on its dark surface. `lockup-email.png` /
  `-dark.png` stay published for emails already sent.
- Do not rotate, mirror, recolour, outline or shadow the disc, swap its halves, re-space the word or
  set it in another face. Scale the lockup as one piece.
