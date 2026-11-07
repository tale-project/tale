# Not a finding

The three registers that keep a round honest: what the product deliberately does
not do, what looks wrong but is correct by design, and what is a known gap
already tracked. **Nothing on these lists is a round finding.** If a box brushes
against one, cite it and move on; if you disagree with an entry, that is a
product conversation, not a bug report.

Everything here is verified against the source. When a round proves an entry
wrong, fix the entry in the same change as the code — a stale quirk costs the
next round a false finding.

## Out of scope

Features deliberately excluded, with the reason. An absence nobody wrote down
gets re-filed every round.

- **Accounts, a login, roles, several people.** The manager is for one person on their own
  computer and listens on the loopback only; the defences are about who can reach the address
  (Host and Origin checks, AI access off by default), not about who the user is. Anything that
  would let a second person in belongs in front of the manager, not in it.
- **Downloads inside a session.** A download is refused and nothing is written to the disk:
  Playwright would keep it in a temporary folder until the session ends, where a page could fill the
  disk. Uploads, printing, the browser's pickers, its right-click menu and its dialogs are the
  window's own, as in any Firefox.
- **Running the manager without a screen**: in a container, on a server, over SSH. Each session's
  browser opens a window on the desktop of the computer the manager runs on; there is no image and no
  compose stack for it, and a session's window shows on that computer only.
- **SOCKS4 and SOCKS4a proxies.** They have no authentication and are IPv4 only; the manager
  refuses them with a sentence that says to use SOCKS5 or HTTP.
- **A session without a proxy of its own, or two sessions on one proxy.** Every session has its
  own proxy and so its own exit IP; sharing an exit IP through two proxy entries is allowed only
  after a question ("Same exit IP as another session").
- **Moving data in from another program.** The database carries an application id and a database
  another program made is refused and left untouched; there is no importer and no in-place upgrade
  of foreign files.
