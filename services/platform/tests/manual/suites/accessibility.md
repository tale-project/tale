# Accessibility (cross-cutting)

> **Prefix** `A11Y-` · **Reset** none · **Cost** 28 boxes

A WCAG 2.1 **Level AA** sweep across the whole app. Tale's standard (root
[`AGENTS.md`](../../../AGENTS.md) → Accessibility) is mandatory, not
aspirational. Per-area guides carry their own `A#` rows; this guide is the
holistic pass and the place to log _systemic_ findings. No `prerequisite`
feature flag — every surface below ships in the default stack.

## Scope & routes

Run each check on a representative set of surfaces. Each maps to a real route
file under `app/routes/dashboard/$id/**` (or `_auth/` for `/log-in`):

| Surface        | Route                                      | Notes                                              |
| -------------- | ------------------------------------------ | -------------------------------------------------- |
| Log-in         | `/log-in`                                  | unauthenticated; `_auth/log-in.tsx`                |
| Chat           | `/dashboard/{org}/chat`                    | live region during streaming (A11Y-A11)                 |
| DataTable page | `/dashboard/{org}/contacts`                | `<table>` (A11Y-A10)                                    |
| DataTable page | `/dashboard/{org}/documents`               | `_knowledge` pathless segment → no knowledge URL segment |
| Settings form  | `/dashboard/{org}/settings/account`        | labelled form fields (A11Y-A7)                          |
| Dialog         | any create/delete (e.g. agent or document) | focus trap + title (A11Y-A5/A11Y-A12)                        |
| Mobile shell   | resize ≤ 640 px on any of the above        | `BottomTabBar`; see [responsive.md](responsive.md) |

`{org}` is the 16+ char id in the dashboard URL.

## Preconditions

Bring the stack up and sign in per [SETUP.md](../setup.md). Drive the keyboard
checks with the keyboard only (no mouse). A screen reader (VoiceOver on macOS,
`Cmd+F5`) helps the announce checks (A11Y-A11/A11Y-A12). There is **no
axe dependency in the e2e suite** — full-page audits are manual/assisted here;
component-level axe coverage comes from `vitest-axe` via
`checkAccessibility()` and the Storybook a11y addon (see the coverage table).

> **Agent note**: assert structure against the live DOM, not a screenshot. One
> `<main>`, the skip link as first focusable, `<nav aria-label>`, table
> `scope`, and chat live regions are all queryable in a `page.evaluate` DOM
> scan. For A11Y-A11, the chat live regions only mount **during** a turn —
> type a message, click **Send message** (`chat.send`), and sample
> `[aria-live]`/`[role="status"]` mid-stream (~600 ms in); a turn is terminal
> when **Send message** re-enables.

## Functional / structural tests

- [ ] `A11Y-A1` · **Landmarks** — Load each surface; query `main, nav, header`
  → Exactly **one** `<main>` (`querySelectorAll('main').length === 1`); every
  `<nav>` has a non-empty `aria-label` (e.g. `Main navigation`, `Primary
  navigation`); one `<header>`
- [ ] `A11Y-A2` · **Skip link** — Load any surface; inspect first focusable
  element → First focusable is an `<a>` with `href="#main-content"` and text
  **Skip to main content** (`common.aria.skipToContent`); Tab→Enter from page
  top moves focus into `<main>`. Include the anonymous `/docs` API reference
  and `/2fa-enroll`: Enter stays on that page (the app is served under a
  `<base href>`, so a missing target used to resolve `#main-content` to the
  site root and land on `/log-in`) and focus moves into that page's `<main>`.
- [ ] `A11Y-A3` · **Keyboard reach** — Tab / Shift+Tab through chat + a
  DataTable + settings form; Enter/Space to activate → Every interactive
  control receives focus and activates from the keyboard; no control is
  reachable by mouse only.
- [ ] `A11Y-A4` · **Visible focus** — Tab through controls on each surface → A
  focus ring is visible on the focused control in both light and dark theme
  (ring contrast ≥ 3:1 against its adjacent background)
