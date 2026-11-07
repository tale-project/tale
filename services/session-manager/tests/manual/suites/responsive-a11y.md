# Responsive and accessibility

> **Prefix** `RESP-` `A11Y-` · **Reset** none · **Cost** ~60 min

The manager on a real phone, at 200% and 400% zoom and with larger text, with high contrast turned
up, with a screen reader and without a colour to tell states apart: what an emulated window and an
audit cannot judge. The automated lanes already hold the layouts at every width and on a phone, the
overflow of every page and dialog, the order of the keyboard, the focus ring, the audit of every page
and dialog in both themes (with real contrast), the landmarks, the language of the document, reduced
motion and the words that carry a state ([`../reference/automation.md`](../reference/automation.md));
a person judges what only a real device, a real screen reader and a pair of eyes can. The breakpoint is
768 px: below it the manager is the phone layout (a tab bar, one screen at a time), from it the rail
and the panel beside the page.

## Preconditions

Stack A after a reset ([`../setup.md`](../setup.md)) with three sessions (one running, one stopped with
a 60-character name, one in **Error**), a few proxies and secrets of each kind. A real phone (about
390 px wide) that reaches the manager, which listens on the loopback only: an Android phone over USB
with Chrome's port forwarding (`chrome://inspect`, forward 3004 to
`localhost:3004`, then open `http://localhost:3004` on the phone), or any phone on a network you trust with the
manager started as `SESSION_MANAGER_HOST=0.0.0.0 SESSION_MANAGER_ALLOWED_HOSTS={the computer's address}:3004`
(there is no login: stop it again afterwards). Also the browser's zoom, VoiceOver on a Mac (⌘F5) with Safari
and with Chrome, and the operating system's Increase contrast setting.

> **Agent note**: Playwright can set what these boxes need: `viewport` for the widths (640×450 is 200%
> zoom of a 1280-wide window, 320×256 is 400%), `forcedColors: 'active'` and `colorScheme`.
> `locator.ariaSnapshot()` prints what a screen reader is given. Measure overflow with
> `document.documentElement.scrollWidth - clientWidth`, which must be `0`.

## A real phone

- [ ] `RESP-F1` · **On a real phone, open Sessions, a running session, Proxies, Secrets and Settings, add a secret and
  open a running session's Secrets, for five minutes** → the tab bar never covers the last row of a list or the
  end of a session's card; nothing scrolls sideways (the proxy and secret tables are one entry per row on a
  phone); the on-screen keyboard leaves the field you are typing in in view; the buttons are easy to hit with
  a thumb; nothing is cut off by the notch or the browser's own toolbar, also in landscape; the page of a
  session starts with its own header (back arrow, name, actions) and no empty bar stands above it, as none
  does above "Page not found".
- [ ] `RESP-B1` · **Open Secrets and its form, then a running session, at 844×390 (a phone on its side)** → the
  layout is the wide one (rail and panel: 844 px is above the 768 px breakpoint), the dialog fits the window
  and scrolls inside itself, its Cancel and Add secret buttons stay reachable at its foot, and nothing is
  hidden behind the browser's own toolbar; the session's card starts at its top and scrolls inside the page,
  with Show window and Secrets in reach.

## Zoom and text size

- [ ] `RESP-F10` · **Zoom the page to 200% on a 1280-wide window, then to 400%, on Sessions, Proxies,
  Secrets, Settings and an open session** → the layout reflows to the phone layout with nothing lost and no
  sideways scrolling of the page (the tables turn into one entry per row, a session's card fits the width);
  no text is clipped or overlaps; dialogs scroll inside themselves.
- [ ] `RESP-F11` · **Raise only the text size to 200% (Firefox: View, Zoom, Zoom Text Only; or the
  browser's font setting) and open each dialog** → labels wrap instead of being cut, buttons grow with
  their text, and no control is covered.

## Without a colour, with high contrast

- [ ] `A11Y-A4` · **Emulate no colour (devtools, Rendering, Emulate vision deficiencies, Achromatopsia), then read
  the list, a session's header, the proxy table and the secret form** → every state is still told by its
  words or its shape: Stopped, Running, Error, **IP changed · restart recommended** (a warning sign), Working,
  Not working, **Checking**, Same IP as, hidden and shown values; the dot of a row is decorative and the row's
  link says its state in words, after the name.
- [ ] `A11Y-A6` · **Turn on a high-contrast mode (macOS Increase contrast, or devtools Emulate CSS
  forced-colors: active) and go through the same screens** → text, icons and borders stay visible; the focus
  ring round controls is an outline that survives; a switch, the open row, the selected tab and the badges
  can still be told apart; nothing relies on a colour that is replaced.

## Screen reader

- [ ] `A11Y-A8` · **With VoiceOver, open a running session's page and read it with the rotor (landmarks,
  headings, form controls, links)** → the first link is "Skip to main content"; landmarks: "Session Manager
  sidebar" (the rail, with the logo link "Session Manager" in it) holding the one "Main navigation" (the
  sections, and Settings at the foot), the main area with the navigation "Sessions" (the panel); one level-1
  heading, the session's name, then the level-2 headings "Running in its own window" and "Session details";
  the exit-IP button opens "Session details"; the card's buttons are "Show window" and "Secrets for this
  session", and the header's menu is "Actions for {name}"; in the Secrets popover each value has the buttons
  "Copy {label}" and "Type {label} into the window", a masked one "Show {label}" too, and a masked value is
  read as "Hidden value", never as dots.
- [ ] `A11Y-A9` · **With VoiceOver, add a session, watch it start and stop it** → the dialog's title and
  text are read; a refusal beside a field is read with the field; while it starts, the card's status region
  announces "Assigning proxy" and "Starting", each once and not at every refresh (reaching **Running** is not
  announced, known: BL-8); the row's link is read as "{name} {state} {second line}" (the state once, after the
  name) and its buttons as "Start {name}", "Stop {name}" and "Actions for {name}"; a busy button says it is
  busy.
- [ ] `A11Y-A10` · **With VoiceOver, read the proxy table and the secret list** → the table is named ("Proxies in
  the pool", "Secrets"), its column headers are read with each cell, a health badge is read as a word and
  its reason follows, a row's menu is "Actions for {host:port}" or "Actions for {title}"; a masked value is read
  as "Hidden" or "Hidden value", never as dots or digits; in the form a masked value is a secure text field
  whose typing is not echoed, and Show and Hide say what they will do.
- [ ] `A11Y-A11` · **With VoiceOver, trigger a notice (add a proxy), a failure toast (stack A: make a running
  session's proxy fail with `PUT {control}/exit-ips`, then choose Check IP in its menu) and the lost
  connection (stop the manager)** → each is announced once and politely: the notice, the failure with its
  reason ("Couldn't check the IP", "This session's proxy isn't working: {reason}. Choose Rotate IP to give
  the session another proxy."), and "Can't reach Session Manager. We're trying to reconnect."
- [ ] `A11Y-A12` · **Switch the page to Deutsch and then Français and read a page with VoiceOver in each** →
  the page's `lang` changes with the language, so the voice changes with it; names and labels are the translated
  ones; counts are read with the right plural ("1 Sitzung wird angezeigt", "Alle 2 Sitzungen werden angezeigt").
