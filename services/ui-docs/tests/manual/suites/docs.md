# Documentation pages

> **Prefix** `DOCS-` · **Reset** none · **Cost** ~50 min

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
  shared copyright and licence footnote sits on the left; **llms.txt** and
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
- [ ] `DOCS-18` · **Open `/docs/patterns/list-page`, use Scroll to last item in the large-list example, then select Item 5000 with the keyboard** → the last item is reachable, **Selected Item 5000** appears, its focus remains visible, and the example and its Code panel fit desktop and phone widths in both themes.
- [ ] `DOCS-19` · **Open `/docs/components/time-field`, tab into the first example and set 17:45 with the keyboard only, then paste `9:30 pm` into the second field; repeat with VoiceOver** → each part is one tab stop with a visible focus highlight, the arrows wrap without carrying into the next part, typing `1` `7` moves on to the minutes, the pasted time replaces the whole value, the stored line under the fields follows, and VoiceOver reads the field's name and whole time, then each part's name and spoken value ("9 PM", "45 minutes").
- [ ] `DOCS-20` · **At 320 px wide, open `/docs/components/recurrence-picker#schedule-with-times-of-day`, open the first schedule example and go to Custom interval; check Only between and set Until to 11:00 AM with the keyboard; go back, open Custom times, add a time and remove it; repeat with VoiceOver** → the popover stays inside the window with no sideways scroll; the views swap with a soft fade (none with reduced motion); with Every 15 minutes the sentence under the hours names the first and last start; a step of 6 hours between 8:00 and 11:00 turns it red and Save reads as unavailable with the same reason; the new time drops in with focus on its hour, and after Remove focus lands on the remaining row; VoiceOver reads each time as **Time 1**, **Time 2** with its whole time, and each remove button with the time it removes.
- [ ] `DOCS-21` · **Open `/docs/components/code-editor` in light and dark: in Write templates, type `{{` at the end of Prompt and then `}`; in Show problems, press F8 three times, then go back to the misspelled `triag` and press ⌘. (Ctrl+.); in Complete names and show types, type `nodes.` in Code, then put the cursor on `total` and press ⌘K ⌘I (Ctrl+K Ctrl+I); repeat with VoiceOver** → each example highlights in the same colours as the Read-only code example, readable in both themes; `{{` becomes `{{  }}` with the caret inside and the list open, `}` steps over the closing braces, and each template reads as one tinted chip; F8 selects each problem in turn, opens its tooltip and VoiceOver reads it; ⌘. replaces `triag` with the suggested name; after `nodes.` the list offers `issues` and `score` with their types; ⌘K ⌘I shows the same type tooltip a pointer gets and VoiceOver reads it.
- [ ] `DOCS-22` · **On `/docs/components/code-editor`, Tab into the Code field of Edit code in a form, press Tab, then Escape, then Tab; open Expand editor, move the caret, and return; at 375 px wide, repeat the first example with the on-screen keyboard** → after keyboard focus, a legend on the field's bottom edge shows the way out, and a click never shows it; the first Tab indents, Escape then Tab leaves the field for the next control; the expanded editor opens with the caret where it was and brings it back on return; at 375 px no example scrolls sideways, the text does not zoom the page, and selecting text with touch handles works.
- [ ] `DOCS-23` · **Open `/docs/components/schema-tree` and `/docs/foundations/icons#show-a-vendors-own-icon` in light and dark, then at 375 px** → the Compact tree lists one line per top-level field and the Comfortable one nests the fields of objects and list items with their descriptions; each kind reads in words and "required" is said in words, not only by colour; the vendor icon shows the vendor's own mark, a neutral plug for WebDAV, which ships none, and the same plug for the icon that failed to load, never a broken image; nothing overflows at 375 px.
- [ ] `DOCS-24` · **Open `/docs/components/workflow-canvas` in light and dark: watch Draw a workflow appear, press Save the next version twice and Go back a version once in Watch it change, turn on the route switch in Follow the lines, Tab into a chart and walk it with the arrow keys, Home and End, then switch to the list with Show as list; repeat at 375 px and with reduced motion** → each chart appears laid out top to bottom from Start to End, with no line through a box, a condition, a frame header or a label; a saved version glides to its new layout in about a third of a second, a new box grows in, nothing swaps sides with its row neighbour, and the changed boxes ring once; the route's points sit on the line's corners; the chart is one Tab stop whose arrows follow the lines and whose Home and End jump to Start and End, with a visible focus ring; the list says the same in text; at 375 px the canvas opens as a list and still offers its controls; with reduced motion every change simply appears, with no glide and no ring.
- [ ] `DOCS-25` · **Open `/docs/components/workflow-paths#explore-the-paths` and `/docs/components/workflow-playback` in light and dark: point at each path, press Enter on one and Escape; point at a row under Ends the run when it fails; in Replay a run, press Play, drag the scrubber back, and press `[` and `]` on the bar; repeat at 375 px and with reduced motion** → pointing previews a path and Enter pins it: the boxes off the path turn dashed on a muted surface with their reason and full-contrast words, and Escape or Show all shows every path again; a halting row rings its nodes in red; in Show where a run ended the failed node is framed red with its error line and the way to it stands out; Play moves dots along the lines that dissolve into the box they reach, the approval wait shows as a hatched band on the scrubber, scrubbing back swaps the strips at once, and `[` and `]` step between events; at 375 px the bar folds its speed into a menu and nothing overflows; with reduced motion there are no dots and Play steps from event to event.
