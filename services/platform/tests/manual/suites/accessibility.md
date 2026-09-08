# Accessibility (cross-cutting)

> **Prefix** `A11Y-` · **Reset** none · **Cost** 22 boxes

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
| DataTable page | `/dashboard/{org}/documents`               | `_knowledge` pathless segment → no `/knowledge/`   |
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
  top moves focus into `<main>`
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
  (status uses icon/text too)
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
  chat-input buttons) via `getBoundingClientRect()` → Every touch target is ≥
  **44×44 CSS px**. Cross-ref [responsive.md](responsive.md) RESP-A1, which
  already measured the mobile Save button at ≈38×32 px — treat that as a
  candidate finding, not a pass.

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
| Mobile shell                  |     |     |     |     | —   | —   |     |     |     | A11Y-A14 touch targets ≥ 44 px                                      |
| ~~Workspace panel~~ (retired) | —   | —   | —   | —   | —   | —   | —   | —   | —   | the chat side panel was removed in #2857; its guide is retired |
