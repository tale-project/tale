# Error-code provocation map

Which error each surface can produce, and how to reach it deliberately. Used by
the suites when a box says "expect `<code>`", and as the checklist for "should
this code even be reachable from here?".

The backend answers a refusal as `{ "error": "<code>", "message": "…", …extra }` with the HTTP status in
the tables below. The code is stable and `message` is the English sentence, for API and MCP clients.
**The page does not show `message`: it words the sentence from the code** (and from the extra fields
where a code has some), in the person's language, from `messages/*/errors.yml`
(`app/lib/api/failure.ts`). A code the page has no words for shows `fallback` ("Something went wrong.
Try again."), never `message` (an English sentence for API clients). Two codes are made by the page
itself, not sent by the backend: `server_error` for an answer that is no error of the backend (a
gateway's error page) and `bad_answer` for an answer the page cannot read. A call that failed without
any answer shows `network`, "Can't reach Session Manager. Check that it's running, then try again." A
start that fails in the background has no HTTP answer: the session carries the code in `errorCode` and
the same extras in `errorExtra` (`Record<string, string | number> | null`), and the page words it the
same way.

Where a **Try again** button stands beside a failed read (a list, a page, the settings), the alert names
what could not be loaded ("Couldn't load the sessions.") and adds the sentence of the code only when
trying again does not mend it (`forbidden_host`: "Couldn't load the settings. Open Session Manager at
127.0.0.1 or localhost."): for `network`, `internal_error`, `server_error` and a code the page has no
words for the alert is the lead alone, since the button says to try again and the red strip across the
top says why the server cannot be asked (`readFailureText` in `app/lib/api/failure.ts`).
[`tests/guards/error-codes.guard.test.ts`](../../guards/error-codes.guard.test.ts) keeps the backend's
codes and the catalog in step; the section that follows says what the extras are.

## Extra fields

Plain strings and numbers, named in `backend/domains/sessions/refusals.ts`. The page reads only the
ones in this table, and only as a text or a count; a code without its extras falls back to its plain
sentence (older data, an AI client).

| Code | Extra fields | The page words it as |
|---|---|---|
| `proxy_unreachable` | `proxyId` (number); `reason` (string: the proxy check's own words, in English, no password: "connection refused", "the proxy rejected the credentials (HTTP 407)") | `errors.proxy_unreachable_reason` ("This session's proxy isn't working: {reason}. Choose Rotate IP to give the session another proxy."), else `errors.proxy_unreachable`; the cause is shown on one line, cut at 300 characters, without a closing full stop |
| `no_working_proxy` | `failed` (number: how many proxies failed their check, **only when above 0**) | `errors.no_working_proxy_failed` ("No working proxy is available (1 proxy failed its check). Add proxies or check the existing ones, then try again."; "(3 proxies failed their check)"), else `errors.no_working_proxy` |
| `unknown_ip_location` | `reason` (string: the lookup's own words) | `errors.unknown_ip_location_reason` ("Couldn't find the time zone and location of the proxy's exit IP: {reason}."), else `errors.unknown_ip_location` |
| `browser_error` | `reason` (string: what the session's browser could not do, in its own English words: "No tab is open.") | `errors.browser_error_reason` ("The session's browser couldn't do this: {reason}."), else `errors.browser_error`; the cause is shown on one line, cut at 300 characters, without a closing full stop |
| `session_busy` | `doing` (`assigning_proxy`, `starting` or `stopping`; **absent** for any other kind of busy) | `errors.session_busy_assigning_proxy`, `errors.session_busy_starting` or `errors.session_busy_stopping`, else `errors.session_busy` |

`no_working_proxy` and `unknown_ip_location` are **only ever a session's background error**: they
reach the page as the session's `errorCode` with `errorExtra` carrying the same keys, never as an
HTTP answer. `proxy_unreachable` is both: a `502` when you ask (Check IP, Start) and, when a start is
refused, the session's `errorCode` with `errorExtra { proxyId, reason }`.

The other extras are for a client to act on and are not worded by the page: `duplicate` has
`existingId`; `proxy_busy` and `proxy_in_use` have `session` (`{ id, name, status }`); `ip_in_use` has
`exitIp` and `sessions` (a list of those); `invalid_proxy` has `reason` (a parse code) and `params`,
which the page words from `proxies.yml`; `validation_error` has `issues` (`path`, `message`, `code`,
never the value).

## Reachable from the UI

Each surfaces as a localized message the user can act on: a toast, a dialog, a line beside a field or
a session's Error line. Several need **a window that has not refreshed yet**: the lists refresh every
1.5 to 5 seconds, so load the page, make the change from a shell (`curl -s -X POST
{origin}/api/sessions/{id}/start`) or another window, and press the control in the first window at
once; block the list request in devtools (Network, block `*/api/sessions?*`) to hold that window
still as long as you like.

| Code | Status | Where it shows, and how to reach it |
|---|---|---|
| `session_not_found` | 404 | A toast ("This session no longer exists.") when you act on a session another window deleted, or the page "Session not found" ("The session may have been deleted, or the address may be wrong.") when you open its address (held by `sessions.spec.ts`). |
| `proxy_not_found` | 404 | Toast "Couldn't delete the proxy" or "Couldn't check the proxy": delete a proxy in one window, act on it in another (held by `proxies.spec.ts`). |
| `secret_not_found` | 404 | Toast "Couldn't delete the secret": delete a secret in one window, delete it in another (held by `secrets.spec.ts`). |
| `session_not_running` | 409 | Toast "Couldn't restart the session", "This session isn't running. Start it first.": stale window showing Running, stop the session from a shell, choose Restart. Show window and Type answer the same ("Couldn't show the window", "Couldn't type the value") when they reach a session that stopped before the page noticed. |
| `session_running` | 409 | Toast "Couldn't start the session", "This session is already running." (also for a session that is starting): stale window showing Stopped, start it from a shell, press Start. |
| `session_busy` | 409 | Toast with the sentence of `doing`: stack A, `PUT {control}/faults` `{"checkDelayMs":8000}`, `POST /api/sessions/{id}/rotate` on a stopped session, then Start in a stale window ("This session is getting a proxy. Try again in a moment."); `starting` comes with Rotate IP on a starting session, `stopping` with Start on a stopping one. The menu and the buttons are disabled for a busy session, so only a stale window reaches it. |
| `no_free_proxy` | 409 | Dialog **No free proxy available** that waits for proxies and carries on by itself: Add session or Rotate IP with every proxy taken (held by `sessions.spec.ts`). |
| `no_working_proxy` | none (a session's error) | The session's **Error** line ("No working proxy is available (1 proxy failed its check). Add proxies or check the existing ones, then try again."), and the dialog **No working proxy available** that waits for proxies: every free proxy fails when the session asks (held by `sessions.spec.ts`). |
| `proxy_unreachable` | 502, and a session's error | Toast "Couldn't check the IP" ("This session's proxy isn't working: {reason}. Choose Rotate IP to give the session another proxy."), the dialog **The proxy of "{name}" isn't working** with **Rotate IP**, or the session's Error line: stack A, `PUT {control}/exit-ips` with an `error` for the session's proxy, then Check IP or Start (held by `sessions.spec.ts`). |
| `proxy_busy` | 409 | Dialog **Stop the session first**: delete a proxy that a running session uses (held by `proxies.spec.ts`). |
| `proxy_in_use` | 409 | Dialog **Delete a proxy in use?**: delete a proxy that a stopped session has (held by `proxies.spec.ts`). |
| `ip_in_use` | 409 | Dialog **Same exit IP as another session** with **Start anyway**: stack A, `PUT {control}/exit-ips` so that two proxies exit through one IP, start the first session, then the second (held by `sessions.spec.ts`). |
| `duplicate` | 409 | Beside the Proxy field ("This proxy is already in the pool as {proxy}.") with **Show in list**: add a proxy twice (held by `proxies.spec.ts`). |
| `invalid_proxy` | 422 | Beside the Proxy field, and per line in an import report ("Invalid port 99999. A port is a number from 1 to 65535.") (held by `proxies.spec.ts`). |
| `name_taken` | 409 | Beside the Name field of Add session and Rename ("A session with this name already exists.") (held by `sessions.spec.ts`). |
| `invalid_name` | 422 | Beside the Name field of Rename when it is emptied ("The name must be 1 to 80 characters long."); the field takes no more than 80 characters, so the long case, and a name with a control character (a line break, a tab), are the API's (held by `sessions.spec.ts`). |
| `invalid_start_page` | 422 | Beside the Start page field of Settings ("The start page must be a web address, for example https://www.google.com.") (held by `settings.spec.ts`). |
| `fingerprint_exhausted` | 409 | Toast "Couldn't add the session" ("Couldn't generate a new fingerprint that differs from every existing session. Try another operating system."): stack A, `PUT {control}/faults` `{"identityError":"No fingerprint fits"}` (held by `sessions.spec.ts`). |
| `unknown_ip_location` | none (a session's error) | The session's **Error** line "Couldn't find the time zone and location of the proxy's exit IP: {reason}.": the GeoIP database is missing and cannot be downloaded (stack B): `DEG-B1`. The fake backend places every IP, so stack A cannot show it. |
| `nothing_to_export` | 409 | Toast "Couldn't export the proxies" ("No session has a proxy yet, so there is nothing to export."): Export session proxies as JSON, in the More actions menu of the Sessions list, with no session that has a proxy (held by `sessions.spec.ts`). |
| `no_field_focused` | 409 | Toast "Couldn't type the value" with "Nothing in the session's window can take text. Click the field in the window first, then try again.": click the text of a page in the session's window, outside any field, then press Type next to a value in the Secrets popover (stack B, `WIN-B2`); on stack A, `POST {control}/browsers/{name}/focus` with `{"field":false}` first (held by `window.spec.ts`). Nothing is typed and the window stays where it is. A text field, a text area, an editor or a frame takes text; a button, a link or the page itself does not. |
| `browser_error` | 502 | Toast "Couldn't show the window" or "Couldn't type the value" with "The session's browser couldn't do this: {reason}.", the reason in the browser's own English words. Rare by design: a session whose last tab just closed answers "No tab is open." for the second and a half before it ends (stack B: close the last tab of the window and press Show window at once). A page that does not answer is `browser_not_responding` (below), never this code. The fake browser of stack A never fails: the toasts are held by `window.spec.ts`, which answers the call itself, the code by `service-tabs.test.ts` and `routes.test.ts`. |
| `browser_not_responding` | 504 | Toast "Couldn't type the value" with "The session's browser didn't respond. If a dialog is open in its window, answer it, then try again.": the page did not say within a second what has the focus (a dialog waits: an alert left open before you press Type, `WIN-B5`; the toast comes within a few seconds and nothing is typed), or it took the value and had not finished taking it 15 seconds later (`TYPE_TIMEOUT_MS`), most often because the typing opened a dialog: open `data:text/html,<input oninput="alert(1)">` in the window's address bar, click the field and press Type, and the toast comes 15 seconds after the click. Held by `service-tabs.test.ts`, the toast by `window.spec.ts`. |
| `forbidden_host` | 403 | The tab shows the JSON answer when the page is opened under another name that resolves to the loopback (`http://127.0.0.1.nip.io:3004/`, or `curl -si -H 'Host: manager.example:3004' {origin}/`). A malformed `Host` (`Host: localhost:abc`) is answered earlier, by the shared server, with a plain `400 Bad Request` that carries the security headers. |
| `ai_access_off` | 403 | Not a message of the page: the answer an assistant gets while AI access is off (`SMOKE-F13`, `SET-F20`, and `settings.spec.ts`); the page shows the switch off. |
| `network` | none | The toast of any change made while the manager is unreachable ("Couldn't add the proxy" with "Can't reach Session Manager. Check that it's running, then try again."). A list or page that cannot be read says only what it could not load, with **Try again**, and the red strip across the top says why: `DEG-F4` (and `sessions.spec.ts`, "a list that cannot be loaded"). |
| `server_error` | any non-JSON answer | An answer that is no error of the backend, such as a gateway's `502` page (`curl`-able only through a proxy in front of the manager): "Session Manager answered with an error. Try again."; beside a failed read the red strip says it instead: "Session Manager answered with an error. We're trying again. If the problem persists, restart Session Manager." |
| `bad_answer` | the status of the answer | An answer the page cannot read (not JSON, or not the shape it expects): "Session Manager sent an answer this page can't read. Reload the page." |
| `fallback` | none | A failure the page cannot word at all, and a code it has no words for: "Something went wrong. Try again." |

## Reachable on the API surface only

Never a message of a page that is up to date — seeing one of these in the UI is itself a bug, except the two
browser codes, which the catalog words for a window that has not noticed the install yet.

| Code | Where it shows up |
|---|---|
| `browser_installing` | `503` from `POST /api/sessions` or a start while the browser is being installed (`curl -si -X POST -H 'Content-Type: application/json' -d '{}' {origin}/api/sessions`); the page disables Add session and Start meanwhile (`DEG-F1`), so only a window that has not polled since the install began shows its toast ("The browser is still being installed. Try again once it is ready."). |
| `browser_not_installed` | the same, once the install has failed (`DEG-F2`); toast "The browser isn't installed yet."; the API's sentence names the command to run by hand, `camoufox-js fetch`. |
| `not_found` | `404` for an unknown address under `/api`: `curl -s {origin}/api/nothing`. |
| `forbidden_origin` | `403` for a state-changing request with a foreign `Origin` (`curl -si -X POST -H 'Origin: https://evil.example' -H 'Content-Type: application/json' -d '{}' {origin}/api/proxies/check-all`; the page's own origin is `http://<host>`, so its name with `https://`, `-H 'Origin: https://127.0.0.1:3004'`, is foreign too), for a body that is not JSON (`-H 'Content-Type: text/plain' -d x=1`), and for any request to `/api` or `/mcp` that a browser marks `Sec-Fetch-Site: cross-site` or `same-site` (`curl -si -H 'Sec-Fetch-Site: cross-site' {origin}/api/meta`; `same-origin` and `none` pass, and so does a program that sends no such header). |
| `method_not_allowed` | `405` with `Allow: POST` for any other method on `/mcp`, with AI access on. |
| `unsupported_media_type` | `415` from `/mcp` for a request without a body that is not `application/json` (`curl -si -X POST -H 'Content-Type: text/plain' {origin}/mcp`); with a body, the request check answers `403 forbidden_origin` first. |
| JSON-RPC errors | from `/mcp`: `-32700` "Parse error: the body is not JSON." (`400`); `-32600` for a bad envelope, an unsupported `MCP-Protocol-Version` or an empty or oversized batch (`400`); `-32601` "Method not found: …" and `-32602` "Unknown tool: …" (`200`, as JSON-RPC does). A tool that refuses or gets bad arguments answers a normal result flagged `isError` with the sentence. |

## Must never appear

`internal_error`, a `500` with "Something went wrong.": it means the manager gave up on a request. There
is no repro by definition and any sighting is a finding, **except** the ones a box makes on purpose by
taking the data directory away (`DEG-B6`). The page words it in the person's language ("Something went wrong.
Try again."), the API answers `{ "error": "internal_error", "message": "Something went wrong." }`, and the log
shows the failing request with its stack.

## Unreachable from the UI, still enforced

Codes the client-side guards intercept before the server ever answers. **Don't**
file a missing message; **do** confirm the server still refuses, by calling it
directly.

| Code | Guarded by | Proven by |
|---|---|---|
| `validation_error` | every form checks its fields before it sends | `curl -s -X POST -H 'Content-Type: application/json' -d '{}' {origin}/api/proxies` answers `422` with `issues`; a body that is not JSON, `{not json`, answers the same; a body over 1 MiB (a `proxy` of 1,100,000 characters) answers `413` with the same code ("The request body is larger than 1048576 bytes."). |
| `invalid_secret` | the secret form's rules (a title of 1 to 120 characters, a value, labels) | `POST {origin}/api/secrets` with `{"kind":"note","title":"","fields":[]}` answers `422`. |
| `invalid_kind` | the Type of the form and of the filter are lists of the four kinds | `GET {origin}/api/secrets?kind=nope` answers `422`. |
| `invalid_scope` | the scope filter is a picker of sessions | `GET {origin}/api/secrets?scope=nope` answers `422`. |
| `no_proxy` | the menu disables Restart and Check IP unless the session runs ("Only a running session can be restarted.", "Only a running session can be checked."), and Check IP also for a session without a proxy ("The session has no proxy.") | delete a proxy that a stopped session has (the question "Delete a proxy in use?" lets you), then `POST {origin}/api/sessions/{id}/check-ip` answers `409`. |