- **Turning AI access on or off from an assistant.** No tool does it, on purpose: only the person
  at the page can (Settings, AI access: "An assistant can do everything you can do in Session Manager,
  except switch AI access on or off"; the 43 tools of the README's table have no such tool).
- **An event stream, sessions or `DELETE` on `/mcp`.** The endpoint is `POST` only, answers JSON
  and keeps no session; `GET` answers `405`.
- **Browsers other than Camoufox, and extensions other than uBlock Origin.**

## Product quirks

Intentional behaviours that look surprising but are correct by design.

- **An unknown path outside `/api` and `/mcp` answers the app's own page with `200`**, whatever
  the file name (`/robots.txt`, `/llms.txt`): the page is a single-page app and the router
  decides. An unknown path under `/api` answers `404` with `{"error":"not_found"}`.
- **`localhost` and `127.0.0.1` are two sites to the browser.** The theme and the language are in
  `localStorage`, so each name has its own; neither reaches the server, and a reset of the data
  directory does not touch them.
- **The page asks for news at a pace that depends on what is going on:** every 1.5 seconds while a
  session is starting or stopping, a proxy is being checked or the browser is being installed,
  every 5 seconds otherwise, and after 5, 10, 20 and then 30 seconds while the manager does not
  answer. Hence a row can keep its old state for up to five seconds after a refusal or after
  another window changed it, and a manager that comes back is noticed within thirty seconds (at
  once when you return to the window). Settings are not polled: they are read again when the
  window regains focus.
- **A toast stays for five seconds in the top right corner, over the header's buttons**, and its timer
  stops while the pointer or the keyboard is on it. Wait for it, or use the control from the keyboard.
- **Off macOS, Show window only brings the tab forward.** On macOS the window comes above the app
  you are in (the app asks the system to bring the browser's process forward); elsewhere the tab
  comes forward in its window and the window manager decides about the window, which may only flash
  in the task bar. A new fingerprint's screen is 1920×1080 there, whatever the displays, unless
  `SESSION_MANAGER_MAX_SCREEN` says otherwise: only macOS can be asked for its largest display.
- **Every running session has a Camoufox icon of its own in the Dock**, all alike: each session is a
  browser process of its own, and its icon goes when the session stops. A window does not name its
  session (its title is its page's); Show window, on the session's page or in its menu, brings a
  given session's window forward.
- **A session whose window you closed reads Stopped up to five seconds later.** The session ends
  1.5 seconds after its last tab closed, and the page asks every five seconds while nothing is busy.
  Quitting its Camoufox or killing its browser ends it at once, and the page tells within the same
  five seconds.
- **The tab you work in is the one you last clicked or typed in, in its page.** Camoufox tells the
  app nothing about a change of tabs, so a tab chosen in the window's tab bar does not count until you
  click or type in its page: Show window and Type go to the tab before it (`WIN-F10`).
- **A page that asks where you are gets the position of the exit IP at once, while the permission it
  reads stays "prompt".** The app hands the browser that position itself, so the window asks you
  nothing and the page is never told that you allowed it.
- **The search boxes of Proxies and Secrets are read-only until they are focused.** It is the shared
  search input's trick against browsers that fill it in.
- **What a proxy check or a start says about a proxy is the network's English** (for example "the
  proxy rejected the credentials (HTTP 407)"), in every language, and the password is never in it.
- **A session whose proxy stops answering stays Running.** The manager notices at its re-check,
  30 seconds after the start and every 5 minutes, marks the proxy **Not working** on Proxies and
  shows nothing on the session's page (held by `sessions.spec.ts`).
- **A proxy that does not work is never given to a session,** and one that exits through the IP
  of a proxy another session has is shown as **Same IP as {name}** and skipped, even though it
  looks free.
- **Rotate IP and Restart keep cookies and logins** (the profile stays) and derive the place, the
  time zone and the coordinates, again from the exit IP as it is now; the language is drawn again
  only when the country changed.
- **WebRTC stays available by default** and reports the proxy's exit IP only; the switch that
  removes it is `SESSION_MANAGER_BLOCK_WEBRTC`, read at start.
- **A secret value is masked when it is saved,** also when the form showed it plainly, if its label
  names something private (`PIN`, `token`, `API key`, `recovery`, …) or its text is a card number.
- **The proxy table holds only the rows near the viewport in the page.** It is virtualised and loads
  more as you scroll; count with the footer ("Showing {n} of {total} proxies"), not with the page.

## Known benign console output

Every message a round will see at `warn` or `error` level that is **not** a
defect, with the reason. Anything not on this list is a finding, on any page.

In the browser's console:

- `Failed to load resource: the server responded with a status of 404`, `409`, `422`, `502`, `503`
  or `504` — **Chromium only**: it reports every answer that is not a success, also the refusals the
  page handles itself (a session that was deleted, a duplicate proxy, a refused form, a value with no
  field to type it into). Benign when the step you are on provokes that answer; Firefox and Safari
  print nothing for it. A `500` is never expected: it is a finding unless the box says
  `internal_error` (see [`error-codes.md`](error-codes.md)).
- `Failed to load resource: net::ERR_CONNECTION_REFUSED` — **while the manager is stopped** and a
  page of it is open: every poll is reported, with growing pauses.

In the manager's log (a terminal, not the console):

- `[session-manager] listening on :{port}` at every start.
- `Changed the Camoufox browser so that a mouse event that a page does not take no longer stops its
  mouse for good` and `Changed the Camoufox browser so that the tabs a session reopens, and the ones
  the AI tools open, come up in its window` before the first browser of a build starts: the app
  changes the build once, and says nothing at the next starts.
- `The Camoufox browser is not installed: downloading it (about 1.3 GB)` while the browser is
  installed for the first time, and `retrying (n/5)...` with a stack after each failed download
  while it cannot be reached; `Camoufox warm-up failed` and `Failed to download and extract UBO`
  when the GeoIP database or the add-on cannot be fetched (`DEG-B1`, `DEG-B2` provoke them).
- `GET|POST … failed` with a stack when a request ends in a `500` that a box provoked (`DEG-B6`).
- `[e2e] backend on :{port}, control on :{port}, data in {dir}` on stack A.

## Known debt

Accepted gaps, each with the trigger for paying it off. Cite the `BL-n` and move
on; a round never re-files one.

| ID | What | Pay it off when |
|---|---|---|
| `BL-5` | A browser that blocks site data (reading `localStorage` throws) shows a blank page and one uncaught `SecurityError`, after the warning "Failed to apply the theme before the first paint": the page reads it at start without a guard. | the reads are guarded and fall back to the browser's own theme and language |
| `BL-8` | Reaching **Running** is not announced to a screen reader: the busy states are announced from the stopped card's status region, which goes away with the card, and the header's state is plain text. | the header's state is a live region |
| `BL-11` | On a pointer device the Start/Stop and menu buttons of a list row appear on a backing over the end of a long second line (an error text, already cut with an ellipsis) while the pointer is on the row; the whole line is the row's tooltip. | the buttons get a place of their own beside the text |
