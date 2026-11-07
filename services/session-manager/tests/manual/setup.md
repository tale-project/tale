# Setup for a manual round

Everything that has to be in place before the first box: the toolchain, the stack (a fake
browser for the quick passes, the real one for the rest), the control server that provokes
states, and the things that silently invalidate a whole pass. The suites themselves sit in
[`suites/`](suites). The service README is the oracle for what the app does:
[`../../README.md`](../../README.md).

## Prerequisites

| Need | Get it |
|---|---|
| **Toolchain** | Bun 1.4.2, the version the root `package.json` pins. `bun install --frozen-lockfile` at the repo root once. |
| **The built page** | `bun run --filter @tale/session-manager build` once, and again after a change under `app/`, `lib/` or `messages/`: `dist/` is what both stacks serve, and a stale one is the usual reason a round judges old code. |
| **Chromium for scripts** | `bunx playwright install chromium` once. The e2e lane and every chauffeur script need it; a person uses the browser they like (Chrome, Firefox and Safari all matter, see the round record). |
| **A viewport** | 1440×900 is the default; responsive boxes name their own (390 px is the phone, 768 px the tablet). |
| **For a real round: the Camoufox build** | About 1.3 GB, build `152.0.4-beta.30`. Install it once into a directory of your own: `CAMOUFOX_INSTALL_DIR=<dir> bunx camoufox-js fetch` from `services/session-manager`, or point the variable at an install that exists (the folder `services/session-manager/.camoufox-tests`, ignored by git, is where the README installs the one the real-browser lane runs on). Never another program's cache: the build in use is recorded in a `config.json` there. |
| **For a real round: proxies** | See [Proxies for a real round](#proxies-for-a-real-round). |
| **For a real round: the internet** | Proxy checks ask exit-IP services through the proxy, and the first launch downloads the uBlock Origin add-on. [`degraded-modes.md`](suites/degraded-modes.md) says what happens without it. |
| **For a real round: a Mac with a screen** | Each session's browser opens a window on the desktop of the computer the manager runs on, and macOS is what the app is made on: run stack B at that computer, never over SSH or without a display. [`windows.md`](suites/windows.md) judges the windows; elsewhere the system decides about them ([`not-a-finding.md`](reference/not-a-finding.md)). |
| **Tools some boxes name** | `curl`, `lsof`, `sqlite3`, `lsappinfo` (macOS: which app is in front), a screen recorder that can do 60 frames per second, devtools. Optional: a Claude Code installation for [`settings.md`](suites/settings.md). |

## Baseline

A round is only honest about a tree whose gates were green **before** it started. Run these on
an untouched checkout and note the results in the [session log](runs/template-session-log.md);
anything already red is environment, not a finding.

| Gate | Command | From |
|---|---|---|
| the whole check | `bun run check` | repo root |
| types, lint, server and UI tests of this service | `bun run --filter @tale/session-manager typecheck`, `lint`, `test`, `test:ui` | repo root |
| the page in a browser, against the fakes | `bun run --filter @tale/session-manager test:e2e` (four servers: run it on its own port range, see [Reset choreography](#reset-choreography)) | repo root |
| the real browser lane (before a real round) | `CAMOUFOX_INSTALL_DIR=<dir> bun run --filter @tale/session-manager test:camoufox` | repo root |
| the links the service README holds | `bun run lint:links` | repo root |
| the manual layer's own shape | `bun run lint:manual` | repo root |

## Starting the stack

Three ways to run the app. Every suite header names the one it needs.

### A. The fake backend (no browser, no internet)

The real HTTP stack (the page, the API, `/mcp`) over a fake browser and a fake exit-IP checker, on a
throw-away data directory. This is the stack the e2e lane tests, and the quickest one for a human: a
session starts in under a second, so the interesting states need the
[control server](#the-control-server) to slow them down.

```bash
cd services/session-manager
E2E_BACKEND_PORT=3204 bun tests/e2e/server.ts
```

It prints `[session-manager] listening on :3204` and `[e2e] backend on :3204, control on :4204,
data in <a temp directory>`. Open **http://localhost:3204**. A session starts after 400 ms, a
proxy check takes 150 ms, a proxy `a.b.c.d` exits through `203.0.113.d` in Germany, and a running
session has no window: its page shows the card all the same, and what Show window and Type did is
read from the [control server](#the-control-server) (the fake's tabs are titled "Title of
<address>"). The data directory is deleted when the process ends (SIGINT or SIGTERM).

`E2E_BACKEND_PORT=3204` is also where `bun run dev` puts its backend, so run the fake on another
port beside a dev server, or beside someone else's round: any port pair works (`3215` gives
control port `4215`). It serves `dist/` (the built page, see [Prerequisites](#prerequisites)); a page
built elsewhere, which leaves `dist/` alone, is served with `E2E_DIST_DIR=<dir>`, and
`bunx --bun vite build --outDir <dir>` in the service folder makes one. Wait for the rail
(`navigation.aria.main`) to render before continuing; on a phone it is the tab bar.

### B. The real browser

The app as a person runs it, with a data directory made for the round, at the Mac whose screen the
sessions' windows open on (see [Prerequisites](#prerequisites)).

```bash
cd services/session-manager
bun run build
mkdir -p /tmp/session-manager-qa/data
PORT=3004 SESSION_MANAGER_DATA_DIR=/tmp/session-manager-qa/data \
  CAMOUFOX_INSTALL_DIR=<dir with the browser> bun run start
```

Open **http://127.0.0.1:3004** (or `localhost`). Never use the default `./data` or any data
directory that holds somebody's real work for a round: a round deletes its data directory at every
reset. If the install directory has no browser, the app starts the 1.3 GB
download itself and the page says so; [`degraded-modes.md`](suites/degraded-modes.md) uses
exactly that.

### C. The development server

`bun run --filter @tale/session-manager dev` (Vite on 3004, the backend on 3204) is for judging
what only exists in development, such as the console of a dev build. Do not judge performance on
it. If 3004 is taken, Vite does not start and says the port is in use: free 3004 first.

### Which stack for which suite

| Suite | Stack |
|---|---|
| [smoke](suites/smoke.md) | B for the chain; A for a quick pass |
| [sessions](suites/sessions.md) | B; A for `SESS-P1` |
| [windows](suites/windows.md) | B, on a Mac |
| [proxies](suites/proxies.md) | A for the table of 1000 rows and the failures; B for the network's own words |
| [secrets](suites/secrets.md) | A or B |
| [settings](suites/settings.md) | A, or B for the assistants (a real session to work in) |
| [responsive-a11y](suites/responsive-a11y.md) | A |
| [real-browser-realism](suites/real-browser-realism.md) | B only |
| [degraded-modes](suites/degraded-modes.md) | B; A where a box says so |

## The control server

Stack A starts a second, tiny HTTP server on `127.0.0.1` (the backend's port + 1000, or
`E2E_CONTROL_PORT`) that reaches into the fakes. A session is addressed by its **name**. It is
for whoever drives a round: nothing in the page uses it.

```bash
C=http://127.0.0.1:4204
curl -s $C/browsers/0001                          # what the fake browser of session 0001 was told, its tabs, its open dialogs
curl -s -X POST $C/browsers/0001/dialog -d '{"kind":"confirm","message":"Delete everything?"}'   # alert, confirm, prompt, beforeunload
curl -s -X POST $C/browsers/0001/focus -d '{"field":false}'   # no field of the window has the focus: Type is refused; true puts it back
curl -s -X POST $C/browsers/0001/crash            # the browser dies, as if its process was killed
curl -s -X POST $C/browsers/0001/close-tabs       # the person closes every tab
curl -s -X PUT  $C/faults -d '{"launchDelayMs":8000,"checkDelayMs":3000}'      # slow starts and checks: see every state
curl -s -X PUT  $C/faults -d '{"launchError":"The browser could not start"}'   # the next launches fail; null withdraws
curl -s -X PUT  $C/faults -d '{"identityError":"No fingerprint fits"}'         # adding a session fails: fingerprint_exhausted
curl -s -X PUT  $C/exit-ips -d '{"203.0.113.11:8080":{"ip":"203.0.113.99","country":"DE"}}'   # the proxy now exits elsewhere
curl -s -X PUT  $C/exit-ips -d '{"203.0.113.11:8080":{"error":"connection refused"}}'         # the proxy no longer works
curl -s -X DELETE $C/state                        # withdraw every fault and scripted answer
```

`DELETE /state` withdraws faults and scripted exit IPs; it does not empty the manager's data.
`GET /browsers/<name>` lists `events` as the fake browser received them (`["toFront"]` for a window
brought forward, `["text","…"]` for a value typed, `["key","press","Enter"]`, `["goto",url,…]`),
the quickest way to judge what the page or an assistant sent: on stack A there is no window to look
at.

## Reset choreography

The single source of truth: every "reset" elsewhere in these files means exactly this.

1. **Reset only at the boundaries the suites name.** A reset in the middle of an ordered suite
   destroys the state its later boxes consume.
2. **Stack A:** stop the process with Ctrl+C or `kill <the PID you started>`, and start it again.
   Its data directory is deleted at exit, so sessions, proxies, secrets and settings are gone and
   the fakes start fresh.
3. **Stack B:** stop the app with Ctrl+C (the windows close, the tabs are saved), delete the
   round's data directory (`rm -rf /tmp/session-manager-qa/data`, the one you made, never another),
   and start again. Keep `CAMOUFOX_INSTALL_DIR`: it holds the 1.3 GB.
4. **A reset wipes everything, secrets included.** An open page shows the red connection banner
   while the server is down, then an empty manager; that bounce is not a defect. The theme and the
   language live in the browser, not in the data directory: clear the site's data (devtools,
   Application) to reset those too.
5. **The automated lanes reset too.** `test:e2e` empties its own managers before every spec and
   boots one server per worker from `E2E_BACKEND_PORT` (3204 to 3207 with the default four workers,
   their control servers on 4204 to 4207): never run it beside a round on those ports
   (`E2E_BACKEND_PORT=3260 bun run --filter @tale/session-manager test:e2e` gives it 3260 to 3263;
   `E2E_WORKERS=1` boots one). Unless the page is built already it also rebuilds `dist/`, emptying it
   first, which a round served from the same checkout is standing on: run it before or after a round,
   not during (or set `E2E_DIST_DIR` to a page built elsewhere, or `E2E_USE_BUILD=1` for a `dist/` that
   is built already: both build nothing). `test:camoufox` has timing assertions: keep it away from a
   round on the same machine.
6. **Exactly one writer at a time.** A page in two windows is two readers of one writer. A
   connected AI assistant is a writer: switch AI access off before a box that is not about it, and
   say in the log when it was on. A second manager on the same data directory is a second writer:
   never. Before you trust what you see, check that the PID that listens on your port is the one you
   started (`lsof -nP -iTCP:3004 -sTCP:LISTEN`): a server of another checkout on the same port
   answers too, and a second server on a taken port fails with `EADDRINUSE`.
7. **Stop only what you started.** Kill a server by the PID you started (`$!` of the command that
   launched it). `pkill`, `killall` and any pattern kill other people's servers and browsers.

## Proxies for a real round

A real session needs a proxy that reaches the internet and an exit IP of its own. Any of these
works; say which in the log.

- **Your own proxies**, from a provider: the best, and the only way to judge health wording and
  the credential bridge for real. Two or three with distinct exit IPs, in different countries for
  [`real-browser-realism.md`](suites/real-browser-realism.md).
- **A SOCKS5 tunnel to a machine you control**: `ssh -N -D 1080 user@host` gives a proxy
  `socks5://127.0.0.1:1080` with no credentials that exits through that host.
- **A forward proxy on this computer** (tinyproxy, squid, mitmproxy) exits through your own IP.
  That is fine for typing, scrolling and tabs, but two of them share one exit IP, so the second
  session asks `Start anyway` in the dialog "Same exit IP as another session". Put basic
  authentication on one of them to reach the credential bridge.

## Accounts

None: the app has no login. A box that signs in to an external site uses a throw-away account you
made for the round; say so in the log and never write its password anywhere in the repository.

| Account | Role | Used by |
|---|---|---|
| a throw-away account on any site with a login form | none | [`windows.md`](suites/windows.md), [`real-browser-realism.md`](suites/real-browser-realism.md) |

## Chauffeur scripts

A box a script can drive says so in its agent note. Keep such scripts, their screenshots and their
console transcripts outside the repository, in the round's evidence folder
(`/tmp/session-manager-qa/r<nnnn>/`), and drive stack A with Playwright's Chromium. The layer's one
optional slot for an authoring aid, `tests/manual/scripts/`, is unused.

## Clean room

When the working clone is busy (a dev server on the port, a half-applied change, uncommitted
edits), take a clean room instead of judging a tree you cannot describe: a fresh clone at the SHA
under test, its own install, its own stack. The round record names the SHA either way.
