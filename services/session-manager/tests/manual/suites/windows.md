# Windows

> **Prefix** `WIN-` · **Reset** once, at the start · **Cost** ~50 min

Every session is a Camoufox window of its own on the screen of the computer the manager runs on, and
this suite judges those windows on a Mac with real browsers: a window that opens in front and fits the
screen, the session's tabs in that one window, **Show window** from the card and from the menus, an
assistant's start that leaves the screen as it is, a secret typed into the field you clicked in the
window, the window's own dialogs, links, popups, position and downloads, and how a closed window, a
browser that quits or dies and a manager stopped with Ctrl+C end their sessions. The calls the page
makes and the words of their refusals are held by the specs and the UI tests on a fake browser, and
what a real Camoufox does with typed text, a focused field, dialogs and reopened tabs, without a
window, by the real-browser lane ([`../reference/automation.md`](../reference/automation.md)); a human
is here for the windows, which no lane can see. Every box needs **stack B on a Mac**: elsewhere the
system decides about the windows ([`../reference/not-a-finding.md`](../reference/not-a-finding.md)).
**Run it in order the first time:** the boxes reuse the sessions `0001` and `0002` and the tabs the
earlier ones left, and the last group closes them.

## Preconditions

Stack B on a Mac after a reset ([`../setup.md`](../setup.md)), with two working proxies of your own
that have distinct exit IPs, AI access off, the manager's page open at 1440×900 in the browser you like
and its terminal at hand. A Credentials secret for every session with the test login of the login page
below. Switch AI access on for `WIN-F6` only, and off again after it. Pages to use; any equivalent will
do, these are public examples whose behaviour is known:

| For | Example |
|---|---|
| a login form | `https://the-internet.herokuapp.com/login` (the page prints its test credentials) |
| a text field | `https://the-internet.herokuapp.com/key_presses`, or any search page |
| a link that opens a new tab | `https://the-internet.herokuapp.com/windows` |
| a button that opens a window of a given size | the run buttons of `https://javascript.info/popup-windows` |
| an alert, a confirm and a prompt | `https://the-internet.herokuapp.com/javascript_alerts` |
| a "leave this page?" question | any online editor or webmail compose window with unsaved text |
| a page that asks where you are | `https://browserleaks.com/geo` |
| a file input, a date input, a download | `…/upload`, any form with `type="date"`, `…/download` |
| a text area | any comment or message box |

> **Agent note**: no script sees the windows: judge them with your eyes, and ask the system what you
> cannot see. `sleep 5; lsappinfo info -only name -only pid "$(lsappinfo front)"` names the app in
> front five seconds later (the time to switch away from the terminal you typed it in): Camoufox, with
> the PID of the session's browser. The processes of a session's browser are
> `ps -axww -o pid=,command= | grep -- '-profile .*/profiles/{sessionId}'`, and its main process is the
> line without `-contentproc` and `-parentPid`. A session's state is `status` in
> `GET /api/sessions/{sessionId}`; the page asks for it every five seconds while nothing is busy, so it
> may say **Running** that long after a window closed. With AI access on, `list_tabs` says which tabs a
> session has and which one is active.

## A window of its own

- [ ] `WIN-F1` · **Press Add session (`sessions.panel.add`), leave the name blank, press Add session in
  the dialog (`sessions.add.submit`) and keep your hands off the computer until the header says
  Running** → once the session runs a Camoufox window opens in front of the manager's browser
  (Camoufox is the app named in the menu bar), with one tab on the start page; the whole window is on
  the display and no larger than it: its title bar below the menu bar, its other edges inside the
  screen.
- [ ] `WIN-F2` · **Open two more tabs in the window, one with ⌘T and one with a link that opens a tab,
  click into the page of the second of the three, then press Stop session and, once the session is
  Stopped, Start session** → the window closes at Stop; at Start one window opens, in front, with the
  three tabs in it as tabs (never a window each), in their order, the second one in front; no line of
  the manager's log says "Left the Camoufox browser as it is".
