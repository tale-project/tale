# Smoke

> **Prefix** `SMOKE-` · **Reset** once, at the start · **Cost** ~15 min

The fast "is this build even drivable" pass over Session Manager. Green ⇒ go on to the suites that
matter for what changed; red ⇒ stop and fix, because everything after this reads on top of it.

The first group opens the **shell**: the routes, the titles, the unknown addresses. The second runs
**one session from proxy to deletion** on a real browser, so a build that renders but cannot start
Camoufox fails here and not at box 40 of another suite. **The second group is a chain: each box
consumes what the one before left, so run it in order.** The specs hold every one of these steps on the
fakes ([`../reference/automation.md`](../reference/automation.md)); this pass is the same road on the
real thing.

## Preconditions

The stack up per [`../setup.md`](../setup.md), stack B for the chain, on a Mac (stack A drives the same
boxes for a quick pass, with no window: the control server says what the fake browser was told), on a
fresh data directory (a reset just now), devtools open, a 1440×900 viewport. The chain needs one
working proxy of your own.

> **Agent note**: wait on state, never on time. The page is ready when the rail (the `navigation`
> "Main navigation", `navigation.aria.main`, inside the `complementary` "Session Manager sidebar",
> `navigation.landmark`; on a phone the tab bar "Primary navigation") is on screen. A session is up when
> its header says **Running** (poll `GET /api/sessions/{sessionId}` for `status` `running` and
> `activity` `null`), and its page then shows the card "Running in its own window" (a level-2 heading,
> `viewer.window.title`). The window itself is for your eyes: no script sees it.

## The shell

- [ ] `SMOKE-F1` · **Open `/` with the console open** → the address becomes `/sessions` and Back
  does not return to `/` (the redirect replaces the entry); the sidebar (`complementary` "Session
  Manager sidebar") holds the one `navigation` "Main navigation": Sessions, Proxies and Secrets, with
  Settings at its foot (`navigation.sections.*`); with nothing added yet the list says **No sessions
  yet** with "Add proxies first. Every session needs one of its own." (`sessions.empty.noProxies`) and an
  **Add proxies** button, and the page beside it says "No session open" and "Sessions you add appear
  on the left." (`sessions.index.addFirst`); no console message at `warn` or `error` level beyond the
  known-benign list in [`not-a-finding.md`](../reference/not-a-finding.md).
- [ ] `SMOKE-F2` · **Open each of `/sessions`, `/proxies`, `/secrets`, `/settings`,
  `/settings/appearance` and `/settings/ai-access` directly, then reload it** → each page renders
  from its URL alone (`/settings` continues to `/settings/general` on a computer); the browser tab
  names the page and the app, `<page> - Session Manager` ("Proxies - Session Manager", "Appearance -
  Session Manager", "General settings - Session Manager", "AI access - Session Manager"); no flash of
  an empty shell, no error boundary.
- [ ] `SMOKE-F3` · **Open `/sessions/abc`, then `/sessions/999999`, then `/nope`** → the first
  two say **Session not found** with "The session may have been deleted, or the address may be wrong."
  and a **Back to sessions** link (`viewer.gone.*`), inside the shell, under the page's one heading,
  "Session", and the tab title "Session not found - Session Manager"; the third is the app's own page
  "Page not found" ("The page you're looking for doesn't exist or may have been moved.") with a **Back to
  sessions** link (`navigation.notFound.*`) and the tab title "Page not found - Session Manager"; none
  leaves a white screen or an unhandled rejection in the console.

## One session, end to end

- [ ] `SMOKE-F7` · **Open Proxies, press Add proxy (`proxies.actions.add`), choose Manual entry
  (`proxies.actions.addProxy`), enter one proxy and press Add proxy (`proxies.add.submit`)** → the
  dialog closes, a notice says "Proxy added" and "It's being checked now.", the table lists the proxy
  at the top and its health reads **Checking** and, within seconds, **Working** with an exit IP, a
  country ("DE · Germany") and a ping ("42 ms"); the line above the table reads "1 proxy · 1 free".
- [ ] `SMOKE-F8` · **Open Sessions, press Add session (`sessions.panel.add`), leave the name blank
  and press Add session in the dialog (`sessions.add.submit`)** → the dialog closes and the address
  becomes `/sessions/{sessionId}`; the session is named after the number the dialog showed as a
  placeholder (`0001`) and heads the list; its header goes **Assigning proxy**, **Starting**,
  **Running**, and no state flickers back; the row's second line ends on the exit IP and country.
- [ ] `SMOKE-F9` · **Wait for the window** → a Camoufox window opens in front within a few seconds
  of **Running**, with one tab on the start page (`https://www.google.com`); the page of the session
  shows "Running in its own window" (`viewer.window.title`) with **Show window** and **Secrets**
  enabled.
- [ ] `SMOKE-F10` · **Type `hello` into the search field of the window, click back into the manager's
  page, then press Show window (`viewer.window.show`)** → the letters are in the field; the window comes
  back in front of the manager's browser, as it was. (Stack A: no window; read what arrived with
  `curl -s http://127.0.0.1:4204/browsers/0001`: one `["toFront"]` more than before the press, the
  start having brought it forward once already.)
- [ ] `SMOKE-F11` · **Press Stop session in the header, wait, then press Start session** → the row reads
  **Stopping**, then **Stopped**, then **Starting** and **Running** again; the window closes at Stop and
  opens again, in front, with the same single tab and address; nothing asked for a confirmation.
- [ ] `SMOKE-F12` · **Open the menu "Actions for 0001" (`sessions.row.menu`), choose Delete, read
  the dialog and press Delete session (`sessions.delete.confirm`)** → the dialog asks whether to
  delete the session by its name (`sessions.delete.title`) and says "The session's browser profile
  (cookies, site data, history) and its own secrets are deleted permanently. Its proxy becomes
  free." and, for a running session, "The browser is closed first."; afterwards the window is gone, the
  address is `/sessions`, the list is empty, and on Proxies the proxy reads **Free**.
- [ ] `SMOKE-F13` · **Open the AI access page of Settings without touching the switch, then run
  `curl -si -X POST -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:3004/mcp` (your
  own port)** → **Allow AI assistants to connect** is off, a warning says a connected assistant
  "can use every session and read every secret, including passwords and card numbers", and the
  request is answered `403` with `{"error":"ai_access_off","message":"AI access is off. Turn it on
  in Settings."}`.
