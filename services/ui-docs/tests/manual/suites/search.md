# Search

> **Prefix** `SEARCH-` · **Reset** none · **Cost** ~10 min

The ⌘K palette on the documentation pages — the shared `@tale/ui` search
command over a MiniSearch index built from `content/` at build time
(`scripts/build-content.ts` → `public/search-index.json`). The palette's
behaviour (skeleton, recents, keyboard navigation, grouping, snippets) lives in
the package; this suite proves the wiring on this site.

## Scope & routes

| Surface     | Route / source                                                                 |
| ----------- | ------------------------------------------------------------------------------ |
| Trigger     | the rail's **Search** field, the phone bar's search icon, ⌘K / Ctrl+K          |
| Dialog      | `app/features/search/dialog.tsx` → `@tale/ui/search`                           |
| Index       | `app/features/search/build-index.ts`, `public/search-index.json` (git-ignored) |

## Preconditions

The dev server up per [`../setup.md`](../setup.md) — `dev` rebuilds the index
on start, so a page added after the server came up is not searchable until a
restart. Any documentation page open, a 1440×900 viewport.

## Boxes

- [ ] `SEARCH-1` · **Press ⌘K (Ctrl+K on Windows/Linux) on a docs page** → the
  palette opens with focus in its input; pressing it again closes it; the
  rail's **Search** field and, below 768 px, the phone bar's search icon open
  the same palette.
- [ ] `SEARCH-2` · **Type `button`** → results appear grouped by section
  (Components first), each with the page title, its trail and a snippet
  highlighting the term; the Button page is the first hit.
- [ ] `SEARCH-3` · **Arrow down twice and press Enter** → the highlighted
  result opens, the palette closes, the URL is the page's `/docs/…` path and
  the rail's current row follows.
- [ ] `SEARCH-4` · **Reopen the palette with an empty input** → the pages just
  visited are listed as recents; clearing them removes the section.
- [ ] `SEARCH-5` · **Type `zzzz-no-such-term`** → an honest empty state, no
  spinner left running, no console error.
- [ ] `SEARCH-6` · **Press Escape with results showing** → the palette closes
  in one press and focus returns to the control that opened it (the Search
  field, or the page when opened by keyboard).
