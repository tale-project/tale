# Documentation pages

> **Prefix** `DOCS-` · **Reset** none · **Cost** ~25 min

Every page under `/docs` — the **app** design language built from `@tale/ui`:
the navigation rail, the `h-13` header strip with the breadcrumb trail, the
article with its live examples, the **On this page** outline, the neighbour
cards, the phone drawer, both themes, and the styled 404. Search has its own
suite ([search.md](search.md)); the crawler surface too ([seo.md](seo.md)).

## Scope & routes

| Surface        | Route / source                                                                          |
| -------------- | --------------------------------------------------------------------------------------- |
| Any page       | `{base}/docs/<section>/<slug>`, e.g. `{base}/docs/components/button`                    |
| Section index  | none — `{base}/docs` redirects to the first page in `content/nav.json`                  |
| Unknown page   | `{base}/docs/nope-not-a-page` → styled 404                                              |
| Rail source    | `content/nav.json` → `lib/content/nav.ts` → `app/components/docs/docs-nav-tree.tsx`     |
| Live examples  | `app/demos/<family>/<name>.tsx`, rendered by `app/components/demo/demo.tsx`             |
| Chrome         | `app/components/docs/*` (`docs-shell.tsx` composes it)                                  |

## Preconditions

The dev server up per [`../setup.md`](../setup.md), a 1440×900 viewport.
`tests/navigation.test.ts` and `tests/content.test.ts` already guarantee that
every nav entry resolves to a page and every `<Demo>` to a file, so this suite
judges **behaviour**, not link rot.

> **Agent note**: the rail is a `<nav>` named **Design system documentation**
> (`nav.sidebarAriaLabel`), hidden below `md` (768 px) where **Open navigation
> menu** opens the same tree in a left drawer. Exactly one row carries
> `aria-current="page"`. The trail is a `<nav>` named **Breadcrumbs** whose leaf
> is the page's only `h1`.

## Boxes

- [ ] `DOCS-1` · **Open `/docs/components/button` and read the rail** → the
  groups read Getting started, Foundations, Components, Patterns, Marketing UI
  in that order; only the **Button** row is highlighted and only it carries
  `aria-current="page"`; the row is scrolled into view without the page moving.
- [ ] `DOCS-2` · **Read the header strip** → the trail reads **Docs /
  Components / Button**; **Docs** is a link to the introduction, **Components**
  is plain text, **Button** is the page's `h1` and the only `h1` in the
  document.
- [ ] `DOCS-3` · **Open `/docs`** → the URL is replaced by
  `/docs/getting-started/introduction` (no index page, no history entry to go
  back to).
- [ ] `DOCS-4` · **Scroll the Button page top to bottom** → every `h2` the
  outline lists is present in the same order, each live example renders real
  controls under a **Live example** caption, and the props table is a real
  table with a header row.
- [ ] `DOCS-5` · **Activate Code under the Variants example** → a `tsx` panel
  opens beneath the preview with the demo's own source (it imports
  `@tale/ui/button`), the button now reads **Hide code** with
  `aria-expanded="true"`, the copy button copies the whole file, and activating
  it again closes the panel.
- [ ] `DOCS-6` · **Follow the outline: click Props, then scroll slowly back to
  the top** → clicking parks the Props heading just below the strip and marks
  the entry active; scrolling back walks the active entry through each earlier
  heading exactly once, never two at a time and never oscillating.
- [ ] `DOCS-7` · **Use the neighbour cards at the end of the page** →
  **Previous** is the last page of the previous group (Accessibility),
  **Next** is Input; each card is one link with the name in its accessible name,
  and the order matches `content/nav.json`.
- [ ] `DOCS-8` · **Hover Edit this page on GitHub** → the link targets
  `services/ui-docs/content/components/button.md` on the `main` branch of the
  Tale repository and opens in a new tab with `rel="noopener noreferrer"`.
- [ ] `DOCS-9` · **Open the page actions (Copy page, Open in)** → **Copy page**
  places the page's markdown (frontmatter and body) on the clipboard and
  confirms; **Open in** lists View as Markdown, ChatGPT, Claude and Cursor;
  View as Markdown opens `/docs/components/button.md` as plain markdown.
- [ ] `DOCS-10` · **Switch the theme to Dark from the strip, open three other
  pages, then switch back** → every surface re-skins from tokens (rail, strip,
  code panels, live examples, tables, badges) with no hardcoded light patch;
  the choice survives navigation and a reload.
- [ ] `DOCS-11` · **Resize to 393 px wide** → the rail gives way to the phone
  bar (menu · logo · search); the title strip stays under it with the page's
  `h1` and the theme switcher, its ancestors folded away; the article keeps its
  full width; the outline is not shown; nothing overflows horizontally.
- [ ] `DOCS-12` · **Open the drawer, pick Input, then reopen it and press
  Escape** → the drawer is a dialog with the same tree and the same single
  current row; choosing a row navigates and closes it; Escape closes it in one
  press and returns focus to **Open navigation menu**.
- [ ] `DOCS-13` · **With the drawer open, widen the window past 768 px** → the
  drawer and its scrim are both gone; the page is clickable; no stray overlay
  remains.
- [ ] `DOCS-14` · **Open `/docs/components/nope`** → the styled not-found page
  renders in the app colour scheme with a working **Back to the introduction**
  button; the document title starts with **Page not found**.
