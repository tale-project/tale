# Real-browser realism

> **Prefix** `REAL-` · **Reset** once, at the start · **Cost** ~2 h, plus two hours of waiting for `REAL-P3`

Whether the Camoufox that a session launches is the one it says it is, and whether anything about
you gets past the proxy. The real-browser lane proves that a launch resolves to the stored identity
and the pinned place, on local test proxies and without the internet
([`../reference/automation.md`](../reference/automation.md)). This suite judges with other
people's eyes: fingerprint and leak test pages, real exit IPs, real sites, and a computer that has
to carry several browsers at once. It needs **stack B, real proxies and the internet**, and it
leaves traces in the logs of the sites it visits: use throw-away accounts and throw-away sessions.
**The groups up to "What stays and what does not" share their sessions: run them in order the first
time.**

## Preconditions

Stack B on a fresh data directory with AI access off ([`../setup.md`](../setup.md)), a 1440×900
viewport, devtools open on the Network panel. The proxies of the round, each with its own exit IP
(see [Proxies for a real round](../setup.md#proxies-for-a-real-round)):

| Name | What it is | Used by |
|---|---|---|
| `home` | an HTTP proxy that exits in your own country | most boxes |
| `abroad` | a working proxy that exits in another country, with another time zone | `REAL-F6`, `REAL-F7` |
| `abroad2` | a second proxy in the country of `abroad`, with another exit IP | `REAL-F7` |
| `auth` | an HTTP or HTTPS proxy with a username and a password | `REAL-F13`, `REAL-F14` |
| `socks` | a SOCKS5 proxy, with credentials if you can | `REAL-F12`, `REAL-F13` |

Pages to use; any equivalent will do, these are public examples whose behaviour is known:

| For | Example |
|---|---|
| what the browser says about itself | `https://browserleaks.com/javascript` (user agent, platform, screen, window, time zone, language) |
| canvas, WebGL and audio hashes | `https://browserleaks.com/canvas`, `https://browserleaks.com/webgl`, a page that prints an audio-context hash |
| WebRTC | `https://browserleaks.com/webrtc` |
| IP, IPv6 and DNS | `https://browserleaks.com/ip`, `https://test-ipv6.com`, `https://dnsleaktest.com` (the extended test) |
| the exit IP as plain text | `https://ifconfig.me/ip`, `https://ipinfo.io/ip` |
| a login that sets a cookie | `https://the-internet.herokuapp.com/login` (the page prints its test credentials) |
| a page that keeps its data in `localStorage` | `https://todomvc.com/examples/react/dist/` |
| automation checks | `https://bot.sannysoft.com` |
| an ad-blocker test | `https://d3ward.github.io/toolz/adblock.html` |

> **Agent note**: an assistant can read these pages for you. With AI access on
> ([`settings.md`](settings.md)), `navigate` to a page and `read_page` returns its text, which holds
> the values a details page prints; `get_session` returns the session's `fingerprint` and
> `location`, the same as `GET /api/sessions/{sessionId}`. A script cannot read the picture. The
> manager's PID for `lsof` is the one you started it with (`$!`). **Switch AI access off again**
> when the box is done.

## Who the browser says it is

- [ ] `REAL-F1` · **Add three sessions named `win`, `mac` and `lin` with Operating system set to
  Windows, macOS and Linux (`sessions.add.system`, `sessions.add.os.*`), each on a proxy of its own,
  start them and open the details page in each** → the user agent names the system chosen (Windows NT, Macintosh, X11 with
  Linux) and the platform agrees (Win32, MacIntel, Linux x86_64); the screen is no larger than
  `SESSION_MANAGER_MAX_SCREEN` (1920×1080 unless you set it); every value the page prints for user
  agent, platform, screen and language is the one in the `fingerprint` of the session's record.
- [ ] `REAL-F2` · **In each of the three read the window size and the pixel ratio the page reports,
  then make the manager's window smaller and larger, zoom the manager with ⌘+ and ⌘−, and reload the
  details page** → the page reports the same screen, window size and pixel ratio before and after
  (the size is what the fingerprint says, never the size of your window); only the picture is scaled
  to fit.
- [ ] `REAL-F3` · **Open the canvas, WebGL and audio pages in `win`, `mac` and `lin` and write down the
  hashes; then Stop and Start `win` and read them again** → the canvas hashes and the audio hashes
  of the three sessions all differ; after the restart `win` gives exactly the hashes it gave before; the WebGL
  vendor and renderer are the GPU of the session's record (`fingerprint.gpu`) and fit its system (no Apple GPU
  on a Windows session, no Direct3D on a Linux one); a WebGL image hash that is the same in every session
  is the computer's GPU drawing it and is noted in the log, not filed, unless the canvas hash is the same too.
- [ ] `REAL-F4` · **Add five sessions with Operating system set to Windows, start them and compare what
  the details page and the canvas page print in each** → no two of them print the same set of values, and no
  two share a canvas or an audio hash; the app redraws a fingerprint whose visible attributes match
  another session's, so the five differ in something a page can read.
- [ ] `REAL-F5` · **Open an automation-check page in `win`, `mac` and `lin` and read what it flags** →
  nothing contradicts the session's own identity (user agent, platform, screen, language, time zone
  and GPU agree with each other and with the record); `navigator.webdriver` is false or absent and
  no row calls the user agent headless; anything else a page flags goes in the log with the page's
  name, and is a finding only where it contradicts the record.

