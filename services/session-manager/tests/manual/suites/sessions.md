# Sessions

> **Prefix** `SESS-` · **Reset** once, at the start · **Cost** ~35 min

The lifecycle of a session as a person watches it on a real browser, and the list that shows it:
the look of the states between the states, how a list of 120 feels, the rhythm of the requests, what
a rotation keeps and what stopping the whole manager does. What the specs prove (every state and
refusal of the lifecycle, the dialogs that ask for proxies and carry on by themselves, the shared
exit IP, the IP check, rename, delete, export, a list that follows the backend) is in
[`../reference/automation.md`](../reference/automation.md); a box here never restates it.

## Preconditions

Stack B after a reset ([`../setup.md`](../setup.md)) with at least three working proxies of your own,
distinct exit IPs; stack A for the boxes that say so. A 1440×900 viewport, devtools open.

> **Agent note**: a row is an `li` in the region "Session list" (`sessions.list.label`) and its
> second line is the text under the name; its link is named `<name> <state> <second line>` (the state
> once, after the name). A state is over when `GET /api/sessions/{sessionId}` says `activity` `null` and
> a `status` other than `starting` or `stopping`; wait on that, not on a timeout. On stack A,
> `PUT {control}/faults` with `{"launchDelayMs":8000,"checkDelayMs":3000}` turns a sub-second start into
> one you can watch, and `DELETE {control}/state` puts the speed back.

## Watching a session

- [ ] `SESS-F3` · **Press Add session (`sessions.panel.add`) on stack B and watch the header, the card and the
  list's row from the click until the picture is there** → the same words in the three places, in order:
  **Assigning proxy**, **Starting**, **Running** (at **Running** the card gives way to the picture); the dot
  is blue and pulses while the state is busy and turns green at **Running**; the row's second line becomes
  `<exit IP> · <country>` once it runs; **Stop session** is there throughout; nothing repeats or goes back,
  nothing flickers between two states, and the first picture follows **Running** within a few seconds.
- [ ] `SESS-F5` · **Read the list at 1440 and at 390 px wide with sessions in every state (stopped, assigning,
  starting, running, stopping, one in Error with a long reason, one whose proxy now exits elsewhere; on stack
  A the control server makes the last two: `PUT {control}/exit-ips` with an `error` or another `ip`), then
  hover the row with the long error** → newest first; each row has a dot, the name and a second line that reads
  well in every state: **Stopped**, the busy word, `<exit IP> · <country>`, **IP changed · restart recommended**
  in amber with a warning sign, and the failure's sentence in red on one line, cut with an ellipsis (the whole
  sentence is the line's tooltip and is on the session's page); the colour is never the only carrier; on a
  pointer device the Start/Stop and menu buttons appear on a backing at the row's right edge and may cover
  the last words of that sentence (known: `BL-11`); below 768 px and on a touch screen they are always there,
  with room kept for them.
- [ ] `SESS-P1` · **Create 120 sessions (stack A, snippet below), open `/sessions` and scroll the list to its end,
  three times** → more rows load as you go, each step after "Loading more…" (the footer counts them); the scroll
  position never jumps, rows keep their state live (stop one far down from a shell: its row changes within
  about five seconds), and typing elsewhere in the page stays instant.

```bash
P=http://127.0.0.1:3204/api; J='Content-Type: application/json'
curl -s -X POST -H "$J" $P/proxies/import -d "{\"text\":\"$(for i in $(seq 1 250); do printf '198.51.100.%s:%s\\n' $i $((8000+i)); done)\"}" >/dev/null
for i in $(seq 1 120); do curl -s -X POST -H "$J" $P/sessions -d '{}' >/dev/null; done
```

## Rotating

- [ ] `SESS-F14` · **Log in to a site in a running session (stack B), choose Rotate IP in its menu and confirm
  with Rotate IP in the dialog (`sessions.rotate.confirm`)** → the session shows **Assigning proxy** and
  **Starting** and comes back **Running** with another exit IP and the tabs it had; you are still logged in
  at the site; the exit IP the site sees is the new one.

## Rhythm and the manager

- [ ] `SESS-P2` · **Watch the Network panel (filter `api/`) while a session starts, then leave everything idle for 30
  seconds** → `/api/sessions…` and `/api/meta` repeat about every 1.5 seconds while something is starting or
  stopping or a proxy is being checked, and about every 5 seconds once nothing is busy; they never overlap
  themselves or burst; coming back to the window after another tab had it asks again at once.
- [ ] `SESS-B4` · **Stop the manager with Ctrl+C while two sessions run and the page of one of them is open in a browser
  tab (stack B), then start it again** → the manager exits within about thirty seconds, the time it gives the
  browsers, with no error in its log and no browser of the sessions left (`ps -axo pid=,command= | grep --
  '-profile .*/profiles/'`); the open page shows the red connection banner meanwhile; after the restart both
  sessions are **Stopped**, not Error; Start session reopens each one with the tabs it had; proxies, secrets,
  settings and the start page are as you left them.