- [ ] `WIN-F3` · **Choose Restart in the session's menu (Actions for {name}, `sessions.row.menu`) and
  confirm it (`sessions.restart.confirm`); once it runs again, choose Rotate IP and confirm it
  (`sessions.rotate.confirm`), with the second proxy free** → each time the window closes, and one
  window opens again once the session is back to Running, in front of the manager's browser, with the
  same tabs and the same one in front.

## Show window

- [ ] `WIN-F4` · **In the window choose another tab and click into its page; then click into the
  manager's page so that its browser covers the window, and press Show window on the card
  (`viewer.window.show`)** → within a second the session's window is in front of the manager's browser,
  showing the tab you clicked in; nothing in the window changes (no tab opens and none reloads), and the
  manager's page stays as it was.
- [ ] `WIN-F5` · **Add a second session, `0002`, and let its window open; open the page of `0001`; then
  choose Show window (`sessions.menu.showWindow`) in the menu of the row of `0002`, then in the menu of
  the row of `0001`, then in the menu of the page's header** → each brings the window of its own session
  in front, never the other one: the row of `0002` brings the window of `0002` although the page of
  `0001` is open.
- [ ] `WIN-B1` · **Minimize the window of `0001` into the Dock and press Show window; then hide its
  Camoufox (⌘H in the window) and press Show window again** → each time the window comes back, out of
  the Dock and out of hiding, and is in front.

## An assistant's start

- [ ] `WIN-F6` · **Stop `0002` and switch AI access on; then start `0002` from the terminal the way an
  assistant does, and leave the terminal in front (`mcp start_session`, snippet below)** → the answer
  comes once the session runs, and its window opens behind the terminal: the terminal stays in front
  and keeps the keyboard; `mcp show_window` brings the window in front of the terminal, and
  `mcp open_tab` adds a tab to that window, never a window of its own.

```bash
O=http://127.0.0.1:3004; J='Content-Type: application/json'
mcp() { curl -s -X POST -H "$J" $O/mcp -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$1\",\"arguments\":$2}}"; }
mcp start_session '{"session":"0002"}'
mcp show_window '{"session":"0002"}'
mcp open_tab '{"session":"0002","url":"https://example.com"}'
```

## Typing a secret

