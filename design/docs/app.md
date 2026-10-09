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
pill, the view switcher, the open row of every panel list — measured with `useSlidingIndicator`,
drawn by `SlidingHighlight` and moved by a CSS transform on one shared timing, since the app loads the
lean animation bundle); with nothing open it fades out where it stood and lands on the next item with
a fade, never sliding in from a corner. A row that joins an open list drops into place; new badges
and unread dots pop in once; a list swapped for another fades in; another item opening in the same
place fades its view in (`useSwapFade`, opacity only, so nothing the view measures moves); every
motion honours `prefers-reduced-motion`.

## Shell & layout

Three levels, the same in every section: the **rail** says where you are, a **section panel** says
what is there, and the page shows the one thing you opened.

- **Rail** — a permanent 52px column of Lucide icon targets holding the sections: **Home**,
  **Knowledge**, **Automations**, and at its foot **Settings**, notifications and the account. The
  active section sits on one pill that glides from tile to tile (never two fills blinking); inactive
  tiles are muted; each shows a no-arrow tooltip to its right. Built from `@tale/ui` primitives, not a
  bespoke layout. A phone shows the same sections, from the same list, inside a floating, fully rounded bottom capsule. Its lightly translucent surface contains both icons and labels; one selected background glides between destinations. Scroll content continues behind it, with end clearance for the last item. Composers and page-action docks sit above it. The capsule is 60px tall with 20px icons and 11px labels. Downward scrolling reduces it to a 52px icon-only capsule, at most 280px wide and 4px lower; upward scrolling restores it. Both states keep 44px touch targets, accessible names and stable content clearance. The capsule hides while the software keyboard is open and returns when it closes.
  A tile always opens its section's overview — Home a new chat (on a phone, the Home list),
  Knowledge its first tab, Automations the list, Settings its first row (Account) — never the place you
  left, also when you are already in that section. The page's section decides the lit tile and its
  `aria-current="page"`: an automation opened inside a project belongs to Automations.
- **Section panels** — a section with navigation of its own opens it in a panel beside the page,
  one frame for all of them: `SubPanel width="list"` (280px by default, full height, right border), a
  `SubPanelHeader` naming the section in the same `h-13` row as a page header (border included, so
  the two rules meet as one line), then rows. Fixed pages are icon rows with a highlight that glides
  to the open page (`SectionNavPanel` — Settings). **Home** lists your work and needs no header
  naming it: its panel opens straight on the view switcher, **New chat** beside it. **Knowledge and
  Automations have no panel**: Knowledge's pages are a tab strip under its header, and an
  automation's canvas is a workbench that needs the full width.
- **Home** — chats, the tasks assigned to you or waiting on your review, and the inbox's customer
  conversations in **one list**. A pill switcher narrows it (All · Chats · Tasks · Inbox; each option
  sized to its label, so a long German or French label keeps its word), **New chat** beside it; Projects
  sit above the list as doors to their pages and as drop targets for filing chats; the list bands
  by time (Pinned, Today, Yesterday, Previous 7 days, Earlier). Every row has one anatomy: a 20px
  glyph that says what the item is (chat bubble, task status, contact initials), the title, a
  compact age, and a line of context (project, task key and status, contact and preview), with the
  accent unread dot in the same place for every kind; an item whose composer holds unsent text says
  **Draft** on its context line. The Inbox view adds the status switch, search, facets and
  multi-select with bulk verbs. The panel stays mounted across every Home route; on a phone it is the
  Home screen itself. On desktop its right edge resizes the panel from 280px to 480px, with
  Left/Right keys on the focused divider; the browser remembers the width per organization. From the keyboard, ⌘\ folds it, ⌥↑/⌥↓ open the previous or next item of the
  list on screen from anywhere but a text field, and ↑/↓ move between a list's rows.
- **Header** — per-page title row (`h-13`, `text-base` semibold `h1`) that always ends in exactly
  **one** `border-border` line: the tab strip's own `border-b` when a tab row follows (Knowledge,
  project and automation detail), otherwise the header's own bottom border (`AdaptiveHeaderRoot showBorder`),
  drawn inside the `h-13` box so it meets a section panel's header line without a step.
  Beside a section panel, the page header names the open page (the panel already names the
  section). Icon buttons are 32×32, 8px radius, hover fill.