## Where the browser says it is

- [ ] `REAL-F6` · **Start one session on `home` and one on `abroad`, and open the details page and
  the two IP pages in each** → each page shows the exit IP that the session's header shows and that
  the proxy's row on Proxies shows, and not your own; the time zone name and offset are those of the
  country of that IP (the `abroad` session's clock is the time there now); the language is one of
  the country's official languages that Firefox ships in (`de-CH`, `fr-CH` or `it-CH` for
  Switzerland, never a regional one); all of it equals `location.timezone`, `location.country` and
  `fingerprint.locale` of the session's record, and the session's details (press the exit-IP button in the
  header: Language, Time zone, Location) say the same, with the note naming the IP they are taken from ("The
  language, time zone and location are taken from {ip}, the proxy's exit IP when the session started.").
- [ ] `REAL-F7` · **With `abroad2` as the only free working proxy, choose Rotate IP on the session on
  `abroad`; then, with `abroad` as the only free one, choose Rotate IP on the session on `home`; read
  the details page after each restart** → the rotation within one country keeps the language and
  sets the place of the new exit IP; the rotation to another country gives that country's time
  zone and a language of that country; each record, the session's details (Operating system, Screen,
  Language, Time zone, Location, Exit IP) and the page agree after each restart.
- [ ] `REAL-B1` · **Start a session on a proxy that changes its exit IP over time (a rotating gateway),
  and leave it for the first re-check, 30 seconds after the start, and for the next ones, every five
  minutes** → when the exit IP is not the one the session started with, the exit-IP button in the header
  turns amber with a warning sign (a screen reader hears "The proxy now exits through another IP."), a bar
  says "The exit IP has changed" with the IP it exits through now and the one the session still reports, and
  the list row reads **IP changed · restart recommended**; **Restart session** in the bar, confirmed with
  Restart session in the dialog that asks (`viewer.place.restart`), restarts with the same proxy and tabs and
  the place of the new IP; with a proxy that changes at every request the bar returns and its hint says to
  use one with a fixed IP.

## What leaks

- [ ] `REAL-F8` · **In a session on `home` open the two plain-text IP pages, then run `curl -s
  https://ifconfig.me/ip` from your own computer** → both pages print the proxy's exit IP, the
  same as the header, and neither prints the address `curl` printed; no IPv6 row of the IP page
  shows an address of yours.
- [ ] `REAL-F9` · **Open the WebRTC page with the default settings** → the page lists no address of
  yours: no local network address (192.168.x.x, 10.x.x.x, fe80::) and no public one; a public
  address it lists is the proxy's exit IP; WebRTC is reported as available, as in a normal Firefox.
- [ ] `REAL-F10` · **Stop the manager, start it with `SESSION_MANAGER_BLOCK_WEBRTC=1`, start a
  session and open the WebRTC page** → the page reports that WebRTC is not available and lists
  nothing; every other page still works; starting the manager without the variable and restarting the
  session brings WebRTC back.
- [ ] `REAL-F11` · **Open an IPv6 test page in a session whose proxy exits through an IPv4 address** →
  the page finds no IPv6 address of yours and reports IPv6 as unavailable (the browser stays off
  IPv6 while its exit IP is IPv4).
- [ ] `REAL-F12` · **Run the extended DNS leak test in a session on `home` and in a session on
  `socks`** → the resolvers listed belong to the proxy's side (its provider or its country) and
  none to your provider or router, because the proxy resolves the names for the browser.