- [ ] `A11Y-A5` · **Focus return** — Open a dialog (create/delete); press
  `Esc` → Focus is trapped inside the open dialog; on close it returns to the
  triggering control (`document.activeElement` === the trigger)
- [ ] `A11Y-A20` · **Focus return from a row menu** — Keyboard only, on each
  table whose rows carry an actions menu (Settings → Connectors, AI providers,
  Members, Teams, API keys; Projects; Documents): open a dialog from a row
  menu item, then Escape or **Cancel** → Focus returns to that row's menu
  button (`document.activeElement` === it), never `<body>` — the menu item
  that opened the dialog is gone by then. A confirmed delete that removes the
  row is a separate case.
- [ ] `A11Y-A21` · **Focus after a confirmed row delete** — Keyboard only, with
  two rows and then with one, on Settings → Teams (**Delete**), API keys
  (**Revoke key**), Members (**Delete**), AI providers (**Delete**), Contacts
  (**Delete**), then WebDAV (the row's **Revoke**); confirm, wait for the row to
  leave, read `document.activeElement`, then press Tab → Focus is never
  `<body>`. With rows left, it is on the next row's menu button, or the row
  above when the last row left. With none, it is on the empty state's create
  action or the toolbar's. On WebDAV the revoked row stays and has no control:
  the next active row's **Revoke**, else the named **App-passwords** section.
  The next Tab stays in the main content, never at **Skip to main content**.
- [ ] `A11Y-A6` · **Icon buttons** — Query all `<button>` on each surface →
  **Zero** buttons have an empty accessible name — every icon-only button
  carries a translated `aria-label`/`title` (verified live: 0 unnamed on
  chat/agents/documents/settings)
- [ ] `A11Y-A7` · **Form labels** — `/dashboard/{org}/settings/account`; query
  inputs → Every visible `input/select/textarea` has a programmatic label
  (`label[for]`, wrapping `<label>`, or `aria-label`); on invalid submit the
  error is `role="alert"` and wired via `aria-describedby` +
  `aria-invalid="true"`
- [ ] `A11Y-A8` · **Contrast** — Sample body text, muted text, primary button
  on each surface (DevTools / contrast tool) → Body text ≥ 4.5:1; large text ≥
  3:1; non-text UI (borders, icons) ≥ 3:1; colour is never the only signal
  (status uses icon/text too). Include the chat sidebar's relative timestamps
  ("2m", "6d ago") in light theme, the inactive Board/List pill tab and the
  inbox tab count chips (muted text on the muted surface) → each ≥ 4.5:1; an
  axe `color-contrast` run over the chat and board pages reports no node.
- [ ] `A11Y-A9` · **Reduced motion** — OS _Reduce motion_ on (macOS: System
  Settings → Accessibility → Display); reload chat, send a turn → Chat segment
  reveal and route transitions present instantly (no fade/slide) under
  `prefers-reduced-motion: reduce`
- [ ] `A11Y-A10` · **Tables** — `/dashboard/{org}/contacts` + `/documents`;
  query the `<table>` → Every `<th>` has `scope="col"` (`TableHead` defaults
  it — live pre-rewrite: 8/8 documents — recount on the current tables);
  selected rows set `aria-selected="true"`; a `<caption>` (may be `sr-only`)
  is present **when the table is given one** (the `caption` prop on DataTable)
- [ ] `A11Y-A11` · **Live regions** — Chat: send a turn, sample mid-stream →
  During streaming a `role="status"` + `role="log"` region with
  `aria-live="polite"` is present and `aria-busy="true"` is set on the
  streaming node; idle = no spurious live region; toasts announce via
  `aria-live`
- [ ] `A11Y-A12` · **Dialog title** — Open any dialog → The dialog exposes an
  accessible name (visible heading or `VisuallyHidden` title) reachable as the
  dialog's `aria-labelledby`/`aria-label`
- [ ] `A11Y-A13` · **Heading order** — Walk headings top→bottom on each
  surface → Heading levels never skip (no `h1`→`h3`). NOTE: the adaptive
  header renders the page title as `<h1>` twice (visible desktop strip + a
  second copy for the mobile slot) — confirm only **one** is exposed to AT
  (the other is `aria-hidden`/visually removed); flag if both are announced.
- [ ] `A11Y-A14` · **Touch targets** — Resize ≤ 767 px; measure the mobile
  shell's interactive controls (bottom-tab buttons, mobile Save bar,
  chat-input buttons) via `getBoundingClientRect()` → Bottom-tab buttons are ≥ **44×44 CSS px**; other controls meet the app
  design contract’s **24×24 CSS px** minimum hit target. Measure the clickable
  area rather than the glyph. Standard 32/36 px controls are valid; do not
  report a WCAG 2.1 AA failure merely for missing the stronger 44 px target.
  Cross-ref [responsive.md](responsive.md) RESP-A1.
