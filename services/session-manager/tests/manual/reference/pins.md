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
| `SMOKE-F3` | `docs`: an earlier draft expected the router's bare "Not Found" for `/nope`; the app has its own page now (`navigation.notFound.*`), while an id that names no session is the viewer's own "gone" state, a `404` the page words. |
| `SMOKE-F10` | On stack A a keystroke is judged by what the fake browser was told (`GET {control}/browsers/{name}`, tuples such as `["key","down","h"]`), never by pixels: the mock-up page has no text field. |
| `SMOKE-F13` | `ai_access_off` is answered before the method or the body are looked at, so an empty `{}` is enough, and the switch is read on every request, not at start (`backend/domains/mcp/server.ts`, held by `server.test.ts`). |

## sessions

| Box | What it pins |
|---|---|
| `SESS-F3` | The header, the card and the row read one catalog (`sessions.status.*`) through one mapping (`app/features/sessions/lib/status.ts`), so the three can only differ if that mapping is bypassed. |
| `SESS-F5` | The second line of a row is built in `use-second-line.ts` and drawn on one line, cut with an ellipsis, its whole text the row's tooltip; the Start/Stop and menu buttons that appear on hover (always, below 768 px and on a touch screen) sit on a backing over its end (`session-row.tsx`, `BL-11`). The tone is the message: amber with a warning sign for a changed exit IP, red for a failure, the muted colour otherwise. |
| `SESS-P2` | Polling pace lives in `app/lib/polling.ts`: 1.5 s while a session is busy, a proxy is being checked or the browser is being installed, 5 s otherwise, 5, 10, 20 then 30 s while the manager does not answer. Held by `app/lib/polling.test.ts`. |
| `SESS-B4` | Bun's `server.stop()` without `true` waits for open WebSockets, so a page with a session open once kept the manager from ever exiting and its browsers from closing. `stop()` now closes the browsers first, then force-closes what is left; the box keeps a page open on purpose. Held by `backend/main.test.ts` ("stops while a live view is open"). A stop that still hangs is ended after `SHUTDOWN_TIMEOUT_MS` plus ten seconds with exit code 1, and a second signal exits at once (130, 143 or 129 by the signal): `backend/shutdown.ts`, held by `shutdown.test.ts`. |
| `SESS-F14` | Rotate restarts the same profile directory with another proxy, so cookies and logins survive; only the place and the exit IP change. |

## viewer

