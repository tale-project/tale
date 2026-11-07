# What the automated suites already own

Manual effort is expensive; spend it where a headless run cannot judge. Read
this before hand-verifying anything, and read the seam notes before running any
suite alongside the automated ones — they share one environment.

## The lanes

Run from the repository root with `bun run --filter @tale/session-manager <script>`. A red lane is a
failure of the gate, never a finding of a round.

| Lane | Script | What it proves |
|---|---|---|
| server | `test` | every route and its refusals, the flows over the HTTP API, the MCP endpoint and its 43 tools, proxy parsing and the exit-IP checks, the credential bridge, the vault, the store, the security checks, the runtime of a session (a window brought forward, a value typed, the tab the person last used, a start that comes to the front or, for an assistant, does not), identity and place, over fakes, with no browser and no network; the guards of how the service is put together (`tests/guards`: every error code worded in three languages, every setting documented, the tool lists, the sides of the tree, a route that waits for a read suspending only its own page) and the settings of the Playwright servers (`tests/e2e/*.test.ts`) |
| UI | `test:ui` | every component and hook in jsdom: names and roles, the words of `messages/*`, the three languages having the same keys (`lib/i18n/messages.test.ts`), the polling pace |
| real browser | `test:camoufox` | a real Camoufox, headless (no window), on local test pages through local test proxies and no internet: an identity that resolves to the same config on every launch, the pinned place and the position of the exit IP, tabs saved and reopened, keys, mouse, a value typed into the field that has the focus and nothing while no field has it, dialogs, a browser that is killed, the whole server with a real browser (HTTP API, MCP, stopping the server), the build being one whose mouse waits and whose `newPage` the app knows how to change, and the changed build taking the mouse on while a tab moves to another process (`juggler.camoufox.test.ts`) |
| Playwright e2e | `test:e2e` | the built page in Chromium against the real HTTP stack over a fake browser and a fake exit-IP checker, in parallel on one isolated server per worker (`tests/e2e/launcher.ts`, [below](#the-playwright-lane)); see the coverage map for what each spec holds. No real browser, and no window |

## Coverage map

One row per area. **Don't** re-verify an `automated` row by hand: a red there is
a spec failure and belongs in the gate, not in a round. The Playwright specs are
`tests/e2e/specs/<name>.spec.ts`.

| Area | Owning spec | Manual scope |
|---|---|---|
| Routes and addresses, the redirect from `/`, history, the rail, the panels, the tab bar, the pages for an unknown session and an unknown address, titles | `navigation.spec.ts`, `smoke.spec.ts` | `SMOKE-F1`, `SMOKE-F2`, `SMOKE-F3` as the first look at a real instance |
| The first paint of every address: the frame of the app the server sends before any script (the boot shell), its rail masked where the app then draws it, out of sight for the first 0.4 s; then the page in one go, a list with nothing in it on its empty state from the first frame, never masked rows or a toolbar that vanish | `first-paint.spec.ts` | — |
| Layout at every width, the phone layout and the breakpoint, horizontal overflow of pages and dialogs, the compact layout of the tables, the short window | `navigation.spec.ts`, and the "on a phone" groups of `sessions.spec.ts`, `window.spec.ts`, `proxies.spec.ts`, `secrets.spec.ts` | a real phone, zoom and text size: `RESP-F1`, `RESP-B1`, `RESP-F10`, `RESP-F11` |
| The keyboard: the skip link, the order of every page, the focus after a change, each dialog and menu | `navigation.spec.ts` and the "from the keyboard" groups of `sessions.spec.ts`, `proxies.spec.ts`, `secrets.spec.ts` | — |
| Accessibility audit of every page, state, dialog and menu in both themes with real contrast; landmarks and headings; the language of the document; visible focus; reduced motion; a state told by a word, not a colour | `a11y.spec.ts` | colour taken away, high contrast and a screen reader: `A11Y-A4`, `A11Y-A6`, `A11Y-A8`, `A11Y-A9`, `A11Y-A10`, `A11Y-A11`, `A11Y-A12` |
| Host and origin protection, a foreign site's writes and reads, the banners (the connection lost, the browser being installed, not installed, failed to install) and the refusals worded by the page | `navigation.spec.ts` | the real process: the install, the network and the data directory going away, `DEG-F1`, `DEG-F2`, `DEG-F3`, `DEG-F4`, `DEG-B6` |
| Sessions: the empty list, adding with and without a free proxy, names and their rules, rename, stop, start and restart, deleting, rotating the IP, checking the exit IP, a start that goes wrong, a browser that dies, a proxy that stops working, the shared exit IP, the export, a list longer than a page, a list that follows the backend, a list that cannot be loaded | `sessions.spec.ts` | the real start and the look of the list, a list of 120, a rotation that keeps logins, the rhythm of the requests, stopping the manager: `SESS-F3`, `SESS-F5`, `SESS-P1`, `SESS-F14`, `SESS-P2`, `SESS-B4` |
| The page of a running session over a fake browser: the window card, Show window from the card and from the menus of the row and the header, the window a start from the page brings up and the one an assistant's start leaves alone, the secrets of the session and a value typed from them, the refusals of both and their toasts, the exit IP and the place | `window.spec.ts`, `sessions.spec.ts` (the header and the details), their audit in `a11y.spec.ts`, and `backend/main.camoufox.test.ts` for a real browser, headless, on a test page | the windows themselves on a Mac, which no lane sees: every `WIN-` box |
| Proxies: every accepted form and refusal, the import and its report, health, the session of a proxy, deleting, the counts, search, 700 rows, the keyboard, that no password is on the page, failing requests, a table out of date | `proxies.spec.ts` | a thousand rows while a thousand checks run, the network's own words, the manager's log: `PROXY-P1`, `PROXY-P2`, `PROXY-P3`, `PROXY-P4`, `PROXY-F8`, `PROXY-F13` |
| Secrets: the four kinds and their fields, the form and its limits, masking by label and by card number, reveal and hide, changing, scope, narrowing, search, details, delete, failing requests, 60 secrets | `secrets.spec.ts` | the real clipboard, three browsers, devtools storage, 500 secrets: `SECRET-F3`, `SECRET-F13`, `SECRET-F14`, `SECRET-P1` |
| Settings: the start page and its draft, leaving with unsaved changes, About, the AI access switch, the endpoint obeying it, the snippets and their copy buttons, the five groups of tools, the theme, the language, the language of a first visit, the title of the tab | `settings.spec.ts` | the app read by a native speaker, real assistants on `/mcp`: `SET-F9`, `SET-F14`, `SET-F15`, `SET-F16`, `SET-F17`, `SET-F18`, `SET-F20`, `SET-B2`, `SET-F22` |
| What a real Camoufox does with an identity, a place, tabs, typed text and input, dialogs, and a kill | `backend/**/*.camoufox.test.ts` (the real-browser lane) | whether a fingerprint test, a leak test and a real site accept it: every `REAL-` box |
| Degraded modes of a real install, network or disk: no GeoIP database, no add-on, a foreign database, a taken port, a manager killed | — | **manual-only** — they need a real process, a real install and a real network: `DEG-B1`, `DEG-B2`, `DEG-B3`, `DEG-B4`, `DEG-B5`, `DEG-F6` |

Legend: a named spec owns the row end to end · a named spec **plus** a manual
scope is partial · `—` is manual-only.

## Seams

Anything that makes an automated run and a manual round interfere. Name it here,
and name the direction: which one destroys the other's state, and what the
survivor looks like when it happens.

- **`bun run test:e2e` empties its own managers before every spec**, boots one server per worker
  (four by default, from `E2E_BACKEND_PORT`: 3204 to 3207, their control servers on 4204 to 4207;
  `E2E_WORKERS=1` boots one) and, unless the page is built already, **rebuilds `dist/`**, emptying it
  first: never run it beside a round served from the same checkout (or build the page elsewhere and set
  `E2E_DIST_DIR`, which builds nothing and leaves `dist/` alone, as `E2E_USE_BUILD=1` does for a `dist/`
  that is built); give it another port range (`E2E_BACKEND_PORT=3260` takes 3260 to 3263 and 4260 to
  4263) and run it before or after a round. Reset before resuming.
- **`test:camoufox` has timing assertions** (the wait of a slow page) and runs on a browser build you
  installed (`CAMOUFOX_INSTALL_DIR`; the README puts one in `.camoufox-tests`, ignored by git): keep it
  away from a round on the same machine, and never point a round at that directory for the boxes that
  delete files from an install (`DEG-B1`, `DEG-B2`): use a copy.
- **Ports of the fakes are shared state.** A server that answers on a port you did not start is
  someone else's: check the PID with `lsof -nP -iTCP:{port} -sTCP:LISTEN` before you send it anything.

## The Playwright lane

How `test:e2e` runs, so that nobody drives a round into it by accident (the settings are in
[the README's table](../../../README.md#test-and-develop)):

- **One isolated server per worker.** `playwright.config.ts` starts `tests/e2e/launcher.ts`, which runs
  the servers of every worker in a single process: server `i` serves the built page, the API and `/mcp`
  on `E2E_BACKEND_PORT + i` over a fake browser and a fake exit-IP checker, with a throw-away data
  directory, and its control server on `E2E_CONTROL_PORT + i`. Worker `i` talks to
  server `i` only, so specs run in parallel (`fullyParallel`) with no shared state. One such server alone
  is `bun tests/e2e/server.ts`, which is stack A of [`setup.md`](../setup.md).
- **Fixtures.** Every spec imports `test` and `expect` from `tests/e2e/helpers/fixtures.ts`. `server` is
  the worker's server (`index`, `port`, `controlPort`, `origin`, `controlUrl`): a spec never computes a port.
  `api` sets a scene up through the manager's API and empties the server before each spec, `control` is
  the client of the control server (faults, scripted exit IPs, what the fake browser was told). Specs name
  controls by role and `t('topic.key')` from `messages/en`, and wait on state, never on time. No spec is
  parked with `test.fixme`: a spec that finds a bug is enabled with its fix, and a gap that is the shared
  library's is listed as a follow-up, not skipped.
- **In CI** the job "Playwright (session-manager)" restores the built page (`E2E_USE_BUILD=1`), runs
  with the default worker count (four, or the cores if fewer) and has 25 minutes.

## Moving a box here

When a spec takes a box over end to end, **delete the box and add its row here
in the same commit**, naming the spec. A box that survives its automation is
manual effort spent twice; a row that names a deleted spec is worse, so
`bun run lint:manual` rejects a box ID here that no suite defines.
