# Viewer

> **Prefix** `VIEW-` · **Reset** none · **Cost** ~60 min

The page of a running session, judged with a real browser, a real keyboard and a real pointer: how
typing feels and whether a key ever stays down, how scrolling follows your hand, selection and the
clipboard of your computer, the picture's quality, a link that opens a window, a real login form filled
from a secret, and the shortcuts that two browsers fight over. What the messages of the live view
carry (every key, button, wheel step, tab, address, dialog and list), and what a real Camoufox does with
them on a test page, is held by the specs and by the real-browser lane
([`../reference/automation.md`](../reference/automation.md)); a human is here for the feel, for the
host browser's own behaviour and for pages nobody scripted. Every box needs **stack B**, a real
Camoufox, because a fake page has no text fields, links or scroll. **Run it in order the first time:**
the boxes reuse one running session and the tabs the earlier ones left.

## Preconditions

Stack B with one working proxy ([`../setup.md`](../setup.md)), one running session named `0001`,
and its page open at 1440×900 with devtools open on the **Network** panel (filter `ws`). Pages to
use; any equivalent will do, these are public examples whose behaviour is known:

| For | Example |
|---|---|
| a text field and key events | `https://the-internet.herokuapp.com/key_presses`, or any search page |
| a long page to scroll | any long Wikipedia article |
| a link that opens a new tab | `https://the-internet.herokuapp.com/windows` |
| a login form | `https://the-internet.herokuapp.com/login` (the page prints its test credentials) |
| a file input, a date input, a download | `…/upload`, any form with `type="date"`, `…/download` |
| a "leave this page?" prompt | any online editor or webmail compose window with unsaved text |

Also needed: a keyboard layout with dead keys (US International, German or French), a trackpad, a
mouse with side buttons if you have one, and both a standard and a high-density display if you can.

> **Agent note**: a script cannot read the picture of a Camoufox, but it can watch the socket's frames in
> Playwright (`page.on('websocket')`): a frame is a picture when it is binary. The page is live when the
> picture is on the screen and nothing is said over it; "Connecting to the browser…" and "Can't reach the
> browser. Reconnecting…" are what it says otherwise. With AI access on, an assistant's `read_page`
> returns the page's text.

## Typing

- [ ] `VIEW-F1` · **Click a text field in the page and type "The quick brown fox, 0123456789
  !@#€%&/()=?" at your normal speed** → every character appears once and in order; capitals and
  symbols are right for your layout; nothing is dropped, doubled or stuck when you stop.
- [ ] `VIEW-P1` · **Type steadily for ten seconds in a text field, then look at the devtools
  socket messages** → after each `key` message that changes the page, the next picture (a binary
  message) arrives at most 0.2 seconds later; after you stop typing no pictures trickle in for keys
  you already released (no backlog); the same holds while the page scrolls.
- [ ] `VIEW-F2` · **Hold a letter key down for a second, then release it** → the page repeats the
  letter while it is held and stops when you let go.
- [ ] `VIEW-F4` · **With a dead-key layout type an accented letter (´ then e, or ^ then e); with an
  input method, if you use one (Japanese, Chinese, Korean), compose and commit a word; open the
  system emoji picker and insert one** → `é` or `ê` appears once; the composed word appears once, when
  you commit it, not as raw keystrokes; the emoji is inserted.
- [ ] `VIEW-F5` · **Copy 5,000 characters with line breaks from another program, click a text area
  in the page and paste (⌘V, Ctrl+V)** → all of it lands with its lines, once; ⌘V never types the
  letter `v`.
- [ ] `VIEW-B1` · **Paste 150,000 characters, then about 1.3 MB of text (`head -c 1000000
  /dev/urandom | base64 | pbcopy` on a Mac)** → each paste lands as its first 100,000 characters,
  and a notice says "Couldn't paste all of the text" and "You can paste up to 100,000 characters at
  once. The rest was left out."; the connection stays: the stage never says "Can't reach the browser"
  and no key is left held down.

## Pointer and scrolling

