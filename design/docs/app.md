# App — the platform design language

The **platform** product UI (`services/platform`). This is a distilled map; the exhaustive component +
screen specs live in [`design/sources/platform/design-system.md`](../sources/platform/design-system.md) — go
there for the detail of any element below, and to a `.pen` file (via Pencil) or
[`design/sources/platform/images/`](../sources/platform/images/) for the pixels.

## What the app feels like

A dense, calm, keyboard-friendly product surface in **light and dark**. Inter throughout, Lucide icons
only, generous whitespace on the `gap` scale, one bordered surface (`Card`), one control height (`h-9`).
Colour comes from tokens, never hex (see [tokens.md](tokens.md)). Motion is small and purposeful:
fades, slides, the AI shimmer — never decorative. A selection **glides** to its new place (the rail
pill, the view switcher, a section panel's highlight — measured with `useSlidingIndicator` and moved
by a CSS transform, since the app loads the lean animation bundle); new badges and unread dots pop in
once; a list swapped for another fades in; every motion honours `prefers-reduced-motion`.

## Shell & layout

Three levels, the same in every section: the **rail** says where you are, a **section panel** says
what is there, and the page shows the one thing you opened.

- **Rail** — a permanent 52px column of Lucide icon targets holding the sections: **Home**,
  **Knowledge**, **Automations**, and at its foot **Settings**, notifications and the account. The
  active section sits on one pill that glides from tile to tile (never two fills blinking); inactive
  tiles are muted; each shows a no-arrow tooltip to its right. Built from `@tale/ui` primitives, not a
  bespoke layout. A phone shows the same sections, from the same list, as the bottom tab bar.
- **Section panels** — a section with navigation of its own opens it in a panel beside the page,
  one frame for all of them: `SubPanel width="list"` (280px, full height, right border), a
  `SubPanelHeader` naming the section in the same `h-13` row as a page header (border included, so
  the two rules meet as one line), then rows. Fixed pages are icon rows with a highlight that glides
  to the open page (`SectionNavPanel` — Settings, Knowledge); Home lists your work. **Automations has
  no panel**: its canvas is a workbench that needs the full width.
- **Home** — chats, the tasks assigned to you or waiting on your review, and the inbox's customer
  conversations in **one list**. A pill switcher narrows it (All · Chats · Tasks · Inbox); Projects
  sit above the list as doors to their pages and as drop targets for filing chats; the list bands
  by time (Pinned, Today, Yesterday, Previous 7 days, Earlier). Every row has one anatomy: a 20px
  glyph that says what the item is (chat bubble, task status, contact initials), the title, a
  compact age, and a line of context (project, task key and status, contact and preview), with the
  blue unread dot in the same place for every kind. The Inbox view adds the status switch, search,
  facets and multi-select with bulk verbs. The panel stays mounted across every Home route; on a
  phone it is the Home screen itself.
- **Header** — per-page title row (`h-13`, `text-base` semibold `h1`) that always ends in exactly
  **one** `border-border` line: the tab strip's own `border-b` when a tab row follows (project and
  automation detail), otherwise the header's own bottom border (`AdaptiveHeaderRoot showBorder`).
  Beside a section panel, the page header names the open page (the panel already names the
  section). Icon buttons are 32×32, 8px radius, hover fill.
- **Conversation pages** — a chat, a task and a customer conversation open in one frame:
  `ThreadHeader` (the Home panel toggle, a 32px identity mark, the title, one quiet line of context,
  then the actions), a centred reading column, and the composer pinned at the foot in the same frame
  for all three (`CHAT_COMPOSER_FRAME_CLASS`). A task is a structured chat: its brief (description,
  files, subtasks) opens the thread as a card, comments and history follow oldest first under day
  pills, and its structure (status, owner, dates…) lives in a details panel that folds away.
