# Not a finding

The registers that keep a round honest: what the docs site deliberately does not
do, what looks wrong but is correct by design, and what is a known gap already
tracked. **Nothing on these lists is a round finding.** If a box brushes against
one, cite it and move on; if you disagree with an entry, that is a product
conversation, not a bug report.

Everything here is verified against the source. When a round proves an entry
wrong, fix the entry in the same change as the code — a stale quirk costs the
next round a false finding.

**This register starts almost empty on purpose.** It was created on 2026-09-08
with the shared manual-test shape; the guides it replaced had no such list.

## Out of scope

- **The static gate owns structural correctness.** Links, images, videos, nav
  entries, redirects, locale mirrors, frontmatter and page structure are
  validated at build time — a round that re-checks them by hand is spending its
  afternoon on what a spec already holds ([`automation.md`](automation.md)).
  Accuracy, useful explanations, native prose and the readability of rendered
  content still require review.

## Product quirks

- **The rail's search field truncates its placeholder in DE/FR.** The field is
  the rail's width (16 rem) minus the `⌘K` hint, and **Dokumentation
  durchsuchen** / **Rechercher dans la documentation** are longer than that —
  they ellipsize by design (`@tale/ui` `docs-search-trigger.tsx`). The control's
  accessible name is the full **Open search** either way.
- **A first visit can open in dark mode.** With nothing saved, the docs follow
  the operating system's theme (the same `'system'` default as the
  design-system guide), so a reader whose OS is dark sees dark pages until they
  pick Light in the footer's theme switch. An app-language docs page in dark
  mode is not a finding — a hardcoded colour that fails to theme is
  (`A11Y-A6`).

## Known benign console output

Anything not on this list is a finding, on any page.

- <nothing recorded yet — the first round fills this in>

## Known debt

| ID | What | Pay it off when |
|---|---|---|
| `BL-1` | The container probe does not assert the HTTP status of the prerendered `/404`, so a soft-404 regression would only be caught by hand. | `container-docs-test.ts` asserts the status |
