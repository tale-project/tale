# Why a box says that

Each row below is an expectation a suite carries **because something once went
wrong**. The box itself states only the check, so it stays readable; the reason
lives here.

Read this **before you reword, merge or delete a box** — an oddly specific
expectation is usually specific on purpose. Read it too when a box fails and you
want to know what class of defect it was written to catch.

Rows marked `docs` are corrections to this guide rather than to the product: the
box used to ask for something unreachable or wrong, and a round proved it.

**Adding a row:** when a round sharpens a box, add the row here in the same
change as the box edit. Key it by box ID, state the mechanism (not the symptom),
and name the test that now holds it. Never key a row by round — the journal in
[`../runs`](../runs) records rounds, this register records product knowledge.

## Smoke

| Box | What it pins |
|---|---|
| `SMOKE-3` | The first build rendered a live example's `<div>`s inside a `<p>`: a one-line `<Demo …></Demo>` is inline HTML to CommonMark, so the paragraph wrapper stayed and React logged a hydration warning on every docs page. `expandDemoTags` now puts the closing tag on its own line so the tag is an HTML block (`app/components/demo/expand-demo-tags.test.ts`). |
| `SMOKE-4` | The self-closing `<Demo name="…" />` authoring form is not a self-closing element to an HTML5 parser: `<demo>` stayed open and swallowed the rest of the article, so the Button page ended after its first example while the outline still listed nine more headings. The expansion step and the e2e assertion on the Button page's section count hold it. |

## Front page

| Box | What it pins |
|---|---|
| `HOME-3` | The sample window is now labelled “Components in a sample workspace” and remains an inert illustration. The first composition put the showcase heading **below** the product window while its copy said "the window below" — the sections are now heading first, window second. |
| `HOME-5` | `DemoShell` marks its payload `role="img"` + `inert`; a round that files "the settings form on the home page cannot be focused" has found the contract, not a bug. |

## Documentation pages

| Box | What it pins |
|---|---|
| `DOCS-1` | TanStack `Link` marks a link active by URL **prefix** and sets `aria-current="page"` itself, so on a deep page every ancestor row claimed to be the current page. Rows pass `activeOptions={{ exact: true }}` (`@tale/ui` `docs-nav-tree.tsx`). |
| `DOCS-12` | The drawer's close control used to be an `IconButton`, whose automatic tooltip opened the moment the drawer focused it; the Radix tooltip layer swallowed the first Escape, so the drawer needed two presses. It is a plain `Button` now, and focus is returned to the menu button explicitly because a state-driven `Sheet` has no `Dialog.Trigger` to do it (`@tale/ui` `docs-mobile-nav.tsx`). |
| `DOCS-13` | `Sheet`'s `md:hidden` hides the panel, not the portalled overlay: an open drawer plus a widening viewport left an invisible scrim over the page. The `open` state is released by the viewport, not just by CSS. |
| `DOCS-2` | The trail's leaf is a plain current-page marker, not a heading: the shared `DocsArticle` renders the frontmatter title as the page's only `h1`, and `tests/content.test.ts` refuses a body that starts with `# `. The strip is the `h-13` box itself, border included. The product docs once wrapped a fixed-height row in a bordered parent, so the strip stood 53 px beside the rail's 52 px logo row and the line stepped down at the rail's edge; `docs-layout.browser.test.tsx` and the smoke spec measure both bars now. |

## Crawler surface

| Box | What it pins |
|---|---|
| `SEO-7` | **Docs correction:** the SEO compiler serializes frontmatter and resolves site links to canonical absolute URLs. The Markdown twin preserves the authored body and Demo tags, but is not a byte-for-byte copy of the source file. Built endpoint review compares the body after normalizing those links. |
