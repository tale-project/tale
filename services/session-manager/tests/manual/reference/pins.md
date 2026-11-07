# Why a box says that

Each row below is an expectation a suite carries **because something once went
wrong**, or because a mechanism makes it exactly that. The box itself states only
the check, so it stays readable; the reason lives here.

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

## smoke

| Box | What it pins |
|---|---|
| `SMOKE-F1` | The redirect from `/` replaces the history entry, so Back from `/sessions` does not land on `/` and bounce straight back. Held by `tests/e2e/specs/navigation.spec.ts`. |
| `SMOKE-F3` | `docs`: an earlier draft expected the router's bare "Not Found" for `/nope`; the app has its own page now (`navigation.notFound.*`), while an id that names no session is the session page's own "gone" state, a `404` the page words. |
| `SMOKE-F10` | On stack A there is no window: Show window is judged by what the fake browser was told (`GET {control}/browsers/{name}`, `["toFront"]`), never by the screen. |
| `SMOKE-F13` | `ai_access_off` is answered before the method or the body are looked at, so an empty `{}` is enough, and the switch is read on every request, not at start (`backend/domains/mcp/server.ts`, held by `server.test.ts`). |

## sessions

| Box | What it pins |
|---|---|
| `SESS-F3` | The header, the card and the row read one catalog (`sessions.status.*`) through one mapping (`app/features/sessions/lib/status.ts`), so the three can only differ if that mapping is bypassed. |
| `SESS-F5` | The second line of a row is built in `use-second-line.ts` and drawn on one line, cut with an ellipsis, its whole text the row's tooltip; the Start/Stop and menu buttons that appear on hover (always, below 768 px and on a touch screen) sit on a backing over its end (`session-row.tsx`, `BL-11`). The tone is the message: amber with a warning sign for a changed exit IP, red for a failure, the muted colour otherwise. |
| `SESS-P2` | Polling pace lives in `app/lib/polling.ts`: 1.5 s while a session is busy, a proxy is being checked or the browser is being installed, 5 s otherwise, 5, 10, 20 then 30 s while the manager does not answer. Held by `app/lib/polling.test.ts`. |
| `SESS-B4` | Bun's `server.stop()` without `true` waits for every open connection, and an AI assistant's tool can keep one open for up to two minutes: awaited first, it would keep the browsers (and their tabs, saved as they close) from closing. `stop()` refuses new connections, closes the browsers, then cuts what is left (`backend/main.ts`, held by `backend/main.test.ts`, "stops: the port is released and the browsers are closed"). A stop that still hangs is ended after `SHUTDOWN_TIMEOUT_MS` plus ten seconds with exit code 1, and a second signal exits at once (130, 143 or 129 by the signal): `backend/shutdown.ts`, held by `shutdown.test.ts`. |
| `SESS-F14` | Rotate restarts the same profile directory with another proxy, so cookies and logins survive; only the place and the exit IP change. |

## windows

