# Degraded modes

> **Prefix** `DEG-` · **Reset** before each box that says so · **Cost** ~75 min, plus the 1.3 GB download of `DEG-F3` once

What the manager does when something it depends on is not there: the browser build, the GeoIP
database, the add-on, the network, the data directory, a free port, the manager itself while a page
is open. The rule behind every box is the same: **the manager says what is wrong in words, keeps
what still works working, loses nothing it had saved, and comes back by itself when the cause goes
away.** The automated lanes hold the refusals and the states a fake can make
([`../reference/automation.md`](../reference/automation.md)); they cannot take a real install away,
cut a real network or pull a data directory out from under a running process. That is this suite.
Every box that breaks something says how to put it back, and **the boxes are independent: reset
before the ones that say so, and unset `HTTPS_PROXY` again after each of them.**

## Preconditions

Stack B ([`../setup.md`](../setup.md)) with a data directory and an install directory made for the
round, under `/tmp/session-manager-qa/` (a copy of an install is fine), never one that holds
somebody's work or that another program uses: `DEG-B1` and `DEG-B2` delete files from the install.
Stack A where a box says so. A real working proxy for the boxes that start a session, and a second
terminal for the shell commands.

> **Agent note**: `HTTPS_PROXY=http://127.0.0.1:9` (port 9 is closed) makes every download the manager
> makes itself fail at once: the browser build, the GeoIP database and the uBlock Origin add-on, all
> made with Bun's `fetch`. Proxy checks and the browsers carry their own proxies and are not affected.
> The variable belongs on the manager's command line, so **a box that sets it ends by restarting the
> manager without it**. The downloads retry five times with five seconds between the tries: a failure
> takes about twenty-five seconds to arrive, not an instant. Never point `CAMOUFOX_INSTALL_DIR` at
> another program's cache, and never run `rm` on a directory you did not make.

## The browser is not there