- [ ] `A11Y-A15` · **Export chat checkbox names** — In a chat with a reply
  longer than a screen, open **Export chat** (`chat.export.title`) and read the
  row checkboxes with a screen reader or the accessibility tree → Every row
  checkbox is named "You: …" / "Assistant: …" (`chat.export.you`,
  `chat.export.assistant`) followed by a short snippet of that message, never
  unnamed and never the whole reply.
- [ ] `A11Y-A16` · **Reaching the chat composer by keyboard** — On a desktop
  (mouse) browser open a new chat (`/chat?new=1`) → The message box
  (`chat.aria.chatInput`) holds the focus on load (not on a touch device, and
  not when opening an existing chat). Then from the top of any chat page press
  Tab: after **Skip to main content** (`common.aria.skipToContent`) the next
  stop is **Skip to message box** (`chat.aria.skipToComposer`); Enter lands the
  focus in the message box, past every sidebar row.
- [ ] `A11Y-A17` · **Team pickers and the PDF page box are named** — Open
  Documents → **Upload documents** → **From your device**, a row's **Assign
  team**, a project's **New project** and **Sharing** section, and a skill's
  **Team** visibility; read each team combobox in the accessibility tree →
  Its accessible name is the visible words above or beside it (**Assign to teams**
  `documents.upload.selectTeams`, **Team** `documents.teamTags.team`,
  `projects.create.audienceLabel`, `projects.settings.audience`,
  `skills.visibility.teamsLabel`), never unnamed; axe `aria-input-field-name`
  reports nothing. Preview a multi-page PDF → the page-number box is a
  spinbutton named **Page number** (`common.aria.pageNumber`).
- [ ] `A11Y-A18` · **Muted text meets AA** — In light mode open **Add
  website** and **Add product**; measure with axe `color-contrast` or a
  contrast picker → the inactive **URL list** segment reads ≥ 4.5:1 on its
  track and every **(optional)** label suffix (`common.optional`) reads
  ≥ 4.5:1 on the dialog; the suffix is the full muted colour, not a faded
  copy of it.
- [ ] `A11Y-A19` · **Filter panels by keyboard** — On a project's **Board**
  (`tasks.views.board`, `/dashboard/{org}/projects/{projectId}/tasks/board`)
  with a priority filter already set, so **Clear all** (`common.actions.clearAll`)
  shows, use the keyboard alone: Tab to **Filter** (`common.labels.filter`) and
  press Enter; press Enter on **Assignee** (`tasks.fields.assignee`), Tab into
  it, press ArrowDown twice, then End; press Shift+Tab, then Tab twice to reach
  **Priority** (`tasks.fields.priority`); press Enter, Tab, ArrowDown and Space,
  then Escape. Repeat on **Settings → Metrics → Projects**
  (`/dashboard/{org}/settings/metrics/projects`), whose **Period**
  (`metrics.period.label`) always holds a value → The panel opens with the
  focus on its first facet's header, not on **Clear all** and not left on
  **Filter**, and Tab stays inside the panel; a single-choice facet is one Tab
  stop (its chosen option, else its first) and its other options are out of the
  tab order; the arrow keys and End move the focus and the choice together,
  wrap at the ends, and the board narrows at once; Shift+Tab leaves the facet
  for its header, and Tab comes back to the chosen option; Space on the chosen
  option clears an optional facet and puts **Period** back to its default;
  every focused option shows its focus ring, whole at the list's edge; Escape
  closes the panel with the focus back on **Filter**. With a screen reader, each
  option is announced as a radio button with its checked state.

