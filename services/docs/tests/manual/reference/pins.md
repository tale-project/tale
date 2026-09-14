# Why a box says that

Each row below is an expectation a suite carries **because something once went
wrong**. The box itself states only the check, so it stays readable; the reason
lives here.

Read this **before you reword, merge or delete a box** — an oddly specific
expectation is usually specific on purpose. Read it too when a box fails and you
want to know what class of defect it was written to catch.

Rows marked `docs` are corrections to this guide rather than to the product: the
box used to ask for something unreachable or wrong, and a round proved it. They
stay so nobody re-introduces the old wording.

**Adding a row:** when a round sharpens a box, add the row here in the same
change as the box edit. Key it by box ID, state the mechanism (not the symptom),
and name the test that now holds it. Never key a row by round — the journal in
[`../runs`](../runs) records rounds, this register records product knowledge.

**This register starts empty on purpose.** It was created on 2026-09-08 with the
shared manual-test shape; until then a box's reason lived inside its own wording,
which is why several boxes read as long as they do. Move a reason here the first
time you are tempted to shorten one.

| Box | What it pins |
|---|---|
| `NAV-F4`, `A11Y-A12` | The app's breadcrumb (`HeaderBreadcrumbs`) ends in the page's `h1`. Docs cannot: a page's single `h1` is the article title the crawler and the prerender contract read (`tests/prerender/seo.test.ts`), so the trail leaf is a plain `aria-current="page"` span. The box says "not a heading" so a future port of the shared component doesn't quietly add a second title. |
| `NAV-F3`, `NAV-A3` | TanStack Router marks a `Link` active by **prefix** and gives an active link `aria-current="page"` for free, so before 2026-09-14 every ancestor row of a deep page claimed to be the current page. The rows now pass `activeOptions={{ exact: true }}`; `smoke.spec.ts` asserts a single marked row. |
| `NAV-F14`, `A11Y-A7` | The drawer's close control is a plain `Button`, not an `IconButton`: the IconButton's automatic tooltip opens as soon as the drawer focuses it, and a Radix tooltip layer swallows the first Escape — the drawer then needed two presses. The drawer is also state-driven (the bar owns the button), so it restores focus to that button itself. Both are why the box says "**one** Esc" and "focus returns". |
| `NAV-F14` | A `Sheet`'s `md:hidden` hides its panel, not the overlay Radix portals: a drawer left open while the window grew past `md` dimmed the desktop page and swallowed every click (found 2026-09-14 while rotating the phone view). The drawer now closes itself at the breakpoint, and `smoke.spec.ts` resizes with it open to prove it. |
| `NAV-F15`, `NAV-A1` | Both copies of the outline ship in the HTML (prerender must carry it at any width), so the copy the stylesheet hides is `aria-hidden` — the `AdaptiveHeader` contract. Judge "exactly one in the a11y tree", never "exactly one in the DOM". |
| `A11Y-A1`, `NAV-F3` | The article needs `tabIndex={-1}` for the shared skip link to focus it. Scrolling the active row with `scrollIntoView()` also changes Chromium's sequential focus starting point, skipping the skip link on first Tab; scroll only the rail container instead. `page-header.spec.ts` holds both behaviors at desktop and phone widths in EN/DE/FR. |
| `A11Y-A8`, `NAV-F5`, `NAV-F7` | CSS motion preferences do not override an explicit JavaScript `behavior: 'smooth'`. Section and top controls consult the shared media-query hook and request `instant` for reduced motion; their component tests cover both preferences. |