- **Detail pages** — the header is a breadcrumb trail (`HeaderBreadcrumbs`: semantic `nav > ol`, the
  leaf is the page's only `h1`). When the entity has siblings, the leaf is the shared
  `HeaderBreadcrumbSwitcher` (name + chevron opening a titled, searchable list) — projects and
  automations use the same primitive. A tab strip (`TabNavigation`) follows the trail, and the page's
  verbs — Save/Discard and any entity actions — sit in the strip's trailing slot
  (`AdaptiveHeaderTabActionsSlot`), never in the title row's right half; the title row keeps only
  the name and its identity badges (archived, live). Run/sub-pages keep a plain leaf, keep the strip
  with the parent tab lit, and link the entity name back up the trail.
- **Right/secondary panels** (the Home panel, a task's details) slide in and **resize the main
  column** rather than overlay it; main content re-flows to the remaining width.
- **Main column is centred and width-capped** — e.g. chat is 558px (new) / 768px (conversation). Don't
  let product content run full-bleed.

## The big surfaces (pointers)

- **Chat** — centred input that auto-grows (72→200px then scrolls), send button appears only with
  content, agent selector dropdown above the input, streaming response with a blinking cursor + stop
  button, the **thinking timeline** (collapsed-by-default, user-controlled — never auto-expand it),
  rich-text/markdown answers, message hover actions. Specs: `design-system.md` → _Chat_, _Dev Notes_.
- **Conversations** (inbox) — listed in the Home panel's Inbox view (status switch, search, facets,
  bulk-action bar); the reading pane takes the page, with a Gmail-style reply composer and an
  "improve with AI" rewrite. Specs: `design-system.md` → _Conversations_.
- **Knowledge** — the Knowledge panel (Documents/Knowledge entries/Websites/Products/Contacts) beside a
  `DataTable`. Specs: `design-system.md` → _Knowledge_.
- **Auth, settings, automations, agents, onboarding** — each has a `.pen` under `design/sources/platform/`.

## Interaction conventions (hold these everywhere)

- **Hover fill** — gray-100 light / gray-800 dark on every interactive list row, icon button, and
  selector (read the token in `globals.css`; never hardcode the hex).
- **Pointer cursor on anything pressable** — `@tale/ui/globals.css` restores it in `base` for
  `button` / `[role="button"]` (Tailwind v4's Preflight sets `default`), and `not-allowed` while
  disabled. A row that is deliberately inert opts out with `cursor-default`; never re-add
  `cursor-pointer` per button.
- **Toasts** top-right, 5s auto-dismiss; **error** toasts persist until dismissed; stack with 8px gap.
- **Tooltips** on hover only (~200ms in / ~100ms out), never on click.
- **Modals/overlays** use a backdrop blur over a dimmed scrim; confirm/cancel actions right-aligned;
  destructive confirm uses the danger colour.
- **Loading** masks in place — `Skeletonize` around the real component, never a whole-tree swap or a
  bare spinner where a skeleton fits. Mask control surfaces with `SkeletonBox asChild`, preserving
  their real dimensions and corner radii; leave known labels and descriptions visible. Keep the same
  elements mounted as loading resolves.
- **Settings pages have no page titles** — the rail/tab already names the page; content starts at the
  first section header.
- **A collection screen scrolls its rows, never the page** — Automations, Projects and every
  Knowledge tab are one shape: `ContentArea variant="list"` bounds the body and the `DataTable`
  takes `stickyLayout`, so search, the create button, the column header row and the count footer
  hold their place while only the rows move. Both parts, every time; a short list hugs its rows
  instead of stretching. Tables embedded in a scrolling settings page are the exception and take
  neither.

## Dark mode

First-class, not an afterthought. Every colour resolves through a token that has a `.dark` value;
verify both themes on anything you touch. Dark uses **true neutral grays**. Never ship a colour that
won't theme.

## Docs follow the app

[`services/docs`](../../services/docs/) uses the **same app language and `@tale/ui`**. Both
documentation sites work the same way: the theme follows the reader's operating system until they
pick Light, Dark or System from the footer's theme switch, and that choice is saved. Use the same
components, tokens, and interaction conventions, and verify both light and dark appearances. Page _content_ rules live in the
[`write-docs`](../../.agents/skills/write-docs/SKILL.md) skill; this is only the visual layer.

Both documentation sites — `services/docs` and the `/docs/*` pages of `services/ui-docs` — render
**one frame**, the `@tale/ui/docs/*` family
([`packages/ui/src/components/docs/`](../../packages/ui/src/components/docs/)): the `SubPanel` rail
with the search trigger, the phone bar and drawer, the `h-13` header strip (breadcrumb trail whose
leaf is a plain marker, page actions on the right), the article (its single `h1`, description,
reading time, body, neighbour cards, edit link), the "On this page" outline, the footer and the
404. A site passes in its navigation tree, search index and copy; it never forks a piece of the
frame. The rail's logo row and the header strip are the same `h-13` box **border included**, so
their bottom borders meet as one line whether or not the strip holds buttons — never wrap a
fixed-height row in a bordered parent.

## Accessibility (app)

WCAG 2.1 AA. The recurring gaps and the token hierarchy are in
[`design/sources/accessibility-audit.md`](../sources/accessibility-audit.md): icon-only buttons need a real
`aria-label` (a tooltip is a _description_, not a name); form text descends label → description → hint →
error; every overlay traps focus and restores it on close; hit targets ≥ 24×24px.
