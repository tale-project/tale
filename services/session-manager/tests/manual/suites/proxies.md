# Proxies

> **Prefix** `PROXY-` · **Reset** once, at the start · **Cost** ~30 min

The proxy pool as a person feels it at scale and on a real network: a thousand rows, how the table
behaves while a thousand checks run, what the network itself says about a proxy that fails, and that
no password turns up in the places a person would look. What the specs hold (every form a proxy can
be written in and every refusal, the import report, the health states, assignment, deleting a proxy in
use, search, the windows of rows, the keyboard) is in
[`../reference/automation.md`](../reference/automation.md); a box here never restates it.

## Preconditions

Stack A after a reset, with the control server reachable ([`../setup.md`](../setup.md)); stack B
for the boxes that say so, with a few proxies of your own, one of them with a wrong password.
Make the list for the big-table boxes outside the repository:

```bash
mkdir -p /tmp/session-manager-qa
for i in $(seq 1 1000); do echo "198.51.100.$((i % 250)):$((8000 + i))"; done > /tmp/session-manager-qa/proxies-1000.txt
```

(On stack A a proxy exits through `203.0.113.<the last number of its host>`, so this list has
250 different exit IPs, four proxies each.) A 1440×900 viewport.

> **Agent note**: the rows are `tr` in the table named "Proxies in the pool"
> (`proxies.table.caption`), inside the region "Proxy list" (`proxies.table.region`); it is virtualised and
> loads more rows as you scroll, so count rows with the footer ("Showing {n} of {total} proxies") and not
> with the DOM. The search input ("Search proxies") is read-only until it is focused and keeps its text in the
> address (`/proxies?q=`). A check is over when `GET /api/meta` says `counts.checkingProxies` is `0`.
> Add proxy (`proxies.actions.add`) is a menu with **Manual entry** (`proxies.actions.addProxy`) and
> **Import a list** (`proxies.actions.importProxies`); a proxy with a username reads
> `http://carol@203.0.113.41:8080` in its row, never with the password.

## The big table

- [ ] `PROXY-P1` · **Press Add proxy, choose Import a list and import `proxies-1000.txt` with Choose file
  (`proxies.import.chooseFile`) and Import proxies (`proxies.import.submit`)** → the dialog closes at once (a
  clean import needs no report) and a notice says "1,000 proxies added" and "They're being checked now."; the
  table shows the newest first; the line above it reads "1,000 proxies · 1,000 free"; the rows go
  **Checking** and then **Working** about eight at a time, the page keeps answering clicks, typing and
  scrolling while the table refreshes every second and a half, and within about twenty seconds on stack A
  none says Checking.
- [ ] `PROXY-P2` · **Scroll the table to its end, three times** → the footer reads "Showing {n} of 1,000 proxies" and
  n grows in equal steps each time more rows load; the loading adds no flicker and does not move the row you
  were looking at; scrolling back up keeps the rows.
- [ ] `PROXY-P3` · **Search for the `host:port` of the oldest proxy (`198.51.100.1:8001`), then for `DE`, then for
  `Germany`, then for words that match nothing, then press Clear search (`proxies.search.clear`)** → the first
  finds its row within about a second and the footer says "Showing 1 of 1,000 proxies"; the next two match by
  country code and by the country's name in the page's language; no match shows "No results found" and "Try
  adjusting your search criteria"; the address follows what you typed (`/proxies?q=…`); Clear search empties
  the box, leaves `?q=` out of the address and brings the table back.
- [ ] `PROXY-P4` · **Press Check all proxies (`proxies.actions.checkAll`) with the 1,000 proxies, and keep using
  the table** → a notice says "Check of all proxies started"; the button is disabled with the reason "Every proxy
  is already being checked." until the checks end, and keeps the keyboard focus you gave it; rows turn
  **Checking** and back without the table jumping; nothing else in the manager slows down (open a session
  meanwhile).

## What the network says

- [ ] `PROXY-F8` · **Make three proxies fail in three ways (stack A: `PUT {control}/exit-ips` with an `error` such as
  "connection refused" for each; stack B: a closed port, a wrong password, a host that does not exist) and press
  Check on each** → each row shows **Not working** with a reason that says what is wrong in words you can
  act on (refused, rejected credentials, no answer in time), no password in it, and the reason is the network's
  English sentence even when the page is in German or French; the line above the table gains "{n} not working".

## Secrets stay secret

- [ ] `PROXY-F13` · **Add a proxy with a password (`203.0.113.41:8080:carol:Hunter2Hunter2`), check it, then look for
  `Hunter2Hunter2` in the manager's own log (the terminal it runs in), in the browser's storage (devtools,
  Application: local storage, session storage, cookies) and in `GET /api/proxies`
  (`curl -s {origin}/api/proxies | grep -c Hunter2Hunter2`)** → it is nowhere: the API says `"hasPassword":true`
  and the row `http://carol@203.0.113.41:8080`; the one place a password is handed out is the proxy export of
  the Sessions list (Export session proxies as JSON, in its More actions menu).