- [ ] `WIN-F7` · **Open the login page in the window of `0001` and click its username field; in the
  manager press Secrets (the button "Secrets for this session", `viewer.secrets.title`), open the
  Credentials secret and press Type next to Username (`viewer.secrets.type`, named "Type Username into
  the window", `viewer.secrets.typeLabel`); then do the same for Password** → each time the popover
  closes, the value is in the field you clicked and nowhere else, and the window comes to the front with
  that field still focused: Tab goes from the username to the password field; the page's own password
  field shows dots; the clipboard of your computer still holds what it held.
- [ ] `WIN-F8` · **Type the password from the popover, then at once press Enter, without clicking
  anywhere** → Enter reaches the window, which came to the front with the password field focused, and
  submits the form; the site accepts the login as if you had typed the values ("You logged into a
  secure area!"), so each value went in once.
- [ ] `WIN-F9` · **Open a second tab with a text field and click into that field; go back to the login
  tab, log out and click its username field; press Type next to Username; then click the field of the
  second tab and press Type next to Username again** → the first value lands in the username field of
  the login tab and the second in the field of the second tab: each time in the tab you last clicked
  in, which is the tab in front when the window comes forward.
- [ ] `WIN-F10` · **In the window click into the field of the second tab, then choose the login tab by
  its title in the window's tab bar, without clicking in its page, and press Type next to Username** →
  the value lands in the field of the second tab, the one you last clicked in, not in the tab on screen,
  and the window comes forward showing the second tab: a tab chosen in the tab bar tells the app nothing
  (see [`not-a-finding.md`](../reference/not-a-finding.md)).
- [ ] `WIN-B2` · **Click the text of the page in the window, outside any field, and press Type next to
  a value** → nothing is typed anywhere in the window, and the window stays behind the manager; the
  page says that nothing in the window can take text (`errors.no_field_focused`).
- [ ] `WIN-B3` · **Click the username field of the login page, then click into the window's own address
  bar, so that it has the keyboard, and press Type next to Username** → nothing is typed into the
  address bar, which would hand the value to a search engine: the value lands in the username field,
  which the page still holds as its focus.
- [ ] `WIN-B4` · **Copy 4,000 lines (`seq 1 4000 | pbcopy`: 18,893 characters, near the 20,000 a value
  may have) into the text of a Note secret for `0001`, click a text area of a page in the window and
  press Type next to Note** → the whole note lands in the text area once, with its 4,000 lines, within a
  few seconds; the window then comes forward; the manager answers meanwhile.
- [ ] `WIN-B5` · **In the window's address bar open
  `data:text/html,<input autofocus><button onclick="setTimeout(()=>alert(1),3000)">Alert</button>`,
  press Alert, click into the field before the alert opens three seconds later, leave the alert open and
  press Type next to Username; then press Show window** → within a few seconds of the click a toast
  "Couldn't type the value" says that the session's browser didn't respond and that a dialog may be
  waiting (`errors.browser_not_responding`, see [`error-codes.md`](../reference/error-codes.md));
  nothing is typed, also once you answer the alert; Show window brings the window forward with its
  alert.

## The window's own

- [ ] `WIN-F11` · **On the alerts page press the buttons for an alert, a confirm and a prompt and answer
  each in the window (OK; Cancel; a word, then OK); then type into a page that asks before you leave it
  and close its tab** → each dialog is the window's own, over its page, and the page prints your answer
  ("You successfully clicked an alert", "You clicked: Cancel", "You entered: {word}"); one you leave
  alone stays open until you answer it; the leave-page question asks in the window, and staying keeps
  the page and your text; nothing of them shows in the manager, and the session stays Running.
- [ ] `WIN-F12` · **Press Click Here on the new-tab page, then a run button on the popup page that opens
  a window of a given size; close the popup** → the link's page opens as a tab of the session's window
  and comes to the front; the popup opens in the session's Camoufox as Firefox opens one (a window of
  its own, or a tab), never in another browser of the computer; closing it leaves the session Running,
  its window as it was.
- [ ] `WIN-F13` · **Open the page that asks where you are, then read Location in the Session details of
  the session's card (`viewer.card.location`)** → the page has a position at once, without a question in
  the window, and it is the Location of the details (the place of the exit IP), never where you are; the
  permission the page reads is still "prompt" (browserleaks shows it, or
  `navigator.permissions.query({ name: 'geolocation' })` in the window's console).
- [ ] `WIN-F14` · **Upload a file with the upload page's file input, open the picker of a date input,
  right-click a link and press ⌘P** → each is the window's own and works as in any Firefox: the file
  dialog of macOS opens and the page names the file it received; the date picker opens under its field;
  the right-click menu opens; the print dialog opens (cancel it); the session stays Running.
- [ ] `WIN-B6` · **Run `touch /tmp/session-manager-qa/mark`, click a file on the download page, wait ten
  seconds, then run `find ~/Downloads "$TMPDIR" -type f -newer /tmp/session-manager-qa/mark`** → the
  download is refused: no Save dialog opens and the list holds no file of it (other programs' temporary
  files may be there); the page stays usable and the session Running.

## When a window goes

- [ ] `WIN-F15` · **Close the window of `0002` with its close button** → within about five seconds the
  session reads Stopped in the manager (the page asks every five seconds), never Error; no process of
  its browser is left (`ps` as in the agent note) and its icon leaves the Dock; Start session then opens
  one window, in front, on the start page and not on the tabs it had: closing the window closed its
  tabs.
- [ ] `WIN-B7` · **Quit the Camoufox of `0002` (⌘Q in its window); start the session and open a second
  tab; then make its browser die: `kill` the PID of its main process (`ps` as in the agent note)** →
  each time, within about five seconds the session reads Stopped, never stuck on Running and never
  Error, and no process of it is left; Start session opens one window with the tabs it had: a browser
  that went away is not you closing its tabs.
- [ ] `WIN-F16` · **With `0001` and `0002` running with two tabs or more each, stop the manager with
  Ctrl+C in its terminal; start it again and press Start session on each** → every window closes while
  the manager stops, and none is left on the screen or in the Dock once it has exited; after the restart
  both sessions read Stopped; each Start opens one window, in front, with the tabs it had and the one
  you last used in front.