| Box | What it pins |
|---|---|
| `WIN-F1` | A session's window is as large as its fingerprint says, and the fingerprint's screen is at most the largest display of this Mac (`largestDisplay` in `window.ts`, asked through `osascript` whenever an identity is drawn, `largestScreen` in `fingerprints.ts`), so the window fits on it. The window comes forward once the run is `running` (`bringForward` in `runtime.ts`), for the starts the page asks for: the routes pass `show: true` (`routes.ts`). Held by `fingerprints.test.ts`, `window.test.ts` and `service-tabs.test.ts` ("comes to the front once a start the person asked for is up"). |
| `WIN-F2` | Playwright opens every page it asks for in a window of its own. Before the first browser starts, the app changes `newPage` in the build's `omni.ja` so that, with the preference `sessionmanager.pagesInTabs` on (only a browser with a window gets it), the page is a tab of the window used last (`openPagesInTabs` in `juggler.ts`); a build it does not know is left as it is, with the warning "Left the Camoufox browser as it is", and its reopened tabs then come up in windows of their own. Held by `juggler.test.ts` and, in the real-browser lane, `juggler.camoufox.test.ts`. |
| `WIN-F4` | Playwright's `bringToFront` only selects the tab in its window. On macOS the app also activates the browser's process through AppKit (`NSRunningApplication`, from a script `osascript` runs: no Apple Event, so no permission prompt), which raises its windows above the app in front (`window.ts`, held by `window.test.ts`; `show` in `camoufox-session.ts`, held by `camoufox-session.test.ts`). |
| `WIN-F6` | Only the HTTP routes ask for the window to come forward; the MCP tools start, restart and rotate without it, so an assistant at work never takes the screen from the person (held by `service-tabs.test.ts`, "stays where it is when an assistant starts the session"). `show_window` is the assistant's way to bring it forward on purpose. |
| `WIN-F10` | Camoufox shows every tab of a window to Playwright as visible and focused, and reports no switch of tabs. An init script keeps, in each page, the time of the last trusted `pointerdown` or `keydown` (`watchInput` in `playwright-remote.ts`), and the latest wins unless a tool chose a tab since (`#followWindow`); a tab chosen in the tab bar is no event in a page. Held by `playwright-remote.test.ts` ("works in the tab the person last clicked or typed in", "types into the tab the person last used"). |
| `WIN-B2` | Nothing is typed unless what has the focus in the page takes text: a text field, a text area, an editor or a frame (`focusTakesText` in `playwright-remote.ts`). A value typed into a page that takes keys as shortcuts could do anything there, and a password must never end up in a page as keys. Held by `service-tabs.test.ts` ("types nothing while no field has the focus in it") and `backend/main.camoufox.test.ts`. |
| `WIN-B3` | Playwright's `insertText` acts in the page: the value goes to the page's own focused element (`document.activeElement`, which stays the field you clicked while the browser's address bar has the keyboard), never into the browser's own bars, and `focusTakesText` asks the same element. |
| `WIN-B5` | The page is asked what has the focus with a limit of one second (`FREE_TIMEOUT`): one that does not answer (a dialog waits) is `browser_error` with "The page does not respond. A dialog (alert, confirm) may be waiting for an answer." A value the page took but has not finished taking 15 seconds later (`TYPE_TIMEOUT_MS` in `service.ts`) is `browser_not_responding`; the typing is left to finish on its own. Held by `service-tabs.test.ts` ("gives up on a page that does not take the text, and says a dialog may wait"). |
| `WIN-F11` | In a window a dialog is the person's to answer, unless an AI assistant is at work: then its tools see it too, and one it leaves for two minutes is left to the person (`#dialogOpened`, `#forgetDialog` in `playwright-remote.ts`). Without a window (the real-browser lane) nobody could answer, and the dialog is dismissed. |
| `WIN-F13` | This Camoufox build does not deliver the `geolocation:*` values of its config, so the launch gives the context the position of the exit IP (`setGeolocation` in `camoufox-backend.ts`); the browser answers a page with it at once, and the permission state stays "prompt". Held by `camoufox-backend.test.ts` ("tells the pages where the exit IP is") and `service.camoufox.test.ts` ("gives a page that asks for the position the coordinates of the exit IP"). |
| `WIN-B6` | Every browser is launched with `acceptDownloads: false`: Playwright would keep a download in a temporary folder until the session ends, where a page could fill the disk (`camoufox-backend.ts`, held by `camoufox-backend.test.ts`). |
| `WIN-F15` | Closing the last tab does not end the browser's process (on macOS an app outlives its last window): 1.5 seconds without a page end the session and forget its tabs (`NO_PAGES_GRACE_MS`, `#endIfNoPages` in `camoufox-session.ts`), so the next start opens the start page. Held by `camoufox-session.test.ts` ("ends after a grace period and forgets its tabs, but not the browser"). |
| `WIN-B7` | A process that exits (quit, crash, kill) closes the context first, and the tabs closing with it do not count: the next start reopens them (held by `camoufox-session.test.ts`, "forgets nothing when the whole browser is what went away"). A browser's main process is the line of `ps` without `-contentproc` and `-parentPid` (`findBrowserPid`: on macOS the other processes carry `-parentPid`); killing another one only closes a tab. A browser that is gone ends the run as stopped (`#launch` in `runtime.ts`): only a browser that never came up leaves the session in Error. |

## proxies

| Box | What it pins |
|---|---|
| `PROXY-P1` | A clean import closes with a notice; the report replaces the form only when a line was repeated or refused, or nothing was added (`import-proxies-dialog.tsx`). |
| `PROXY-P4` | While every proxy is being checked the Check all button is disabled, not hidden, and keeps the focus it was given; checks run eight at a time. |
| `PROXY-F8` | The reason of a failed check is the network's own English (`backend/domains/proxies/exit-ip.ts`), with no URL and no credentials in it, whatever the page's language. |
| `PROXY-F13` | The API answers `hasPassword`, never the password; the bridge and the proxy export of the Sessions list are the only places a password is used or handed out. |

## secrets

| Box | What it pins |
|---|---|
| `SECRET-F13` | A list answer carries previews that never include a masked value; the values come with `GET /api/secrets/{id}` when one is opened (`backend/domains/secrets/vault.ts`, held by `vault.test.ts`). |
| `SECRET-F14` | A hidden single-line value is a real `input` of type `password`, so that assistive technology does not speak what is typed into it (a masked text field put the typed value in the accessibility tree); `autocomplete="off"` and the opt-out hints of 1Password, LastPass and Bitwarden (`data-1p-ignore`, `data-lpignore`, `data-form-type`, `data-bwignore`) keep the password managers out, and the browsers' own managers decide for themselves, which is why the box looks at three engines (`secret-field-row.tsx`). A hidden value of several lines stays a text area masked by CSS: no password form exists for it, so a screen reader still reads it. |

## settings

| Box | What it pins |
|---|---|
| `SET-F9` | The catalogs address the reader informally (du, tu) and name the same things everywhere (Sitzung, Proxy, Secrets, KI-Zugriff; session, proxy, secrets, accès IA); a longer word must not cut a label off. Held in part by `lib/i18n/messages.test.ts`. |
| `SET-F17` | `type_secret` types one value into the page without giving it back; `list_secrets` shows titles, kinds and previews without masked values; `get_secret` does give the value, which the page's warning says (`backend/domains/mcp/tools-secrets.ts`). |
| `SET-F18` | While an AI assistant is at work, a dialog is its to answer as well as the person's; one it leaves for two minutes (`DIALOG_TIMEOUT`) stays in the window for the person, and the assistant is no longer told of it (`#forgetDialog` in `playwright-remote.ts`). With no assistant at work a dialog is the person's alone; without a window (the real-browser lane) nobody can answer it, and it is dismissed. |
| `SET-F20` | The switch is read on every request, so `403` takes effect at once; a session an assistant started keeps running because the assistant is only a client. |
| `SET-B2` | A tool that refuses answers a normal result flagged `isError` with the app's own sentence (`backend/domains/mcp/tool.ts`); an assistant that retries the same call in a loop is the assistant's failure, but the sentence must say what to do. |

## responsive-a11y

| Box | What it pins |
|---|---|
| `A11Y-A6` | Most controls draw their focus as a ring (a box-shadow) with the browser's own outline off, and forced colours drop shadows: under `forced-colors: active` whatever has the keyboard's focus gets an outline in the system's highlight colour (`globals.css` of `@tale/ui`). |
| `A11Y-A4` | The dot of a row is decorative and the colour never stands alone: the row's link is named `<name> <state> <second line>`, the state once and after the name (the line below says it when that is all it says, else a visually hidden word does: `session-row.tsx`). |
| `A11Y-A9` | The busy states are announced from the stopped card's status region, which goes away with the card, so reaching **Running** is not announced (`BL-8`). |

## real-browser-realism

| Box | What it pins |
|---|---|
| `REAL-F2` | The window size a page sees is the identity's: Camoufox pins it and opens the window at that size, and the launch is made without Playwright's default viewport (`camoufox-backend.ts`), else the page would report 1280×720. |
| `REAL-F3` | The canvas, audio and font-spacing seeds, the history length, the antialiasing offset and the WebGL pair are drawn once and pinned (`PINNED_KEYS` in `fingerprints.ts`); without that every launch of a session would look like another browser. Held by `fingerprints.camoufox.test.ts`. |
| `REAL-F4` | A new identity is drawn again, up to 30 times, until both its visible and its full signature differ from every session's (`createIdentity`). |
| `REAL-F6` | The place is derived once per exit IP and kept, so the same IP always reports the same place even after the GeoIP database changed; the language is drawn by population among the country's official languages that Firefox ships in (`FIREFOX_LANGUAGES` in `geo.ts`), never a regional one. Held by `service-location.test.ts` and `geo.test.ts`. |
| `REAL-F7` | The language is kept while the country is, and drawn again (`identity.locale` set to null) when the same or another proxy now exits in another country (`#prepare` in `service.ts`). |
| `REAL-B1` | The exit IP is looked at again 30 seconds after a start and then every 5 minutes (`FIRST_RECHECK_MS`, `RECHECK_EVERY_MS`); a proxy that changes its IP at every request can never match. |
| `REAL-F9` | WebRTC is told the exit IP (`webrtc:ipv4`) and `media.peerconnection.ice.proxy_only` is set: without it a connection made in an iframe or a popup sends STUN packets around the proxy (`LAUNCH_PREFS` in `camoufox-backend.ts`). |
| `REAL-F11` | With WebRTC available and an IPv4 exit IP the browser is kept off IPv6 (`network.dns.disableIPv6`), else a dual-stack page could show your own IPv6 address. |
| `REAL-F13` | The browser is never given proxy credentials: Firefox refuses SOCKS5 credentials, and with an HTTP(S) proxy Playwright answers the `407` for page requests only, so Firefox's own background requests would be refused over and over (`backend/domains/proxies/bridge.ts`, held by `bridge.test.ts`). |
| `REAL-F14` | The bridge listens on `127.0.0.1` with a random port and no login, so any program of the computer can use the proxy while the session runs: the trade-off the README states. |
| `REAL-F19` | The uBlock Origin add-on is cached in the `addons/UBO` folder of the installed build (`getPath` of camoufox-js is relative to the build, inside `Camoufox.app/Contents/Resources` on a Mac) and downloaded at a launch that does not find it; a download that fails is logged and the browser starts without it. |
| `REAL-P4` | The manager gives the browsers `SHUTDOWN_TIMEOUT_MS` (30 s) to close and then leaves a browser that has not closed to itself, which is why the box counts processes after it exited. |

## degraded-modes

| Box | What it pins |
|---|---|
| `DEG-F1` | `HTTPS_PROXY` is honoured by Bun's `fetch`, which camoufox-js downloads with, so a closed port there fails every download the manager makes while the proxy checks and the browsers, which carry their own proxy, are unaffected. The failure takes about fifteen seconds because the download retries. |
| `DEG-F2` | The text of an install failure begins with the command that failed, `camoufox-js fetch`, and its exit code, then the last twelve lines it printed (`backend/domains/browser/install.ts`); the banner names the same command as the one to run by hand. |
| `DEG-B1` | GeoIP lookups run one at a time (`oneAtATime` in `geo.ts`: each reads a 50 MB database) and each retries a missing download five times, five seconds apart, so a missing database costs about twenty-five seconds per lookup. Held by `geo.test.ts`. |
| `DEG-B2` | A failed add-on download is logged and the launch goes on without the add-on (`maybeDownloadAddons` in camoufox-js); the next launch tries again. |
| `DEG-F4` | The polled reads try again after 5, 10, 20 and then every 30 seconds while the manager does not answer (`offlineDelay` in `app/lib/polling.ts`, held by `polling.test.ts`). An orderly stop closes the browsers first; a manager that is killed takes its browsers, and their windows, with it within a few seconds (`DEG-B3`). |
| `DEG-B3` | A session's tabs are saved on every change (`onLayout`, `saveTabs`), so a manager that was killed loses at most the last change. |
| `DEG-B4` | The database carries `application_id` 0x534D4752 ("SMGR"); an empty file is adopted, a file with tables and another id is refused and left as it is, before the directory it lies in is changed or filled (`backend/db/store.ts` and `createBackend` in `backend/main.ts`, held by `store.test.ts`). |
| `DEG-B6` | `/api/health` does not touch the store, so a supervisor's health check keeps passing while every other answer is a `500`. |
| `DEG-F6` | A proxy check connects within 8 seconds and ends within 15 (`exit-ip.ts`), which is why the box says "about fifteen seconds". |