- [ ] `DEG-F1` · **Start the manager on an empty install directory with `HTTPS_PROXY=http://127.0.0.1:9`
  (`mkdir -p /tmp/session-manager-qa/empty-install` and `CAMOUFOX_INSTALL_DIR` pointing at it) and
  open Sessions, then Settings, within the first ten seconds** → an info banner above the rail and the page
  says "The browser is being installed (about 1.3 GB to download). Sessions can start once it is ready.";
  Add session (in the list's header and, once a proxy is added, in its empty state) is disabled and its
  reason is "The browser is being installed."; About on General lists Browser "Camoufox 152.0.4-beta.30"
  and Browser installed **Installing**; Proxies, Secrets and Settings work as always; the first line of the
  manager's log says "The Camoufox browser is not installed: downloading it (about 1.3 GB)".
- [ ] `DEG-F2` · **Wait for the install to give up, about fifteen seconds after the start, and read the
  banner** → it turns red, across the whole width above the rail and the page, and its title says
  "Couldn't install the browser"; under it, "Check your connection and restart Session Manager, or install
  the browser by hand with the command below. This page updates as soon as the browser is installed." and
  the command `camoufox-js fetch` as code; a closed "Technical details" holds what the command printed
  (`camoufox-js fetch` failed (exit code 1), then its last lines, among them "Failed to fetch releases from
  https://api.github.com/…") in a box that scrolls inside itself, whose text can be selected and copied;
  Add session stays disabled with the reason "The browser isn't installed yet."; About says Browser
  installed **No**; nothing is retried by itself and the rest of the manager keeps working.
- [ ] `DEG-F3` · **With the red banner showing, install the browser into the same directory from a shell
  without `HTTPS_PROXY` (`CAMOUFOX_INSTALL_DIR=/tmp/session-manager-qa/empty-install bunx camoufox-js
  fetch`, 1.3 GB, once per round) and watch the page** → when the command ends, within about five
  seconds and without a reload, the banner is gone, Add session is enabled and About says Browser
  installed **Yes**; stop here and restart the manager without the variable before you start a session
  (this one cannot download the GeoIP database).
- [ ] `DEG-F7` · **Start the manager on an empty install directory without `HTTPS_PROXY`, with the internet
  (a new `CAMOUFOX_INSTALL_DIR`), and watch the banner until it is gone** → under "The browser is being
  installed (about 1.3 GB to download). Sessions can start once it is ready." a bar named "Download of the
  browser" (`banners.browser.progress`) fills, its percentage beside it, a few seconds behind what the
  manager's log prints; at 100 % the banner says "The browser is downloaded and being unpacked. Sessions can
  start in a moment." (`banners.browser.unpacking`) and has no bar; then it goes without a reload, Add
  session is enabled and a session starts.
- [ ] `DEG-B1` · **With the browser installed, stop the manager, delete `GeoLite2-City.mmdb` from the install
  directory, start it with `HTTPS_PROXY=http://127.0.0.1:9`, wait for its log to say "Camoufox warm-up
  failed", add a proxy that works, then Start a session on it** → the session spends about twenty-five
  seconds in **Starting**, then shows **Error** with "Couldn't find the time zone and location of the
  proxy's exit IP: the GeoIP database has no location for {exit IP}."; no browser was launched; the
  proxy's row says **Working** with its exit IP and no country; every check waits for the same lookup, one
  at a time, twenty-five seconds each; restarting the manager without the variable downloads the database again
  (about 51 MB, one line in the log) and the same session then starts.
- [ ] `DEG-B2` · **Stop the manager, delete the `addons/UBO` folder of the installed build (macOS:
  `{install dir}/browsers/official/{build}/Camoufox.app/Contents/Resources/addons/UBO`, elsewhere
  `{install dir}/browsers/official/{build}/addons/UBO`), start it with
  `HTTPS_PROXY=http://127.0.0.1:9` and Start a session on a working proxy** → it takes about twenty-five
  seconds longer to reach **Running**; the log says "Failed to download and extract UBO"; the session works
  but blocks no ads (the ad-blocker test page of [`real-browser-realism.md`](real-browser-realism.md)
  reports nothing blocked); after a restart of the manager without the variable, Stop and Start of the
  session fetches the add-on and the same page reports ads blocked.

## The manager goes away

- [ ] `DEG-F4` · **With the page of a running session open, stop the manager with Ctrl+C, wait twenty seconds,
  start it again on the same port, and do all of it a second time with `kill -9 {pid}` in place of Ctrl+C
  (stack B; on stack A the session is gone at the end)** → in both, the session's window closes within a few
  seconds, its browser going with the manager; within about ten seconds (the page asks again three seconds
  after the first poll that got no answer, and says so only if that fails too) a red strip across the top
  says "Can't reach Session Manager. We're trying to reconnect.", the tab is titled "Reconnecting - Session
  Manager", and the list, whose rows stay, says "Couldn't load the latest sessions. What's listed may be
  incomplete or out of date." with **Try again**; the header may say **Running** until the page can ask
  again; after the restart the page recovers by itself and without a reload, within about thirty seconds at
  the most (it asks again after 5, 10 and 20 seconds and then every 30 while the manager does not answer):
  the session is **Stopped**, and **Start session** opens its window with the tabs it had.
- [ ] `DEG-B3` · **Run two sessions with two tabs each, kill the manager with `kill -9 {pid}`, list the browsers
  that are left for ten seconds (`ps -axo pid=,command= | grep -- '-profile .*/profiles/'`), start the manager
  again and press Start session on both** → no browser process outlives the manager by more than a few
  seconds; both sessions are **Stopped** after the restart, not Running and not Error; Start session opens
  each with the tabs it had at its last change and nothing says that a profile is in use.
- [ ] `DEG-B4` · **Start the manager on a data directory that holds a database it did not make
  (`mkdir -p /tmp/session-manager-qa/foreign && sqlite3 /tmp/session-manager-qa/foreign/manager.db 'create
  table t(x)'`, then `SESSION_MANAGER_DATA_DIR` pointing at it)** → it prints one line without a stack
  trace that says the file is not a Session Manager database and was left as it is, and what to do (move it
  away, or use another data directory), and exits with code 1; nothing listens on the port; the file's size,
  modification time and rights are unchanged, and nothing else appeared in its directory (no `-wal` or `-shm`
  file, no `profiles` folder), whose own rights are as they were.
- [ ] `DEG-B5` · **Start a second manager on the port the first one listens on (with a data directory of its
  own: two managers on one directory are not refused), then start one whose data directory cannot be created
  (`SESSION_MANAGER_DATA_DIR=/tmp/session-manager-qa/locked/data` with `locked` made read-only by
  `chmod 555`), and read `echo $?` after each** → each ends with exit code 1 and one line, with no stack,
  that names the port or the path and what to change ("[session-manager] Port 3004 is already in use. Stop
  the program that uses it, or set PORT to another port.", "[session-manager] The data directory {path}
  cannot be used (EACCES: permission denied, mkdir '{path}'). Set SESSION_MANAGER_DATA_DIR to a directory
  that this user can write to."); the manager that was already running is not disturbed; nothing was
  written into the unwritable directory.
- [ ] `DEG-B6` · **With the manager running and its pages open (Sessions, Settings, and Proxies with the Add
  proxy dialog open and a proxy typed in it), delete its data directory (`rm -rf
  /tmp/session-manager-qa/data`, the one you made; stack A prints its own at start), then press Add proxy in
  the dialog and read Sessions and Settings** → nothing that reads the store works and each page says so in
  words: the list "Couldn't load the sessions." with **Try again** (with rows listed: "Couldn't load the latest
  sessions. What's listed may be incomplete or out of date."), Settings "Couldn't load the settings." with
  About saying Unavailable, and the Add proxy dialog stays open with your text under the failure toast
  "Couldn't add the proxy" and "Something went wrong. Try again." (in the page's language); a red strip says
  "Session Manager answered with an error. We're trying again. If the problem persists, restart Session
  Manager." (the server is up and is not "out of reach", and the tab keeps its title);
  `curl -s {origin}/api/health` still answers `200`; the log shows each failing request with its stack;
  stopping the manager and starting it again opens a new, empty data directory.

## The network

- [ ] `DEG-F6` · **With two sessions running on real proxies and a page loaded in each, turn the computer's network
  off for two minutes, use the manager meanwhile, then turn it on again** → the manager itself stays fully
  usable (its page and its API are on the loopback); in the sessions the next page loads end in the browser's
  own error page; **Check all proxies** ends every internet proxy as **Not working** with the network's reason within
  about fifteen seconds and no password in it; both sessions stay **Running**; once the network is back,
  **Check all proxies** turns the proxies **Working** again and the sessions load pages again, without restarting
  anything.
