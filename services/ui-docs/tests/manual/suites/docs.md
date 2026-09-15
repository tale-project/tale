# Documentation pages

> **Prefix** `DOCS-` · **Reset** none · **Cost** ~30 min

Every page under `/docs` — the **app** design language, in the shared
`@tale/ui/docs/*` frame the product docs render too: the navigation rail, the
`h-13` header strip with the breadcrumb trail and the page actions, the article
with its title and live examples, the **On this page** outline, the neighbour
cards, the footer, the phone drawer, print, both themes, and the 404. Search
has its own suite ([search.md](search.md)); the crawler surface too
([seo.md](seo.md)).

## Scope & routes

| Surface        | Route / source                                                                          |
| -------------- | --------------------------------------------------------------------------------------- |
| Any page       | `{base}/docs/<section>/<slug>`, e.g. `{base}/docs/components/button`                    |
| Section index  | none — `{base}/docs` redirects to the first page in `content/nav.json`                  |
| Unknown page   | `{base}/docs/nope-not-a-page` → styled 404                                              |
| Rail source    | `content/nav.json` → `lib/content/nav-sections.ts` → `@tale/ui/docs/docs-nav-tree`       |
| Live examples  | `app/demos/<family>/<name>.tsx`, rendered by `app/components/demo/demo.tsx`             |
| Chrome         | `@tale/ui/docs/*`, fed by `app/components/docs/ui-docs-layout.tsx`                       |

## Preconditions

The dev server up per [`../setup.md`](../setup.md), a 1440×900 viewport.
`tests/navigation.test.ts` and `tests/content.test.ts` already guarantee that
every nav entry resolves to a page and every `<Demo>` to a file, so this suite
judges **behaviour**, not link rot.

> **Agent note**: the rail is a `<nav>` named **Design system documentation**
> (`nav.sidebarAriaLabel`), hidden below `md` (768 px) where **Open navigation
> menu** opens the same tree in a left drawer. Exactly one row carries
> `aria-current="page"`. The trail is a `<nav>` named **Breadcrumbs** whose leaf
> is a plain `aria-current="page"` marker; the page's only `h1` is the article
> title below the strip.

## Boxes

- [ ] `DOCS-1` · **Open `/docs/components/button` and read the rail** → the
  groups read Getting started, Foundations, Components, Patterns, Marketing UI
  in that order; only the **Button** row is highlighted and only it carries
  `aria-current="page"`; the row is scrolled into view without the page moving.
- [ ] `DOCS-2` · **Read the header strip** → the trail reads **Docs /
  Components / Button**; **Docs** is a link to the introduction, **Components**
  is plain text, **Button** is the current-page marker and not a heading — the
  article title below is the only `h1` in the document; **Copy page** and
  **Open in** sit at the strip's right, and the strip's bottom border meets the
  rail's logo-row border as one line, with no step.
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
- [ ] `DOCS-8` · **Hover Edit on GitHub** → the link targets
  `services/ui-docs/content/components/button.md` on the `main` branch of the
  Tale repository and opens in a new tab with `rel="noopener noreferrer"`.
- [ ] `DOCS-9` · **Open the page actions (Copy page, Open in)** → **Copy page**
  places the page's markdown (frontmatter and body) on the clipboard and
  confirms; **Open in** lists View as Markdown, ChatGPT, Claude and Cursor;
  View as Markdown opens `/docs/components/button.md` as plain markdown.
- [ ] `DOCS-10` · **Switch the theme to Dark from the footer, open three other
  pages, then switch back** → every surface re-skins from tokens (rail, strip,
  code panels, live examples, tables, badges) with no hardcoded light patch;
  the choice survives navigation and a reload.
- [ ] `DOCS-11` · **Resize to 393 px wide** → the rail gives way to the phone
  bar (menu · logo · search); the header strip under it keeps the immediate
  parent and the page name, with **Copy page** and **Open in** stacked below;
  the outline folds into a collapsed **On this page** disclosure above the
  title; the article keeps its `h1` and its full width; nothing overflows
  horizontally.
- [ ] `DOCS-12` · **Open the drawer, pick Input, then reopen it and press
  Escape** → the drawer is a dialog with the same tree and the same single
  current row; choosing a row navigates and closes it; Escape closes it in one
  press and returns focus to **Open navigation menu**.
- [ ] `DOCS-13` · **With the drawer open, widen the window past 768 px** → the
  drawer and its scrim are both gone; the page is clickable; no stray overlay
  remains.
- [ ] `DOCS-14` · **Open `/docs/components/nope`** → the not-found page
  renders inside the docs frame (rail, strip, footer): **Page not found**,
  **Did you mean** cards led by the closest page, and a working **Back to docs
  home** button that opens the introduction; the document title starts with
  **Page not found**.
- [ ] `DOCS-15` · **Read the footer at the end of the Button page** → the
  copyright and licence lines sit on the left; **llms.txt** and
  **llms-full.txt** open the machine-readable indexes; **Switch theme** offers
  Light, Dark and System; the GitHub button opens the repository in a new tab;
  there is no language switcher, because the pages are English only; the
  floating **Back to top** button never covers the last control.
- [ ] `DOCS-16` · **Open the print preview (Cmd/Ctrl+P) on the Button page** →
  only the reading surface prints: the trail, the title, the description and
  the body with its examples; the rail, the phone bar, the page actions, both
  outline copies, the neighbour cards, **Edit on GitHub**, the footer and
  **Back to top** are absent.
- [ ] `DOCS-17` · **Scroll the Button page more than a screen down, then
  activate Back to top** → the round button fades in at the bottom right after
  about 600 px, returns to the top (instantly when the OS asks for reduced
  motion), and fades out again; while hidden it is not reachable with Tab.