- [ ] `REAL-F13` · **Start a session on each kind of proxy you have (`home`, `auth`, `socks`, an HTTPS
  proxy) and open an HTTPS page and the two IP pages in each** → each loads and prints the exit IP of its
  own proxy, which the proxy's row on Proxies also shows as **Working**; the browser asks for no password,
  neither for `auth` nor for `socks` (it cannot do SOCKS5 authentication itself); the manager's log shows
  no error for the browser's own background requests (update checks, the add-on's filter lists).
- [ ] `REAL-F14` · **With a session on `auth` running, list what the manager listens on (`lsof -nP -a
  -p {manager pid} -iTCP -sTCP:LISTEN`), send a request through the extra local port (`curl -s -x
  http://127.0.0.1:{port} https://ifconfig.me/ip`), then stop the session and list again; do the same
  for a session on a proxy without credentials** → while the session on `auth` runs the manager
  listens on one more port, on `127.0.0.1` only, and `curl` through it prints the proxy's exit IP
  without being asked for a password (the trade-off the README states); after Stop the port is gone and
  `curl` is refused; the session on a proxy without credentials opens no such port.

## What stays and what does not

- [ ] `REAL-F15` · **In `win` sign in to the cookie login page and add two items on the to-do page, then
  open both pages in `mac`** → `mac` is not signed in and its to-do list is empty: nothing is shared
  between sessions, neither cookies nor storage nor cache; `win` is still signed in with its items.
- [ ] `REAL-F16` · **Stop and Start `win`; then stop the manager with Ctrl+C, start it again and Start `win`** →
  after each, `win` is still signed in with its items, with the same tabs open and the same tab
  active, and its canvas hashes are those of `REAL-F3`.
- [ ] `REAL-F17` · **List `{data dir}/profiles/` with a session stopped, with it running, and after
  deleting it (`ls -la`)** → there is one directory per session, named by its id; Stop keeps it, Delete
  removes it and everything in it; no directory of a deleted session is left, and none is created for
  a session that never started.

## Real sites

- [ ] `REAL-F18` · **Open five ordinary sites in one session, a news home page, a video, a map, a webmail
  login and a page behind a bot check, and use each for a minute** → each page renders and answers
  scrolling, clicks and typing; a site that refuses the proxy's address or asks for a captcha is the
  site's decision and no finding; the session stays **Running** and the manager keeps answering.
- [ ] `REAL-F19` · **Open the ad-blocker test page and a page with banner ads in a session that launched with
  the network up** → the test reports ads and trackers as blocked and the banner slots stay empty
  (uBlock Origin is loaded into every browser that launched with it available); the add-on is kept in the
  `addons/UBO` folder of the installed build, so only a launch that does not find it needs `addons.mozilla.org`.

## Weight

- [ ] `REAL-P1` · **Start five sessions on five proxies, open a heavy page in each and use the list for ten
  minutes (`ps -axo rss=,command= | grep -- '-profile .*/profiles/'`, summed per session)** → every row
  stays **Running**; the list and Settings answer in under a second; each session's processes together
  come to about 1 GB on a heavy page and well under that on a quiet one (more than 2 GB for one session is a
  finding); the manager's own process stays far below one session's and does not grow while you watch.
- [ ] `REAL-P2` · **Press Start session on a stopped session on an install that has launched a browser before,
  time it to Running; then press Add session and time that** → both reach **Running** within about ten seconds
  (more than thirty is a bug); the very first launch of an install also downloads the uBlock Origin add-on
  and takes longer once.
- [ ] `REAL-P3` · **Leave one session on a page that keeps itself busy (a video, a live feed) and one on a quiet
  page for two hours, with no page of them open in the manager** → both are **Running** at the end; opening
  each shows a fresh picture and answers a click at once; each one's memory (`ps` as in `REAL-P1`) has
  not doubled since the first ten minutes.
- [ ] `REAL-P4` · **Stop the manager with Ctrl+C while five sessions run and the page of one of them is open in
  a browser tab, count their processes every few seconds (`ps -axo pid=,command= | grep -c -- '-profile
  .*/profiles/'`) until the manager has exited, then start it again** → the manager exits within about
  thirty seconds, which is the time it gives the browsers, and prints no error; no browser process of any
  session is left when it has exited; all five sessions are **Stopped** after the restart and Start opens
  each with its tabs.
