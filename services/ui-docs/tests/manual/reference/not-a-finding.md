# Not a finding

The registers that keep a round honest: what the site deliberately does not do,
what looks wrong but is correct by design, and what is a known gap already
tracked. **Nothing on these lists is a round finding.** If a box brushes against
one, cite it and move on; if you disagree with an entry, that is a product
conversation, not a bug report.

Everything here is verified against the source. When a round proves an entry
wrong, fix the entry in the same change as the code — a stale quirk costs the
next round a false finding.

## Out of scope

- **No locales.** The site is English-only by design — no `/de` or `/fr` trees,
  no language switcher, no `hreflang` cluster. The chrome catalog still ships
  `messages/{de,fr}.yml` because the repo's i18n gate requires every locale to
  be complete; nothing renders them.
- **No service worker, no offline shell, no update banner.** Unlike
  docs.tale.dev, this site registers no PWA layer.
- **The static gates own content correctness.** Nav entries, page files,
  frontmatter, the single-`h1` rule and every `<Demo>` reference are validated
  by `tests/*.test.ts` — a round that re-checks them by hand is spending its
  afternoon on what a spec already holds ([`automation.md`](automation.md)).

## Product quirks

- **Two design languages on one site.** `/` is the marketing language
  (`@tale/marketing-ui`: stone paper, pill buttons, scroll reveals); everything
  under `/docs` is the app language (`@tale/ui`: flat background, `h-9`
  controls, no reveals). The visual break between the two is the point, not a
  regression — the site documents exactly that split.
- **The front page's product window is not interactive.** `DemoShell` marks
  its payload `role="img"` + `inert`, so its fields, tabs and switch cannot be
  focused or operated. The interactive examples are the **Live example** blocks
  on the documentation pages.
- **Sections below the front page's fold are invisible until scrolled to.**
  `Reveal` (opacity-only, `whileInView`, once) fades them in; a full-page
  screenshot taken without scrolling shows blank bands. With
  `prefers-reduced-motion: reduce`, on SSR and on SPA revisits the reveal is
  skipped (`useSkipEntrance`).
- **`/docs` has no page of its own.** It redirects (replace) to the first entry
  of `content/nav.json`; a section label in the trail is plain text because a
  section has no index page.
- **Below `md` the page has two rows of chrome.** The phone bar (menu · logo ·
  search) and, under it, the header strip with the immediate parent, the page
  name and the page actions. The strip is a `div`, so the phone bar is the only
  `<header>`; the trail's `nav` carries the breadcrumb semantics at every
  width.
- **The outline is a rail only from `xl` (1280 px).** Below that it folds into
  a collapsed **On this page** disclosure above the title, so the article keeps
  its full width. Both copies ship in the HTML; the one the stylesheet hides is
  `aria-hidden`.
- **A live example that names no demo shows a red box on purpose.**
  `Unknown demo` (`demo.missingTitle`) is the visible failure mode so a rotten
  page cannot render an empty gap; `tests/content.test.ts` keeps it from
  reaching production.
- **The "Edit on GitHub" link targets `main`.** `VITE_UI_DOCS_BRANCH`
  changes it at build time; the dev server always says `main`.

## Known benign console output

Anything not on this list is a finding, on any page.

- `[search] index prefetch failed …` at `warn` level, **only** when the dev
  server was started without the content build (the index is missing). `dev`
  runs the build first, so a round on the documented commands never sees it.

## Known debt

| ID | What | Pay it off when |
|---|---|---|
| `BL-3` | Only nineteen pages exist; most `@tale/ui` components have no page yet, and the Button page is the template the rest copy. | one page per exported component family |