- [ ] `VIEW-F7` · **Click a small link, a checkbox and a button at three window sizes (resize the
  manager's window so the picture is about 100 %, 75 % and 50 % of the page's size)** → each click
  lands on the element you aimed at, at every size; the pointer over the picture is always an arrow
  (the page's own cursor is not shown, see [`not-a-finding.md`](../reference/not-a-finding.md)).
- [ ] `VIEW-F11` · **Move across a menu that opens on hover, then flick the pointer quickly across
  several of them** → each opens promptly while the pointer is on it and closes when it leaves; none
  stays stuck open afterwards.
- [ ] `VIEW-F38` · **On the image of `compose.session-manager.yml` (a Camoufox for Linux), in a
  session whose fingerprint is Windows or macOS, bring the pointer slowly down from the address bar
  so that it comes onto the picture at its top edge; then click a link of the page, enter an address
  in the bar and open a tab with +. Do the same along the bottom edge in a session whose fingerprint
  is Linux** → the link, Enter and + each answer at once; nothing waits, and no notice says that the
  browser stopped responding to the mouse.
- [ ] `VIEW-F39` · **On the image of `compose.session-manager.yml`, with Google as the start page,
  keep moving the pointer over the picture while you open a tab with +, while a link of a Google page
  takes you to another site, and while the session restarts** → at most a pause of a second or so
  while each page changes, then the pointer follows again; the link, Enter and + answer, and no
  notice says that the browser stopped responding to the mouse.
- [ ] `VIEW-F12` · **Scroll a long article with a mouse wheel, then with a trackpad, ending each time
  with a hard flick** → the page follows your hand within a frame or two; the manager's own page does
  not scroll while the pointer is over the picture; after the last wheel event the page stops about
  as soon as the inertia does, and does not run on for seconds.
- [ ] `VIEW-F13` · **Scroll sideways (Shift with the wheel, or two fingers) on a wide page, and
  scroll inside a scrollable box of a page** → both move; the box scrolls and the page behind it
  does not move unless the box is at its end, as in any browser.
- [ ] `VIEW-P2` · **Scroll steadily for ten seconds on a text page, then stop and watch the socket
  messages for five seconds** → while you scroll, pictures arrive at least ten times a second; after
  you stop they stop within about a second: a still page with no field focused sends none.

## Selection and the clipboard

- [ ] `VIEW-F14` · **Select a sentence in the page, press ⌘C (Ctrl+C) and paste into another
  program; repeat in each browser that shows the manager (Safari, Chrome, Firefox)** → the other
  program receives exactly the selected text, in every browser; with nothing selected the clipboard
  keeps what it had.

## The picture

- [ ] `VIEW-F17` · **Open a text-heavy page at its normal size, on a standard and on a high-density
  display** → text of 12 to 14 pixels can be read without zooming on both; on the high-density
  display it looks softer than the manager's own text (the picture has the page's size in CSS pixels),
  which is expected, and no blocks or ringing hide letters.
- [ ] `VIEW-F19` · **Play a video or an animation for ten seconds, and click a link meanwhile** →
  motion is steady enough to follow, not a frame every two seconds; the link responds at once.
- [ ] `VIEW-P3` · **Open a heavy news page and use it for a minute** → the page keeps answering
  clicks and typing; if the picture slows, it does so for the heavy page and not for the manager
  (the rest of the manager, a second session included, stays quick).

## Tabs

- [ ] `VIEW-F21` · **Click a link that opens a new tab, and one that opens a popup window** →
  each appears as a tab in the strip and comes to the front; there is no separate window; the strip
  scrolls it into view, and once the tabs outgrow it the **More tabs** menu (`viewer.tabs.more`) lists
  them all.
- [ ] `VIEW-B2` · **Make the browser die (stack B: `ps -axww -o pid=,command= | grep --
  '-profile .*/profiles/{sessionId}'` names its main process, the line without `-contentproc`, and
  you `kill` that PID; stack A: `POST {control}/browsers/0001/crash`)** → **The browser has closed**
  shows at once, with "The session will show as stopped in a moment."; within about five seconds the
  session is **Stopped**, never stuck on Running; **Start session** opens it again with the tabs it had.

## What a page asks, and what is not supported

- [ ] `VIEW-F31` · **Edit a form on a page with an unsaved-changes prompt, then press Back or
  close its tab** → a dialog titled **Leave this page?** says "This page asks for confirmation before
  you leave it." and names the page's host, with **Stay on page** and **Leave page**; Stay keeps the page
  and its text, Leave goes on.
- [ ] `VIEW-F33` · **Click a file input, a date input and a download link, and press ⌘P (Ctrl+P)** →
  nothing opens and nothing breaks: no window, no crash, no file written to the disk by the download, the
  page stays usable (these are not supported, see [`not-a-finding.md`](../reference/not-a-finding.md)).

## Secrets in a real login form

- [ ] `VIEW-F34` · **On the login page click the username field, press Secrets (the button
  "Secrets for this session", `viewer.secrets.title`), open a Credentials secret and press Type next to
  Username (`viewer.secrets.type`, named "Type Username into the page")** → the popover closes, the value
  is typed into the focused field and nowhere else, and the keyboard is in the page: Tab goes to the
  password field. Do the same for Password: the popover shows it as "Hidden value" until you press
  **Show Password**, and the page's own password field shows dots.
- [ ] `VIEW-F35` · **Submit the form with Enter after typing the password from the popover** → the
  site accepts the login as if you had typed the values; the value was typed once (not twice, even if
  you pressed Enter while the popover was still fading).

## Shortcuts

- [ ] `VIEW-F36` · **With the page holding the keyboard press ⌘R (Ctrl+R) and F5** → the manager's
  own tab reloads and the live view reconnects to the same session within a few seconds, the page in
  the session unchanged; **Reload page** on the toolbar (`viewer.address.reload`) is what reloads the
  page in the session. F11 and F12 and ⌘Q (Ctrl+Q) act on the manager's browser and do not reach the
  page.
- [ ] `VIEW-F37` · **Press ⌘F, ⌘A and ⌘Z (Ctrl+F, Ctrl+A, Ctrl+Z) with the page holding the
  keyboard** → each acts in the page of the session and the host browser's own find bar does not
  open; ⌘W, ⌘T and ⌘N (Ctrl+W, Ctrl+T, Ctrl+N) and Ctrl+Tab belong to the host browser and act on it
  whatever any page says: close and switch the manager's tabs, as for any website.