## Boundary & error tests

- [ ] `A11Y-B1` · **Account form invalid submit** —
  `/dashboard/{org}/settings/account`: clear a required field, blur/submit →
  An error message appears as `role="alert"`, the field gets
  `aria-invalid="true"` + `aria-describedby` pointing at it; focus is not
  lost. (Per repo policy, validation firing on first keystroke is already
  filed as #1943 — do NOT re-file.)
- [ ] `A11Y-B2` · **Chat error path live region** — Chat: send `e2e:error`;
  wait for **Send message** to re-enable → The provider-error UI renders and
  is announced (error sits in an `aria-live`/`role="alert"` region, not
  silent); page throws no console error.
- [ ] `A11Y-B3` · **Empty DataTable a11y** — A freshly-minted org's
  `/documents` (empty) → The empty state is reachable and announced (not a
  bare unlabelled region); the `<table>`/grid structure or empty message has
  an accessible name; no console/page error.
- [ ] `A11Y-B4` · **Skip link with no main focus** — `/log-in`: Tab once from
  page top, Enter → Focus moves to the main content target (`#main-content`)
  and does not get stranded on a `tabindex=-1` dead end.

## Performance

Targets are for **Mode A (deterministic mock gateway)** on the **local
self-hosted backend** (`http://127.0.0.1:3210`); a hosted/warm backend will be
faster. Measure with DevTools Performance / `performance.now()`.
- [ ] `A11Y-P1` · **Skip-link visibility on focus** → Skip link paints/becomes
  visible within 1 animation frame (~16 ms) of receiving focus — no layout
  jank.
- [ ] `A11Y-P2` · **Focus-ring paint on Tab** → Focus ring renders on the next
  focused control within ~100 ms of `Tab` (no perceptible lag)
- [ ] `A11Y-P3` · **Live-region announce latency (chat)** → The
  `role="status"`/`role="log"` region exists in the DOM before the first
  streamed token paints (≤ 600 ms after **Send message** click in Mode A) so
  AT announces from the start of the turn.
- [ ] `A11Y-P4` · **Reduced-motion transition cost** → With
  `prefers-reduced-motion: reduce`, route/chat transitions add 0 ms of
  animation time (instant)

## Per-surface sweep

Tick the checks that apply per surface (— = N/A for that surface).

| Surface                       | A11Y-A1  | A11Y-A2  | A11Y-A3  | A11Y-A6  | A11Y-A7  | A11Y-A10 | A11Y-A11 | A11Y-A12 | A11Y-A13 | Notes                                                          |
| ----------------------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | -------------------------------------------------------------- |
| `/log-in`                     |     |     |     |     |     | —   | —   |     |     | A11Y-B4 skip-link target                                            |
| Chat                          |     |     |     |     | —   | —   |     |     |     | A11Y-A11 live region while streaming                                |
| DataTable page                |     |     |     |     | —   |     | —   |     |     | A11Y-A10 scope ok; caption opt-in                                   |
| Settings form                 |     |     |     |     |     | —   | —   |     |     | A11Y-B1 invalid submit                                              |
| Dialog                        | —   | —   |     |     |     | —   | —   |     |     | A11Y-A5 focus return + A11Y-A12 title                                    |
| Mobile shell                  |     |     |     |     | —   | —   |     |     |     | A11Y-A14: tabs ≥44 px; other targets ≥24 px                                      |
| ~~Workspace panel~~ (retired) | —   | —   | —   | —   | —   | —   | —   | —   | —   | the chat side panel was removed in #2857; its guide is retired |