- **Conversation pages** — a chat, a task and a customer conversation open in one frame:
  `ThreadHeader` (the Home panel toggle, a 32px identity mark, the title, one quiet line of context,
  then the actions), a centred reading column, and the composer pinned at the foot in the same frame
  for all three (`THREAD_COMPOSER_FRAME_CLASS`, `@tale/ui/thread/layout`). A task is a structured chat: its brief (description,
  files, subtasks) opens the thread as a card, comments and history follow oldest first under day
  pills (one `ThreadDayDivider`, pinned while its day scrolls by, shared by chats, tasks and the
  inbox), and its structure (status, owner, dates…) lives in a details panel that folds away. The
  actions a teammate needs lead: **Copy link** on a task and a conversation, and a task's key copies
  itself from the header. On a phone the page keeps its own header row only — no shell bar above it.
  The board's task dialog carries the same identity in its own header — the status glyph tile, the
  title and one quiet line of project · key · status — and its chrome actions sit in one cluster at
  the top-right before Close (`ResponsiveDialogContent headerActions`): **Copy link** and **Open as
  page**, a real link to the task's page. The drawer on a phone shows the same cluster in its own band.
  Creating a task reads like the open task: the status tile and a borderless title in the header, the
  property panel beside the description (Medium priority and today's start preselected), and a footer
  with **Create another** at the left and the `⌘ Enter` hint beside Cancel and Create.
  On the board, **Done** and **Cancelled** fold to a 44px rail (glyph, count, the name standing on
  end) that opens on a click and still takes a drop; each board remembers its folded lanes.
- **Avatars** — one `@tale/ui/avatar` everywhere: a person's initials in the tint their name hashes to (the
  same colour on a board card, in a task's conversation and in a contact list; filled primary for "you"), an
  agent's bot on the soft primary tint, an automation's workflow glyph, a dashed outline for nobody.
  `AssigneeAvatar` and `ContactInitials` are thin wrappers over it.
- **A task reads the same everywhere** — the board's dialog and the task's page render one reading
  column (`TaskThreadColumn`): the brief as a card, the conversation (comments and history merged, oldest
  first, opening on the discussion's newest page and anchored at the newest end) and the chat composer
  pinned under it; the dialog adds only its header and the details panel beside it. There is no separate
  comment list or Activity list.
- **Conversation entries** — one anatomy for chats and task discussions, built from `@tale/ui/thread/*`:
  the viewer's own words as a right-aligned muted bubble (`ThreadMessage variant="own"` — a chat's turns
  and a task's comments alike, with the time and actions revealed under it and a chat's ‹ 2/3 › branch
  navigator always in view beside them as its `trailing` control); every other
  voice — a teammate, an agent, the assistant — as flat prose under an identity row (24px avatar, name,
  an **Agent** badge for an agent, clock time; the chat's assistant hides the row), with a message by the
  same author minutes later joining the one before it; actions as icon buttons that show on hover,
  keyboard focus, an open menu and always on a touch screen. Events are one quiet `text-xs` line in the
  avatar gutter with a glyph per kind of change, the change in its own words and casing; three or more
  in a row fold into one line ("5 updates") that opens in place. A long body is clamped behind
  **Read more** (`ReadMore`), never truncated in the DOM.
- **Detail pages** — the header is a breadcrumb trail (`HeaderBreadcrumbs`: semantic `nav > ol`, the
  leaf is the page's only `h1`). When the entity has siblings, the leaf is the shared
  `HeaderBreadcrumbSwitcher` (name + chevron opening a titled, searchable list) — projects and
  automations use the same primitive. A tab strip (`TabNavigation`) follows the trail, and the page's
  verbs — Save/Discard and any entity actions — sit in the strip's trailing slot
  (`AdaptiveHeaderTabActionsSlot`), never in the title row's right half; the title row keeps only
  the name and its identity badges (archived, live). Run/sub-pages keep a plain leaf, keep the strip
  with the parent tab lit, and link the entity name back up the trail. An automation opened inside a
  project starts its trail with the project: `<project> / Automations / <name>`, the crumbs leading
  to the project and to its Automations tab.
- **Right/secondary panels** (the Home panel, a task's details) slide in and **resize the main
  column** rather than overlay it; main content re-flows to the remaining width.
- **Main column is centred and width-capped** — e.g. chat is 558px (new) / 768px (conversation). Don't
  let product content run full-bleed. The one exception is a workbench: an automation's **Editor**
  tab runs its canvas edge to edge, with the node inspector flush against it as a bordered side
  panel — like a design tool, not a card in an inset. Its settings (trigger, projects) are a
  separate **General** tab on the settings measure.

## The big surfaces (pointers)

- **Chat** — centred input that auto-grows (72→200px then scrolls), send button appears only with
  content, agent selector dropdown above the input, streaming response with a blinking cursor + stop
  button, the **thinking timeline** (collapsed-by-default, user-controlled — never auto-expand it),
  rich-text/markdown answers, message hover actions. Specs: `design-system.md` → _Chat_, _Dev Notes_.
- **Conversations** (inbox) — listed in the Home panel's Inbox view (status switch, search, facets,
  bulk-action bar); the reading pane takes the page, with a Gmail-style reply composer and an
  "improve with AI" rewrite. Specs: `design-system.md` → _Conversations_.
- **Knowledge** — its pages (Documents/Knowledge entries/Websites/Products/Contacts) as a tab strip
  under the header, each a `DataTable`. Specs: `design-system.md` → _Knowledge_.
- **Automation canvas** — the layout engine places every box, nobody does: **Start** on top (what
  starts a run, what it receives), **End** at the bottom (what it returns, how a run ends), each node
  below the nodes it reads. A condition is a pill in words above its node, splitting into **Yes**
  (left) and **No** (right) when the node has an alternative; a frame means for-each or repeat; a
  solid line reads output, a dashed one only orders, a dotted one ends the run; a dashed box may not
  run. One Tab stop with arrow keys, a List view as the text alternative, the Paths list to light up
  a path. Build it from data with `@tale/ui/flow/workflow-canvas`; never draw a node by hand. Guides:
  [`workflow-canvas.md`](../../services/ui-docs/content/components/workflow-canvas.md),
  [`workflow-paths.md`](../../services/ui-docs/content/components/workflow-paths.md),
  [`workflow-playback.md`](../../services/ui-docs/content/components/workflow-playback.md).
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
  neither. A short viewport (`short-viewport:`, under 30rem — a phone held sideways, a laptop at
  200 %) lifts the bound: the frame grows with its rows, the page scrolls, page headers stop
  sticking, and the embedding banner keeps to its title and link.
- **Layout answers to its column, not the window** — viewport breakpoints (`sm`, `md`, `lg`)
  decide the shell only: rail or tab bar, a panel or not. Beside the rail and a section panel a
  page column is ~400px on a 768px window and ~660px on a 1024px one, so whatever a page lays out
  switches on its own width: a size container (`@container`; a `FIELD_LAYOUT_ROW` surface is the
  `field-layout` container its field rows turn on at 36rem; a `ThreadHeader` is the
  `thread-header` container its action labels answer to; `StatCardGrid`, `CardGrid`) or a row
  that wraps (`DataTableToolbar` moves its action to a line of its own; a thread header's context
  line drops whole items, least important last, instead of truncating each). Nothing is pushed
  past the edge: a row out of room wraps or stacks, its flexible part yields first, and a
  positioned descendant of a scrollport stays inside it (a scrollport is `relative`). Pages
  outside the shell scroll themselves (`STANDALONE_PAGE`) — the platform clips the document.

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

The reading frame uses a quiet tinted rail, fine border rules and a width-capped article. A
larger, medium-weight title leads into a generous description and compact reading metadata;
one hairline separates this introduction from the body. Search has a lightly raised surface,
while active navigation keeps the shared sub-panel treatment. Previous/next cards show their
full page titles and move only their arrows on hover or keyboard focus; reduced motion keeps
them still. Phone menu, search, navigation rows and the outline disclosure provide 44px touch
targets, long labels wrap, and the footer wraps to its available column width. The app's global
tokens remain authoritative; neither documentation service supplies a parallel visual theme.

## Accessibility (app)

WCAG 2.1 AA. The recurring gaps and the token hierarchy are in
[`design/sources/accessibility-audit.md`](../sources/accessibility-audit.md): icon-only buttons need a real
`aria-label` (a tooltip is a _description_, not a name); form text descends label → description → hint →
error; every overlay traps focus and restores it on close; hit targets ≥ 24×24px.
