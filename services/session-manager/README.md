# @tale/session-manager

Session Manager runs isolated browser sessions on your own computer. Each session is a
[Camoufox](https://camoufox.com) browser (an anti-detect Firefox) with its own profile, its own
stable fingerprint and its own proxy, so no two sessions share cookies, storage or an IP address.
Each one opens in a window of its own on your screen, where you use it as you use any browser; a
web page on your computer is where you add, start and stop them. You can keep the logins, cards and
notes you type into pages again and again in the Secrets section, have them typed into a session's
window, and let an AI assistant use everything through [MCP](https://modelcontextprotocol.io).

It is for one person on their own machine who needs several browsers that share nothing, for
testing, research or managing accounts, and for AI assistants that should work in such browsers.
There are no accounts and no login. It needs a screen: the browsers open their windows on the desktop
of the computer it runs on (macOS is what it is made and tested on). Read the
[security model](#security-model) before you change the address it listens on.

## Quick start

Install the repository's dependencies once, at the repository root (Bun 1.4.2, the version the root
`package.json` pins):

```bash
bun install --frozen-lockfile
```

Develop with hot reload. Vite serves the page on port 3004 and forwards `/api` and `/mcp` to the
backend, which `scripts/dev.ts` starts on port 3204. Ctrl+C stops both:

```bash
bun run --filter @tale/session-manager dev        # http://localhost:3004
```

If port 3004 is taken, Vite stops with an error instead of moving to the next free port: the backend
answers only a page opened through 3004.

Or build the page and run the one process that serves everything (the page, the API and `/mcp`) on
one port:

```bash
bun run --filter @tale/session-manager build      # the page, into dist/
bun run --filter @tale/session-manager start      # http://127.0.0.1:3004
```

The build bakes the frame of the app, its rail masked, into the page it writes
(`scripts/prerender-boot-shell.ts`), with preloads of the fonts its first frame draws with. The page
waits for the counts, the browser's state and the rows of its list before its first frame (a second at
most), and that frame comes in one go: nothing in it fades in, and a list with nothing in it opens on
its empty state. The frame of the app shows only once a load takes longer than 0.4 seconds, so a page
served from this computer paints once, finished, and a slow one shows the frame meanwhile. The dev
server does the same, without the preloads.

`start` serves `dist/`, so build first. Stop it with Ctrl+C: every browser closes gracefully, its
window with it (the app waits up to 30 seconds), and each session reopens its tabs at its next
start. A second Ctrl+C
does not wait any longer and exits with code 130, and a stop that has not finished after 40 seconds
exits with code 1.

The first start downloads the Camoufox browser (about 1.3 GB, build `152.0.4-beta.30`, the one
`camoufox-js` pins) and the GeoIP database into `<data dir>/camoufox`. While it runs the page shows
how much of the browser is in, then that it is being unpacked, and sessions can start once it is
done. If the download fails, the page shows what the download printed. Install the browser by hand with the same `CAMOUFOX_INSTALL_DIR` the app uses
(by default the data directory's `camoufox` folder), and the page notices within seconds:

```bash
cd services/session-manager
CAMOUFOX_INSTALL_DIR="$PWD/data/camoufox" bunx camoufox-js fetch
```

Then add proxies (**Proxies**, **Add proxy**) and add a session (**Sessions**, **Add session**): its
browser opens in a window of its own once it is up. Every session needs a proxy of its own, so the
first session asks for one.

## Configuration

Everything is read from the environment (see [`.env.example`](.env.example)); there are no
command-line flags. What belongs to the person using the app, the start page and AI access, is
saved in the database from the Settings section; the theme and the language are saved in the
browser that shows the page. A setting it cannot use, a port that is taken, a data directory that
cannot be written and a database another program made each stop the start with one line that says
what to change (exit code 1).

| Variable                        | Default                 | What it does                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                          | `3004`                  | Port of the server. Anything outside 0-65535 stops the start with a message. `bun run dev` ignores it: Vite is on 3004 and the backend on 3204.                                                                                                                                                                                                 |
| `SESSION_MANAGER_HOST`          | `127.0.0.1`             | Interface to bind. There is no login: keep it local.                                                                                                                                                                                                                                                                                            |
| `SESSION_MANAGER_ALLOWED_HOSTS` | empty                   | More `Host` header values the app answers to, comma separated, each with its port. `127.0.0.1`, `localhost` and `SESSION_MANAGER_HOST`, each on `PORT`, are always allowed; any other `Host` gets `403 forbidden_host`.                                                                                                                         |
| `SESSION_MANAGER_DATA_DIR`      | `./data`                | Holds `manager.db`, `profiles/<session id>/` and, by default, the browser. Relative paths resolve against the working directory (the service folder for the `bun run` scripts). Run one manager per data directory: a second one on it is not refused.                                                                                          |
| `CAMOUFOX_INSTALL_DIR`          | `<data dir>/camoufox`   | Where the browser build and the GeoIP database are installed. Point it at an existing install of the same build to skip the download. Use a directory of its own: a `config.json` there records the build in use.                                                                                                                               |
| `SESSION_MANAGER_BLOCK_WEBRTC`  | off                     | `1`, `true`, `yes` or `on` removes `RTCPeerConnection` from every browser. See [WebRTC](#webrtc).                                                                                                                                                                                                                                               |
| `SESSION_MANAGER_MAX_SCREEN`    | the room on the display | The largest screen the fingerprint of a new session may have, as `WIDTHxHEIGHT`. A session's window is as large as its fingerprint says, so by default it is the room for windows on the largest display of this computer (on macOS: without the menu bar and the Dock; elsewhere 1920x1080). A value it cannot read is ignored with a warning. |
| `TALE_VERSION`                  | `dev`                   | The version that Settings, `/api/meta`, `/api/health` and the MCP server report.                                                                                                                                                                                                                                                                |
| `DEBUG`                         | unset                   | `session-manager` or `*` prints what the browser layer, the proxy checks and bridge and the AI tools ignored on purpose.                                                                                                                                                                                                                        |
| `SESSION_MANAGER_BACKEND_URL`   | `http://127.0.0.1:3204` | Development only: where Vite forwards `/api` and `/mcp`. `scripts/dev.ts` sets it.                                                                                                                                                                                                                                                              |

## How it works

### Proxies

Proxies live in a pool, separate from sessions. The **Add proxy** button of the table opens a menu
with **Manual entry** and **Import a list**. An import takes one proxy per line, pasted or read from a
`.txt` file. Blank lines, `#` comments, CRLF line endings and a UTF-8 byte order mark are fine, so a
Webshare export (`host:port:username:password`) imports as it is. A line may have 2,048 characters and
a pasted or imported list 1,000,000 (about 20,000 proxies). Importing a list twice adds nothing: every
line is reported as a duplicate. An import that adds every line closes with a notice; one that repeated
or refused a line shows a report instead, and the lines that cannot be read are listed with the reason
and with their credentials replaced by `***`, for example `1.2.3.4:99999:***:***`; usernames and
passwords are never shown.

Accepted formats; a proxy without its own scheme gets the one chosen in the dialog (HTTP at first):

```text
http://user:pass@host:port      https://…      socks5://user:pass@host:port
host:port                       user:pass@host:port          host:port@user:pass
host:port:user:pass             user:pass:host:port          [2001:db8::1]:8080
```

- `socks5h://` and `socks://` mean `socks5`. SOCKS4 and SOCKS4a are refused.
- In URL forms, special characters in credentials can be percent-encoded (`p%40ss`).
- Two entries are the same proxy when host, port, username and password match. The scheme is
  ignored.

**Health.** Every new proxy is checked in the background right away; adding never waits for it.
A check asks `api.ipify.org` (then `checkip.amazonaws.com`, then `icanhazip.com`) for the proxy's
exit IP through the proxy, looks up the country in Camoufox's local GeoIP database and keeps the
latency. A proxy is **Checking**, **Working** (exit IP, country, ping), **Not working** (with the
reason) or **Not checked**. **Check** (in a row's menu) and **Check all proxies** run in the
background too, eight at a time, and never check a proxy twice at once. A proxy that is not working
is never given to a session until a later check succeeds.

The table lists the newest proxies first and loads more as you scroll. The search reads what the
cells say (the address with its type and user name, the exit IP, the country by code and by name, the
health and the reason of a failed check, the session that has the proxy and its state), keeps its text
in the address (`/proxies?q=`) and loads the rest of the pool window by window while it looks.

**Proxies with a username and password.** The browser never gets proxy credentials: Firefox
cannot log in to SOCKS5 proxies, and with HTTP(S) proxies it only logs in for page requests, so its
own background requests would be refused. Each running session whose proxy has credentials gets a
small local HTTP proxy instead, a bridge, on `127.0.0.1` with a random port and no login. The
bridge sends every request through the session's proxy and adds the credentials: SOCKS5 resolves
host names at the proxy, HTTP uses `CONNECT` tunnels and absolute-form requests, HTTPS does the
same over TLS to the proxy (its certificate is verified). If the proxy rejects the credentials or
cannot be reached, the browser gets an error page (`502 Bad Gateway`, `504 Gateway Timeout`, or the
proxy's own error status) with the reason. A client that does not send its request within 30 seconds
is disconnected. The bridge starts and stops with the session's browser. A proxy without credentials
is passed to the browser directly.

The trade-off: while a session runs, any program on your computer, of any user account, can send
traffic through its proxy via the bridge port, without the password. The passwords are stored in plain
text in `manager.db`, which only your user can read, so for a program of another account the bridge is
new: it can use the proxy, though it cannot read the password.

### Sessions

**Adding a session starts it.** The name is optional: without one, the session is named after the
smallest free number, `0001`, `0002`, and so on. A name has 1 to 80 characters (an emoji counts as
one), no control characters, and is unique without regard to case. The system is **Random**
(Windows 75 %, macOS 25 %, never Linux) unless you choose one. The session appears at once, gets a
proxy in the background (**Assigning proxy**), then its browser launches (**Starting**), and the
page opens on it.

**One proxy, and one IP, per session.** Proxies are assigned automatically and exclusively: a
proxy belongs to at most one session (the database enforces it). A session gets the first free
proxy:

- no session has it,
- it is working or not checked yet (working ones first, then by when they were added),
- its last known exit IP is not the exit IP of a proxy another session has (the Proxies table then
  shows **Same IP as …**).

That proxy is checked right then. If the check fails, the proxy is marked **Not working** and the
next one is tried. If its exit IP turns out to be another session's, it is skipped. If no proxy
passes, the session ends in **Error** and a dialog, **No working proxy available**, is the form that
adds proxies: once one is added, the session tries again by itself. When there is no free proxy at
all, nothing is created yet, and a dialog, **No free proxy available**, asks for proxies in the same
way; it closes as soon as one was added and the action carries on from there (the session is added,
started or given another proxy). Cancel gives the action up and changes nothing.

**Starting** a session checks its proxy's exit IP again. If the proxy does not work, the session
keeps it, does not start and shows the error, and a dialog, **The proxy of "<name>" isn't working**,
offers **Rotate IP**, which gives it another proxy and starts it. If another running session has the same
exit IP (two proxy entries can lead to one IP), a dialog, **Same exit IP as another session**, asks
before starting anyway (**Start anyway**) and offers **Rotate IP** instead. A session without a proxy
(its proxy was deleted) gets a new one, as on creation.

**Stop** closes the browser and keeps its profile and tabs. A stop that arrives while the session
is still getting its proxy cancels the start at once; nothing is launched.

**Restart** closes the running browser and opens it again with the same proxy and tabs; the place
is derived again from the exit IP as it is now (the language only when the country changed).
**Rotate IP** gives a session another free proxy, checked as above, and releases the old one; a
running session restarts with it, a stopped one only changes proxy. If no other proxy works, the
session keeps its old proxy, and a running one stays closed with the error. **Check IP** looks at
the proxy's exit IP now. **Rename** changes the label in any state.

**Deleting** a session frees its proxy and deletes its profile and its own secrets. A proxy cannot
be deleted while its session runs. If its session is stopped, the app asks first; the session then
gets another proxy on its next start.

**Export session proxies as JSON**, in the **More actions** menu of the session list, downloads the
proxies of the sessions as `proxy.json`, in the format of sub2api's proxy export: one entry per
session that has a proxy, named like the session, with the proxy's host, port and credentials. It is
the one place in the page where the app hands out proxy passwords.

### Using a session

A session's browser is a window of its own on your screen, as any browser's is: its tabs, address
bar, menus, dialogs and keyboard shortcuts are Camoufox's own (downloads apart, see below), and you
use it there. A session you add, start, restart or give another IP from the page (or through the
HTTP API, which the page uses) comes to the front once its browser is up; one an AI assistant starts
over MCP stays behind the window you are in.

The page of a running session (the Sessions page, the session open on its right; on a phone the list
and the session are one screen each, with a back arrow) says that it runs in its own window and has
three things for it:

- **Show window** brings the session's window to the front, with the tab you last clicked or typed
  in (the session's menu has it too, in the list as in the session's header). On macOS the window
  comes above the app you are in; elsewhere the tab comes forward in its window and the system
  decides about the window.
- **Secrets** opens the secrets the session can use. Click the field in the window first, then
  choose **Type** beside a value: the value is typed into that field, without the clipboard, and the
  window comes to the front for you to go on. Nothing is typed when no field has the focus there (the
  page says so), so a password never ends up in a page as keys.
- **Session details**: system, screen, language, time zone, location and the IP they were taken
  from. The exit IP at the top of the session opens the same details, with **Check IP**.

- **Which tab is yours.** Camoufox shows every tab of a window to Playwright as visible and focused,
  so the app takes the tab where you last pressed a mouse button or a key as the one you work in,
  unless an AI tool chose another tab since. A typed value goes there, and so does an AI tool that
  names no tab.
- **Dialogs** (`alert()`, `confirm()`, `prompt()`, a "leave this page?" question) are the window's,
  for you to answer, except while an AI assistant is at work in the session: then its tools see the
  dialog and answer it with `handle_dialog`, and one it leaves unanswered for two minutes is left to
  you.
- **Downloads** are refused, and nothing is written to the disk: Playwright would keep a download
  in a temporary folder until the session ends, where a page could fill the disk. Uploads, printing,
  the browser's pickers and its right-click menu are the window's own, as in any Firefox.
- **The tabs the session reopens** (and the ones an AI tool opens) are tabs of its window. Playwright
  opens each page it asks for in a window of its own; before the first browser starts the app changes
  the installed build so that a browser with a window adds a tab to it instead (`openPagesInTabs` in
  `backend/domains/browser/juggler.ts`).
- **A mouse event the page does not take.** The browser can lose a mouse event that Playwright sends:
  one on the first or the last row of the page (an event aimed there goes one row further in), and
  one that arrives while a tab moves to another process, which Firefox does when a tab opens or
  leaves a site it keeps apart (a new tab whose start page is Google, a link from Google to another
  site). The Camoufox build that camoufox-js installs then takes no other such event, in any tab,
  until that tab closes. Before the first browser starts, the app changes the installed build so that
  it gives up on such an event after a second (`boundInputWaits` in the same file): the mouse of the
  AI tools pauses and goes on. Should the browser still stop taking it (an event it has not done five
  seconds after its page was free: no dialog waiting for an answer, no script keeping it busy), the
  tools say so, and restarting the session brings it back. Your own mouse, in the window, does not go
  through Playwright.

**Tabs are remembered.** A session that you stop (or whose browser dies, or that is stopped by
Rotate IP or by quitting the app) opens the same tabs again when it starts, in its window; the one
you last used is active. When its last page closes (its last tab in its last window: a popup counts),
the session ends and opens the start page next time.

### Secrets

The **Secrets** section stores what you type into pages again and again. Each secret is one of:

- **Personal information**: name, email, phone, address, company and company address,
- **Credentials**: website, username and password,
- **Credit card**: cardholder, card number, expiry and CVC,
- **Note**: any text,

and any kind can have values you add yourself. A secret is available **to every session** or **to
one session**; a session's own secrets are deleted with it, and the delete dialog says so.
Passwords, card numbers and CVCs are masked in lists and in the form until you show them, and so
is a value whose label names something private (`PIN`, `token`, `API key`, `recovery`, …) or whose
text is a payment card number (that one from when it is saved). The form asks nothing about it, and a
stored value stays hidden or shown as it was stored when the secret is changed. Lists show a preview
without masked values (a card shows the last four digits of its number). Every value has a copy
button in the details of a secret. The table searches and narrows by type and by session (**Filter**); what you chose stays in the
address (`/secrets?type=&scope=&q=`). Limits: a title of 120 characters, 40 values, a label of 60
characters, a value of 20,000.

### Fingerprints and isolation

Every session is a separate browser process with its own profile directory, so cookies,
`localStorage`, IndexedDB and the cache are never shared. When you create a session, the app draws
its fingerprint once and stores it, together with everything else Camoufox would draw at random at
every launch (font spacing, audio and canvas seeds, the WebGL pair, the history length), so each
relaunch looks the same. The fingerprint holds the user agent and platform, the screen and window
geometry, the fonts, the WebGL vendor, renderer and parameters, the number of CPU cores and the
canvas and audio seeds. A new fingerprint is drawn again if its visible attributes match an
existing session. The screen is at most the room for windows on the largest display of this
computer (or `SESSION_MANAGER_MAX_SCREEN`), so that the session's window, which is as large as the
fingerprint says, fits there.

**Where a session says it is.** Its time zone, geolocation (coordinates), WebRTC address and
language are those of the IP its proxy exits through. The app looks that IP up when the session
starts (the exit IP is checked right before, through the proxy) and keeps what it found:

- **It always fits the exit IP.** At every start the place is derived from the exit IP as it is
  then.
- **It stays the same.** The place is kept for as long as the exit IP is the same: every start
  reports exactly the same place, even after the GeoIP database was updated. It is derived again
  only for another exit IP: another proxy (Rotate IP), or the same proxy exiting somewhere else.
- **The language** is chosen at the first start: one of the exit IP country's official languages
  that Firefox is available in, picked at random and weighted by the number of speakers. It is
  kept as long as the country is the same.
- **Mismatches are noticed.** While a session runs, the app looks at its proxy's exit IP again 30
  seconds after the start and then every 5 minutes (also when you choose **Check IP**, in the
  session's menu or its details, or **Check** the proxy). If the proxy exits through another IP now,
  the IP at the top of the session turns amber, a bar says so, and the list shows **IP changed ·
  restart recommended**. **Restart session** in the bar asks first, then closes the browser and opens
  it again with the same proxy and tabs, with the place of the new IP. A proxy that changes its IP
  all the time can never match: use one with a fixed IP.

A page that asks for the position (on an `https` or a `localhost` address: Firefox refuses the
others) gets the coordinates of the exit IP at once, without a question in the window; the
permission stays "prompt", as in a browser whose person was never asked.

### WebRTC

By default, WebRTC stays available, as in a normal Firefox: Camoufox is told the proxy's exit IP
as the WebRTC address (a page does not get to see it), and `media.peerconnection.ice.proxy_only` is
set. Without it, a connection created in an iframe or popup sends STUN packets around the proxy
and reveals your real IP. `SESSION_MANAGER_BLOCK_WEBRTC` removes `RTCPeerConnection` entirely. That
is safest, but sites can detect it.

### Known limits

- **Fonts in the first moments of a browser on macOS.** On a macOS host, the first canvas text a
  browser process measures starts setting up its font list, which takes a fraction of a second.
  Until then Camoufox resolves the generic families (`monospace`, `sans-serif`, `serif`) to a
  fallback font, so a page that measures at that instant reads other base metrics, and draws its
  text canvas differently, than the same session a moment later. The identity is the same; only
  the timing differs. The real-browser tests compare these two reads between restarts on other
  hosts only.

## Where data lives, and what never leaves the machine

| What                                                               | Where                                            | Private how                                                                                                                                  |
| ------------------------------------------------------------------ | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Proxies with their passwords, secrets, sessions, settings (SQLite) | `<data dir>/manager.db`                          | mode `0600`, also for a file that was there with other rights; values are stored in plain text, and a deleted one is overwritten in the file |
| One browser profile per session: cookies, storage, history, cache  | `<data dir>/profiles/<session id>/`              | inside the data directory, which is set to `0700` at every start                                                                             |
| The browser and the GeoIP database                                 | `<data dir>/camoufox`, or `CAMOUFOX_INSTALL_DIR` | not private: nothing in them is yours                                                                                                        |
| Theme and language                                                 | `localStorage` of the browser showing the page   | never reaches the server                                                                                                                     |

Proxy passwords and secrets sit in `manager.db` in plain text, readable by your user and by every
program that runs as you; protect them the way you protect the disk (full-disk encryption, a locked
account). The database is this program's alone: it carries an application id, and a database any
other program made is refused and left untouched. Keep proxy lists out of the repository: git
ignores `data` and `.env` here, but not `*proxies*.txt`.

Each Camoufox build the app launches stays in `browsers/official/<build>` inside the install
directory. A new build (after a `camoufox-js` update) adds about 1.2 GB and nothing removes the old
one: delete the older ones while no session is running, and keep the one that the `config.json` in
that directory names. The app changes one file of the build it launches, `omni.ja` (see [Using a
session](#using-a-session): the tabs a session reopens, and a mouse event the page does not take),
and keeps the file as it came next to it as `omni.ja.orig`. Before a browser starts, the app deletes the compiled copies of the
browser's scripts that its profile keeps (`startupCache/`, which Firefox makes again) unless they
were made from the `omni.ja` it starts with, which it notes in the profile
(`session-manager-scripts.json`).

The app sends nothing to Tale or to any analytics or error-reporting service, and nothing about
you to any account, because there are none (the `UMAMI_*` variables that the other Tale services
read are ignored here). It talks to the network in these places only:

- **Proxy checks.** Each check asks the exit-IP services above through the proxy under test; the
  services see the proxy's address, the proxy sees the request and its credentials.
- **First-use downloads, made directly, not through a proxy.** The Camoufox build from the GitHub
  releases of `daijro/camoufox`, the GeoIP database from the GitHub releases of
  `P3TERX/GeoLite.mmdb` (again at start when the file is older than eight days) and the uBlock
  Origin add-on from `addons.mozilla.org` at the first launch. The database comes from a third-party
  mirror and the add-on as `latest`, neither with a checksum; the browser archive is checked against
  the digest GitHub reports, when it reports one.
- **The browsers.** Everything a session loads goes through that session's proxy, including
  Firefox's own background requests (update checks, filter lists) and addresses on your computer
  (`localhost`, `127.0.0.1`), so a page in a session cannot reach the services of your machine.
  Expect some bandwidth use on metered proxies.

## Security model

There is no login, so the defences are about who can reach the address:

- **Loopback by default.** The server binds `127.0.0.1`. Binding any other interface puts an app
  without a login on a network. Every user account on the computer can reach a loopback address,
  and so can every program that runs as it.
- **Host check.** Every request, to the page, the API and `/mcp`, must address the app as `127.0.0.1`, `localhost` or `SESSION_MANAGER_HOST` on `PORT` (or a value of
  `SESSION_MANAGER_ALLOWED_HOSTS`). Anything else is `403 forbidden_host`, which blocks DNS
  rebinding.
- **Origin check.** A request that changes something (`POST`, `PUT`, `PATCH`, `DELETE`) must not
  carry a foreign `Origin`, and a body must be `application/json`; a cross-site form can only send
  form encodings or `text/plain` without a preflight. Both refusals are `403 forbidden_origin`. The
  page's own origin is `http://<host>`: the app is served over plain HTTP on this computer, so an
  `https://` origin is foreign too. A browser also says who started a request (`Sec-Fetch-Site`):
  the API and `/mcp` answer only the page itself and the person (`same-origin`, `none`), and another
  site or another origin of this computer (`cross-site`, `same-site`) gets the same `403` for any
  method, so that a page which may not read an answer cannot make the browser fetch the proxy export
  either. A program sends neither header and is not asked; the page's own files answer to a link
  from any site, after the Host check.
- **AI access is off by default**, and only the person at the page can switch it on: the switch is
  not an MCP tool. A connected assistant can use every session and read every secret, including
  passwords and card numbers, so the switch asks for a decision. While it is off, `/mcp` answers
  `403 ai_access_off` before it reads the request, and switching it off ends what is under way: the
  messages of a batch that have not run yet and a tool that is waiting answer the same error.
- **A browser does not inherit your secrets.** Each browser starts with the app's environment minus
  the variables whose names hold `token`, `secret`, `password`, `credential` or `key`, so a page that
  exploits the browser cannot read a CI token or a cloud key from it.
- **Passwords stay out of answers.** The proxy API returns `hasPassword`, never the password; error
  messages and the import report mask credentials. The exceptions are the proxy export (the
  download in the page and the `export_proxies` tool). A secret's masked values are returned for
  one secret at a time (`GET /api/secrets/{id}`, which the page calls when you open it, and the
  `get_secret` tool); the lists carry previews only.
- **Headers.** Every response carries the shared Tale security headers: a Content-Security-Policy
  with `default-src 'self'`, `frame-ancestors 'none'` and `object-src 'none'`, `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, a strict referrer policy, `Cross-Origin-Opener-Policy` and
  `Cross-Origin-Resource-Policy` `same-origin`, a `Permissions-Policy` that denies camera,
  microphone and geolocation to the page. `/api/*` answers are never cached.

`/api/health` answers `{ "status": "ok", "version": … }` without the Host check, for a supervisor.

## HTTP API in brief

The page and the MCP tools use the same API, under `/api`, as JSON with camelCase names.
[`lib/api/schemas.ts`](lib/api/schemas.ts) holds every request and response as a zod schema; the
routes, the page's client and the MCP tools share it. An error is answered as
`{ "error": "<code>", "message": "…", …extra }` with the code stable and the message in English; the
codes and how to provoke each one are in
[`tests/manual/reference/error-codes.md`](tests/manual/reference/error-codes.md). A body that fails
its schema is `422 validation_error` with `issues` (where and why, never the value), and a body over
1 MiB is refused with `413` before it is read in full (`validation_error` on the API, a JSON-RPC
`-32600` on `/mcp`). Every list answers newest first. The session and proxy lists take `limit` (1-500), `before` (the ids below it:
the next page) and `minId`, and carry `X-Total-Count`; the secrets list has no paging and no count.

The extra fields are for the client to act on (the session that holds a proxy, the exit IP two
sessions share) and, for five codes, for the page to word its own sentence with. They are plain
strings and numbers: `reason` and `proxyId` for `proxy_unreachable` (the proxy check's own words,
in English and without a password, and the proxy), `reason` for `unknown_ip_location` and for
`browser_error` (what the session's browser could not do, in its own words), `failed` for
`no_working_proxy` (how many proxies failed their check, only when above none) and `doing` for
`session_busy` (`assigning_proxy`, `starting` or `stopping`; missing for any other kind of busy).
`no_working_proxy` and `unknown_ip_location` are never an HTTP answer: they are what a session fails
with in the background, and reach the page as the session's `errorCode` with the same fields in
`errorExtra` (a string-or-number map, or `null`), as does `proxy_unreachable` when a start is
refused. The page words the sentence from the code and those fields (`messages/*/errors.yml`);
`message` stays the English sentence for API and MCP clients.

| Route                                                                         | Does                                                                                                                           |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/meta`                                                               | version, browser state, counts, the next session name, the kinds of secret                                                     |
| `GET`, `PATCH /api/settings`                                                  | `startPage` (blank: the default), `mcpEnabled`; the answer adds `defaultStartPage`                                             |
| `GET`, `POST /api/secrets`; `GET`, `PATCH`, `DELETE /api/secrets/{id}`        | list (`kind`, `scope`: `all`, `global` or a session id, `includeGlobal`), create, read, change, delete                         |
| `GET`, `POST /api/proxies`; `POST /api/proxies/import`                        | list, add one (`201`), import a list                                                                                           |
| `POST /api/proxies/check-all`; `POST /api/proxies/{id}/check`                 | start checks (`202`); the result is on the proxy                                                                               |
| `DELETE /api/proxies/{id}?force=`                                             | `409 proxy_busy` for a running session's proxy, `409 proxy_in_use` without `force`                                             |
| `GET`, `POST /api/sessions`; `GET`, `PATCH`, `DELETE /api/sessions/{id}`      | list, create and start (`201`), read, rename, delete                                                                           |
| `POST /api/sessions/{id}/start` (`{ force }`), `/stop`, `/restart`, `/rotate` | `202` with the session as it is; the work goes on, so poll `status` and `activity`                                             |
| `POST /api/sessions/{id}/check-ip`                                            | looks at the proxy's exit IP now (`location.inSync`)                                                                           |
| `POST /api/sessions/{id}/show`                                                | brings the window of a running session to the front (`204`)                                                                    |
| `POST /api/sessions/{id}/type` (`{ text }`)                                   | types a value of up to 20,000 characters where the focus of its window is (`204`; `409 no_field_focused` when no field has it) |
| `GET /api/sessions/export-proxies`                                            | the proxy file, with passwords, as a download                                                                                  |
| `POST /mcp`                                                                   | the [MCP endpoint](#ai-access-mcp)                                                                                             |

## AI access (MCP)

With **Settings**, **AI access**, **Allow AI assistants to connect** switched on, an assistant can
use Session Manager over MCP. The address is `/mcp` on the origin that serves the page, for example
`http://127.0.0.1:3004/mcp`; the page shows the exact command or configuration for each client
and copies it for you:

```bash
claude mcp add --transport http session-manager http://127.0.0.1:3004/mcp   # Claude Code
```

Cursor, Windsurf and most other assistants take an `mcp.json` entry,
`{ "mcpServers": { "session-manager": { "url": "http://127.0.0.1:3004/mcp" } } }`. Claude Desktop
starts servers as programs, so it goes through `npx -y mcp-remote http://127.0.0.1:3004/mcp --allow-http`
(it needs Node.js).

The server speaks JSON-RPC 2.0 over Streamable HTTP in its stateless form: `POST` only, JSON answers
(no event stream, so with AI access on a `GET` is `405`), batches of up to 20 messages, protocol
revisions `2025-11-25`, `2025-06-18` and `2025-03-26`. There are 43 tools; an assistant can do
everything the page does, except switch AI access. A test fails when a route of the API has no tool.

| Group                            | Tools                                                                                                                                                                                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview and settings (3)        | `overview`, `get_settings`, `set_start_page`                                                                                                                                                                                                                  |
| Sessions (11)                    | `list_sessions`, `get_session`, `create_session`, `start_session`, `stop_session`, `restart_session`, `rotate_session_ip`, `check_session_ip`, `rename_session`, `delete_session`, `export_proxies`                                                           |
| Proxies (5)                      | `list_proxies`, `add_proxies`, `check_proxy`, `check_proxies`, `delete_proxy`                                                                                                                                                                                 |
| A running session's browser (18) | `show_window`, `list_tabs`, `open_tab`, `switch_tab`, `close_tab`, `navigate`, `history`, `read_page`, `screenshot`, `click` (also right and double click), `hover`, `drag`, `type_text`, `press_key`, `scroll`, `get_selected_text`, `handle_dialog`, `wait` |
| Secrets and notes (6)            | `list_secrets`, `get_secret`, `type_secret`, `create_secret`, `update_secret`, `delete_secret`                                                                                                                                                                |

`get_secret` and `export_proxies` return passwords and card numbers, so they carry no read-only
hint: a client that runs read-only tools without asking still asks for these two.

A session is meant by its name (`0001`, in any case) or its id: a JSON number is always an id, and a
text is a name first and an id only when it is all digits and no session has it for a name.
`read_page` returns the address, title, visible text and the buttons, links and fields in view, each
with a number; `click` and `type_text` take that number (or `click` a position in the `screenshot`),
and `read_page` says when a page did not load and why. A page that opens a dialog (`alert()`,
`confirm()`, `prompt()`) does not respond until it is answered: the tool that caused it returns at
once and says so, and `handle_dialog` answers it. `type_secret` types one value of a secret into the
page without showing it to the assistant (a session's own secret only in that session). It keeps a
value out of the transcript; it is no boundary against an assistant that may also call `get_secret`,
or make a secret available to every session with `update_secret`, and a credential is not tied to
the website it is for. What a page says (its text, the addresses and titles of its tabs, a dialog, a
selection) is untrusted data from a website: the tools return it between a BEGIN UNTRUSTED PAGE
CONTENT line and an END UNTRUSTED PAGE CONTENT line that carry the same random code, which a page
cannot know, and the server's instructions tell the assistant to follow no instruction in it and
never to type or reveal a secret because a page asks for one. You can watch the assistant work in
the session's window and take over at any time (`show_window` brings it to the front, for a login
or a check that needs a person). Connect only assistants you trust.

## Architecture

```text
server.ts                   the entry: starts everything, closes it on SIGINT, SIGTERM and SIGHUP
backend/
  main.ts                   the composition root: store, browser backend, manager, the two surfaces
  app.ts                    the Hono app: security checks, /api routes, the door to /mcp, error answers
  config.ts, security.ts    the environment; the Host and Origin checks
  startup-failure.ts        the one line a start gets that fails for a reason of the person's: a port,
                            a directory, a database another program made
  shutdown.ts               the stop on a signal: graceful, with a deadline; a second signal ends it
  errors.ts                 AppError(status, code, message, extra) → { error, message, …extra }
  db/store.ts               SQLite (bun:sqlite): one connection, used from the event loop only
  domains/
    sessions/               manager.ts (the interface), service.ts (the rules), assignment.ts (which
                            proxy a session gets), runtime.ts (the lifecycle of each browser),
                            refusals.ts (every refusal), names.ts, routes.ts
    proxies/                parsing, exit-IP checks, the credential bridge, routes
    secrets/, settings/, meta/    the vault and its limits; the preferences; /api/meta
    identity/, browser/     fingerprints and the GeoIP place; Camoufox, its install, the environment
                            its browsers get, the changes to its build (juggler.ts), the window of a
                            session (window.ts) and the remote the AI tools drive it with
    mcp/                    the JSON-RPC endpoint and its 43 tools (untrusted.ts frames what a page says)
  lib/                      the backend's small tools: http-input, web-url, abort, mutex, debug, error-text, casefold
  testing/                  fakes and the harness the tests share (not shipped)
lib/                        what the backend and the page share: api/schemas.ts, the limits of secrets,
                            proxies and session names, is-record.ts, private-label.ts, i18n
app/
  routes/                   TanStack Router file routes (routeTree.gen.ts is generated)
  features/<feature>/       sessions, session-viewer, proxies, secrets, settings: components/, hooks/, lib/
  components/layout/        the rail, the phone's tab bar, the banners, the skip link
  hooks/, lib/              what the features share: the mutation hook, the polling pace, the page title,
                            the address a search is kept in; lib/api/ is the typed client, endpoints,
                            query keys and the words of a failure
messages/{en,de,fr}/        one YAML file per topic and language
scripts/dev.ts              the development fleet (Vite and the backend)
tests/                      e2e/ (Playwright specs and helpers, the launcher and the fakes' control server),
                            guards/ (checks of how the service is put together), manual/ (the manual
                            layer), utils/ (what the page's tests share)
```

**How a request flows.** `server.ts` calls `startServer` (`backend/main.ts`), which hands `/api/*`
and `/mcp` to the Hono app and everything else to the shared static server of `@tale/ui/server`.
For a page request the server checks the `Host`, then serves a file from `dist/` or the shell of
the single-page app. For an API request `localOnly` checks `Host`, `Origin` and the body's media
type; the route reads its input through `parseBody`, `parseQuery` and `pathId` (a zod failure is a
422); it calls the `Manager`, which applies the rules under a lock per session and talks to the
store, to `SessionRuntime` (one background task per start: assign a proxy, derive the place,
launch) and to the browser backend; the route answers with the session as it is, and the work goes
on. An `AppError` becomes `{ error, message, …extra }` with its status; anything else is logged and
answered as `500 internal_error`. `/mcp` checks the AI-access switch, then calls the same
`Manager` and the session's `Remote`.

**Add an API route.** Put the request and response in `lib/api/schemas.ts`; add the method to
`Manager` (`domains/sessions/manager.ts`) and its rule to `service.ts`; add the route to the
domain's `routes.ts`, reading input through `http-input.ts`; add the call to the page's
`app/lib/api/endpoints.ts`. Give it an MCP tool whose `routes` names it: `tools.test.ts` fails for
a route no tool mirrors. Cover it with a route test, a flow test and `backend/contract.test.ts`.

**Add an MCP tool.** Define it with `defineTool` in the right `domains/mcp/tools-<group>.ts`: a
strict zod object for its arguments, the `routes` it mirrors, `READ_ONLY` or `DESTRUCTIVE` where
true, and a description written for the model that reads it. Add its name to `MCP_TOOL_NAMES`
(`tool.ts`) and to `TOOL_GROUPS` (`app/features/settings/lib/tools.ts`);
`tests/guards/tool-names.guard.test.ts` keeps the two lists and the backend's catalog in step. Update
the table above.

**Add a UI feature.** Create `app/features/<feature>/{components,hooks,lib}` and a route file under
`app/routes/` (run the dev server or the build once to regenerate `routeTree.gen.ts`); add the
section to `app/hooks/use-nav-items.ts` if it needs a place in the rail. Talk to the backend
only through `app/lib/api` (`useApiMutation` for writes: it refreshes what changed and raises one
failure toast). Write the texts in `messages/{en,de,fr}/<topic>.yml`, test next to the code, and
give the behaviour a box in `tests/manual/suites/` unless a spec owns it end to end.

**Add an error code.** Throw `new AppError(status, 'my_code', 'English sentence', extra)` (a start
that fails in the background uses `StartError`). Add `my_code` to `messages/en/errors.yml` and its
`de` and `fr` sentences: `tests/guards/error-codes.guard.test.ts` reads the backend's source for every
code and fails for a code without a sentence and for a sentence without a code. It sees codes made
by `new AppError(…)`, `new StartError(…)`, the two of `security.ts` and an answer written as a literal
`{ error: '…', message: … }`; the four sentences the page makes itself (`network`, `server_error`,
`bad_answer`, `fallback`) are its own. Then list the code in `tests/manual/reference/error-codes.md`
with how to provoke it.

A code whose sentence can say more when the answer names a cause, a count or an activity has a
**variant sentence** besides its plain key, `<code>_<what>`: `proxy_unreachable_reason`,
`no_working_proxy_failed`, `unknown_ip_location_reason` and the three `session_busy_*` are the
existing ones. Put the extras in `refusals.ts` as plain strings and numbers, list the variant under
its code in `VARIANTS` in the guard, add it to the three catalogs, and choose it in
`app/lib/api/failure.ts` with one literal `t('…')` per sentence; the plain sentence stays for
answers that carry nothing (older data, AI clients). The guard fails for a variant that is missing
from the catalog, for one nobody listed (dead text in three languages) and for one named like a
real backend code (shown as a code of its own it would print its placeholders).

## Test and develop

Four lanes, each with its own command, run from the repository root:

| Lane                          | Command                                                                           | What it proves                                                                                                                                                                                                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Server (`*.test.ts`)          | `bun run --filter @tale/session-manager test`                                     | The backend and `lib/` under Bun (vitest): rules, routes and MCP over real sockets with fake browsers, the page's API client against the real backend, the guards. No browser, no network.                                                                                     |
| UI (`app/**/*.test.{ts,tsx}`) | `bun run --filter @tale/session-manager test:ui`                                  | Components and hooks in jsdom against a fake API: states, flows, keyboard, copy, axe checks.                                                                                                                                                                                   |
| Real browser                  | `CAMOUFOX_INSTALL_DIR=<dir> bun run --filter @tale/session-manager test:camoufox` | Opt-in. Headless Camoufox through local test proxies: identities resolve to the same config at every launch, a place and language fit the IP, keys, mouse, typing into the focused field, dialogs, tabs restored. Skips without an installed browser; nothing leaves the host. |
| Playwright (`tests/e2e`)      | `bun run --filter @tale/session-manager test:e2e`                                 | The built page under the server's own headers, in Chromium, in parallel: the real HTTP stack and MCP over a fake browser and a fake exit-IP checker. Not the real browser, and no window.                                                                                      |

The windows themselves, a window coming to the front and a value typed into the field clicked in it,
are for a person to judge: [`tests/manual/suites/windows.md`](tests/manual/suites/windows.md).

Install the browser for the third lane once into a directory of your own, for example
`CAMOUFOX_INSTALL_DIR=$PWD/.camoufox-tests bunx camoufox-js fetch` from the service folder (the
folder `.camoufox-tests` is git-ignored). Some of its assertions are about timing: run it with
nothing heavy beside it.

The Playwright lane (several hundred specs in `tests/e2e/specs/`) builds the page, unless
`E2E_USE_BUILD=1` says it is built or `E2E_DIST_DIR` names one built elsewhere, and starts
`tests/e2e/launcher.ts`, which runs one isolated test server per worker in a single process, or reuses
servers already listening. Worker `i` talks to the backend on `E2E_BACKEND_PORT + i` (3204 to 3207
with the default four workers) and to its control server on `E2E_CONTROL_PORT + i` (default the
backend's port + 1000, so 4204 to 4207), and never to another's. Each server runs the whole backend on
a throw-away data directory with fakes of its own: a session starts after 400 ms, a proxy check takes
150 ms, and a proxy exits through `203.0.113.<last octet of its host>` in Germany. Its control
server lets a spec, or a person, open a dialog in a page, crash a browser, make a proxy check fail
or slow, and read what the fake browser was told (a window brought forward, a value typed)
(see [`tests/manual/setup.md`](tests/manual/setup.md)). Specs import `test` and `expect` from
`tests/e2e/helpers/fixtures.ts`, which empties the worker's server before each one (the tests are
spread over the workers one by one, so none may depend on the one before it) and hands the spec the
server's address as the `server` fixture (`index`, `port`, `controlPort`, `origin`, `controlUrl`;
`baseURL`, the `request` fixture and every `browser.newContext()` open at it too), so a spec never
computes a port (`tests/e2e/isolation.guard.test.ts` holds that); the `api` fixture sets a scene up
through the manager's API and the `control` fixture drives the fakes. They resolve every label through
`t('topic.key')` instead of writing English, and use the named budgets of `helpers/env.ts`. In CI the
job runs the default four workers over the page the build job restored (`E2E_USE_BUILD=1`) and has 25
minutes.

| Setting               | Default                  | Meaning                                                                                                                                                                         |
| --------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `E2E_WORKERS`         | 4, or the cores if fewer | Workers, and servers: one each. `1` runs the suite serially on one server.                                                                                                      |
| `E2E_SERVERS`         | the workers              | Servers the launcher starts, at least the workers: `bun tests/e2e/launcher.ts` by hand, then run Playwright against them.                                                       |
| `E2E_BACKEND_PORT`    | `3204`                   | First backend port: server `i` listens on it + `i`. Another range keeps a run away from a dev server or someone else's (`3260` takes 3260 to 3263).                             |
| `E2E_CONTROL_PORT`    | backend port + 1000      | First control port, likewise. The two ranges must not overlap.                                                                                                                  |
| `E2E_USE_BUILD`       | unset                    | `1`: the page is built already (CI restores it through Turbo); nothing is built before the servers start.                                                                       |
| `E2E_DIST_DIR`        | the service's `dist/`    | Serves a page built elsewhere (`bunx --bun vite build --outDir /tmp/page`), so a run leaves `dist/` alone. Builds nothing.                                                      |
| `E2E_BASE_URL`        | unset                    | Opens the page through a Vite dev server in front of one backend (`bun run dev` on 3004, `bun tests/e2e/server.ts` behind it). One place to go, so one worker: `E2E_WORKERS=1`. |
| `E2E_APP_PORT`        | `3004`                   | The port of the dev server the page may be opened through: the backend also answers the `Host` values that name it.                                                             |
| `E2E_LAUNCH_DELAY_MS` | `400`                    | How long the fake browser takes to start a session, so that **Starting** can be seen.                                                                                           |
| `E2E_CHECK_DELAY_MS`  | `150`                    | How long a fake proxy check takes to answer.                                                                                                                                    |

One server alone is `bun tests/e2e/server.ts`, which the manual layer uses (`E2E_BACKEND_PORT` and
`E2E_CONTROL_PORT` mean the one server's two ports there). A spec that fails with four workers and
passes with one depends on load or order: rerun it alone with `E2E_WORKERS=1 bun run test:e2e <file>
--repeat-each=5` to tell.

What no lane can judge, a person judges with the [manual layer](tests/manual/readme.md): the feel
of typing and scrolling, layout at every width, a screen reader's pass, what a page that checks
your fingerprint reports, and degraded modes. `bun run lint:manual` checks its shape.

Before you submit a change, from the repository root:

```bash
bun run --filter @tale/session-manager typecheck
bun run --filter @tale/session-manager lint
bun run --filter @tale/session-manager test
bun run --filter @tale/session-manager test:ui
bunx oxfmt --check
bun run lint:manual
bun run lint:links
bun run lint:conflicts
```

`bun run check` runs the repository's whole gate.

### Languages

Every text ships in English, German and French in the same change. The files are
`messages/<locale>/<topic>.yml`, one per topic (`navigation`, `banners`, `errors`, `sessions`,
`viewer`, `proxies`, `secrets`, `settings`) with the same keys in every language; the topics are
declared in `lib/i18n/types.ts`. Address the reader informally, `you`, German `du` and French `tu`,
and follow [`write-translations`](../../.agents/skills/write-translations/SKILL.md). Name a topic
literally where it is read (`useT('proxies')`) and a key as a literal string, so the usage check
sees it. Counts are ICU plurals. A plain YAML value that contains a colon and a space (`: `) or a
space and a hash (` #`) is read as a mapping or a comment and breaks the whole catalog: put it in
double quotes. `errors.yml` holds one sentence per error code of the backend, and the four the page
makes itself. Run `bunx --bun vitest --run lib/i18n` after any change to a message: it checks that
the three languages have the same keys, that every key is used and defined, and that the ICU
arguments match.