| Box | What it pins |
|---|---|
| `VIEW-F1` | Letters and other keys travel as `key` messages; text from an on-screen keyboard, a dictation or an input method travels as `text`; a dropped or doubled character is a defect of that split (`app/features/session-viewer/lib/keys.ts`). |
| `VIEW-F2` | Every key that went down is tracked so it can come up: on a lost connection or a lost focus all held keys are released, because the server cannot hear a key being let go any more. The server lets go of every key and mouse button a connection still holds when it ends (`session-socket.ts`), for a page that cannot send it (a closed tab, a dead network). Held by `keys.test.ts`, `session-socket.test.ts` and the real-browser lane. |
| `VIEW-F4` | A composed word (dead key, input method, emoji picker) is sent once, as text, when it is committed; sending its keystrokes would type raw letters. |
| `VIEW-F7` | Mouse positions are in the pixels of the page, not of the picture: the box clicks at three scales because a scaling error shows only off the 1:1 size. |
| `VIEW-F38` | Camoufox 152 rounds a mouse event to a whole pixel of its window before it looks for what is under it: on Linux the first row of a page falls on the toolbar above it with a Windows or macOS fingerprint, the last one past its end with a Linux fingerprint, and the page never takes the event. The browser does every mouse event, wheel turn and switch of tabs only after the one before, in every tab, so it took no mouse input again until it closed, and the viewer's Enter and + waited behind it. The Camoufox for macOS rounds those rows into the page, so stack B on a Mac cannot show it. The server keeps every mouse event one row inside the page (`pointerPlace` in `playwright-remote.ts`) and stops waiting for one that is not done 5 seconds after its page was free (no dialog waiting for an answer, no script keeping it busy), telling the viewer once (`input_stuck`) until the mouse works again. Held by `playwright-remote.test.ts` and `session-socket.test.ts`. |
| `VIEW-B1` | A text message is cut at 100,000 characters (`MAX_TEXT`, `clampText` in `lib/live-view.ts`), by the page before it sends (which says so) and by the server for other clients; a message of more than 1 MiB would close the socket (`maxPayloadLength` of the live view). |
| `VIEW-F17` | The picture has the page's size in CSS pixels, so a high-density display shows it softer than the manager's own text: expected, not a defect. |
| `VIEW-B2` | A browser's main process is the line of `ps` without `-contentproc`; killing a child only closes a tab. A browser that is gone ends the run as stopped (`#launch` in `runtime.ts`): only a browser that never came up leaves the session in Error. |
| `VIEW-F36` | `F5`, `F11` and `F12` stay with the host browser (`LOCAL_KEYS` in `keys.ts`), as do ⌘/Ctrl+R, Q and Tab: they never reach the page. |

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
| `SET-F18` | A dialog nobody answers within two minutes is dismissed, and with no viewer and no assistant at work dialogs are dismissed at once. |
| `SET-F20` | The switch is read on every request, so `403` takes effect at once; a session an assistant started keeps running because the assistant is only a client. |
| `SET-B2` | A tool that refuses answers a normal result flagged `isError` with the app's own sentence (`backend/domains/mcp/tool.ts`); an assistant that retries the same call in a loop is the assistant's failure, but the sentence must say what to do. |

## responsive-a11y

| Box | What it pins |
|---|---|
| `RESP-F4` | A finger on the picture is a tap (the click the browser makes of it), a drag (wheel messages by the distance, in the pixels of the page) or, at rest for half a second, a right click (`use-remote-pointer.ts`); the picture takes `touch-none`, so the manager's own page does not scroll or zoom under a finger. |
| `A11Y-A6` | The ring round the picture and round controls is an outline, not a shadow, so that it survives forced colours (`live-screen.tsx`). |
| `A11Y-A4` | The dot of a row is decorative and the colour never stands alone: the row's link is named `<name> <state> <second line>`, the state once and after the name (the line below says it when that is all it says, else a visually hidden word does: `session-row.tsx`). |
| `A11Y-A9` | The busy states are announced from the stopped card's status region, which goes away with the card, so reaching **Running** is not announced (`BL-8`). |

## real-browser-realism

| Box | What it pins |
|---|---|
| `REAL-F2` | The window size a page sees is the identity's, not the manager's: Camoufox pins it, and the launch is made without Playwright's default viewport (`camoufox-backend.ts`), else the page would report 1280×720. |
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
| `DEG-F4` | The live view retries after 1, 2, 4 and 8 seconds and then every 10 (`reconnectDelay`, held by `stream-url.test.ts`), the polled reads after 5, 10, 20 and then every 30; an orderly stop closes the browsers first, so each viewer is told `closed` instead of losing its socket. |
| `DEG-B3` | A session's tabs are saved on every change (`onLayout`, `saveTabs`), so a manager that was killed loses at most the last change. |
| `DEG-B4` | The database carries `application_id` 0x534D4752 ("SMGR"); an empty file is adopted, a file with tables and another id is refused and left as it is, before the directory it lies in is changed or filled (`backend/db/store.ts` and `createBackend` in `backend/main.ts`, held by `store.test.ts`). |
| `DEG-B6` | `/api/health` does not touch the store, so a Docker health check keeps passing while every other answer is a `500`. |
| `DEG-F6` | A proxy check connects within 8 seconds and ends within 15 (`exit-ip.ts`), which is why the box says "about fifteen seconds". |
