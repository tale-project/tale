# Manual tests

The manual layer of Session Manager's test suite, beside the automated lanes: the server and UI
tests, the real-browser lane and the Playwright specs in [`../e2e`](../e2e). Everything here is
driven by a human (or a chauffeur script) against a running instance — the edges no headless run can
judge: how typing and scrolling feel through a picture of a browser, layout and focus on a phone,
what a screen reader says, whether a fingerprint or a leak test accepts what a session claims,
degraded modes that need a real install, a real network or a real disk, and exploratory pokes.

**Suites and rounds are separate things.** The files under [`suites/`](suites)
are the tests: evergreen, re-runnable, and **never ticked in place**.
[`runs/`](runs) is the history: one record per round. A suite never names a
round; a record is never a test.

**The service README is the oracle** for what the app does
([`../../README.md`](../../README.md)): a box and the README that disagree are a `docs` finding,
and a behaviour the README promises that a box cannot find is a `bug`.

## The files

| Path | What it is |
|---|---|
| [`readme.md`](readme.md) | this guide — how a round works, how a box works, how to judge |
| [`setup.md`](setup.md) | the environment: toolchain, the three stacks and their ports, the control server, reset choreography, proxies and accounts, baseline gates |
| [`template.md`](template.md) | the shape of a NEW suite, and the authoring conventions |
| [`suites/`](suites) | the tests — one file per suite, listed below |
| [`reference/automation.md`](reference/automation.md) | what the automated lanes already own — **read before hand-verifying anything** |
| [`reference/not-a-finding.md`](reference/not-a-finding.md) | out of scope · product quirks · known benign output · known debt (`BL-n`) |
| [`reference/error-codes.md`](reference/error-codes.md) | every error code, its extra fields, and how to provoke it |
| [`reference/pins.md`](reference/pins.md) | why a box says what it says — read before rewording one |
| [`runs/readme.md`](runs/readme.md) | the round journal + how to close a round |
| [`runs/template.md`](runs/template.md) | the round record to copy to `r<nnnn>.md` (`r0001.md`, `r0002.md`, …) |
| [`runs/template-session-log.md`](runs/template-session-log.md) | the tick-as-you-go log to copy **outside** the repo |

## The suites

Every suite declares the ID prefix its boxes carry, in its header blockquote. A
box ID is unique across this whole directory and greppable as one token; two
suites may continue one numbering, but no prefix may shadow another. One suite
([responsive-a11y](suites/responsive-a11y.md)) declares two prefixes, because its layout and
accessibility boxes are read together.

| Suite | Prefix | What it is | Resets | Rough cost |
|---|---|---|---|---|
| [smoke](suites/smoke.md) | `SMOKE-` | is this build even drivable: the shell, then one session from proxy to deletion on a real browser — run it before investing in anything bigger | once, at the start | 15 min |
| [sessions](suites/sessions.md) | `SESS-` | watching a session start on a real browser, the look of the list in every state, a list of 120, what a rotation keeps, the rhythm of the requests, stopping the whole manager | once, at the start | 35 min |
| [viewer](suites/viewer.md) | `VIEW-` | the page of a running session in a real browser: typing, pointer and scrolling, the clipboard of your computer, the picture, links that open windows, secrets in a real login form, shortcuts | none | 60 min |
| [proxies](suites/proxies.md) | `PROXY-` | a table of a thousand rows while a thousand checks run, what the network says about a failing proxy, and that no password turns up where a person would look | once, at the start | 30 min |
| [secrets](suites/secrets.md) | `SECRET-` | the real clipboard, masked fields in three browsers, devtools storage and network, a long list | once, at the start | 25 min |
| [settings](suites/settings.md) | `SET-` | the app read in German and in French by a native reader, and AI access with real assistants connected to `/mcp` | once, at the start | 60 min |
| [responsive-a11y](suites/responsive-a11y.md) | `RESP-` `A11Y-` | a real phone, zoom and text size, no colour, high contrast, VoiceOver | none | 60 min |
| [real-browser-realism](suites/real-browser-realism.md) | `REAL-` | whether the Camoufox a session launches is the one it says it is, where it says it is, what leaks past the proxy, what stays and what does not, and the weight of several browsers | once, at the start | 2 h + 2 h waiting |
| [degraded-modes](suites/degraded-modes.md) | `DEG-` | no browser build, no GeoIP database, no add-on, no network, a foreign database, a taken port, a vanished data directory, a manager that goes away with a page open | before the boxes that say so | 60 min |

## How a round runs

1. **Baseline an untouched tree.** Every gate green before you judge anything
   ([setup.md](setup.md#baseline)).
2. **Set up** — the stack, the control server, the proxies and the accounts you need
   ([setup.md](setup.md)).
3. **Copy the templates** — the [session log](runs/template-session-log.md) to
   `/tmp/session-manager-qa/r<nnnn>/`, and tick there.
4. **Smoke first** if you are short on time; red ⇒ stop and fix before touring.
5. **Run the suites you mean to run**, in the order their own headers give; the
   cross-cutting ones (responsive-a11y, real-browser-realism, degraded-modes) last.
6. **Log as you go**, citing box IDs, with evidence under
   `/tmp/session-manager-qa/r<nnnn>/<box-id>/`.
7. **Fix in batches after the pass**, re-running every gate after each batch.
8. **Close the round** — record, journal row, pins, registers
   ([runs/readme.md](runs/readme.md#closing-a-round)).

Keep devtools open throughout. **An unexpected console message at error level is
always a finding, on any page.** Check it against the known-benign list in
[`not-a-finding.md`](reference/not-a-finding.md) first.

## Choosing what to run

| Profile | Run | When |
|---|---|---|
| **Smoke** | [`suites/smoke.md`](suites/smoke.md) | before investing in anything bigger; after a dependency bump |
| **Change-scoped** | the rows below that the change touches | the ordinary case — a feature or a fix landed |
| **Full** | every suite | before a release, after a change to the browser layer or to the live view, or when a round is asked for by name |

Change-scoped, by area:

| What changed | Run |
|---|---|
| routing, the rail, the titles, an unknown address | `SMOKE-F1`, `SMOKE-F2`, `SMOKE-F3` |
| the sessions list, start, stop, restart, rotate, delete, the IP check | `SMOKE-F8` to `SMOKE-F12`, then [sessions](suites/sessions.md) |
| the live view: typing, pointer, scroll, clipboard, tabs, dialogs | [viewer](suites/viewer.md) · [`automation.md`](reference/automation.md) first |
| proxy parsing, import, health, assignment | `SMOKE-F7`, then [proxies](suites/proxies.md) |
| secrets, masking, the Secrets popover | [secrets](suites/secrets.md), `VIEW-F34`, `VIEW-F35` |
| Settings, AI access, an MCP tool | `SMOKE-F13`, then [settings](suites/settings.md) |
| copy or catalogs (any locale) | `SET-F9` |
| controls, focus, geometry, motion, contrast, theme | [responsive-a11y](suites/responsive-a11y.md) · [`automation.md`](reference/automation.md) first |
| fingerprints, places, proxies in a real browser, WebRTC, the credential bridge | [real-browser-realism](suites/real-browser-realism.md) |
| start-up, the install, the GeoIP database, shutdown, the data directory | [degraded-modes](suites/degraded-modes.md), `SESS-B4` |
| a Camoufox, Playwright or Bun update | smoke, [viewer](suites/viewer.md), [real-browser-realism](suites/real-browser-realism.md), `DEG-F1` to `DEG-F3` |

## How a box works

Every box is one line of markdown that a round can tick, cite and diff:

```
- [ ] `SMOKE-F9` · **Wait for the picture** → the tab strip shows one tab, the address bar shows
  the start page, and the canvas shows the page within a few seconds of **Running**.
```

- **Do the bolded action, judge against everything after the `→`.** A box that
  bundles several judgments still passes only if all of them hold.
- **Controls are named by what the person sees**, with the message key that resolves them in
  backticks (`sessions.panel.add`), and routes as `{param}` placeholders
  (`/sessions/{sessionId}`). Nothing here depends on a CSS class.
- **The ID is a stable contract.** Session logs, round records,
  [`pins.md`](reference/pins.md), the automation register and code comments all
  cite them. **Append, never renumber.**
- **Keep the boxes in these files empty.** Tick in the session log; findings go
  to the log, then to a [record](runs) — never into a suite.
- **A box states what to check and why the expectation is what it is.** Where
  the "why" is a war story, it lives in [`pins.md`](reference/pins.md) instead,
  so the box stays readable.
- **A box never restates what a spec owns.** Read
  [`automation.md`](reference/automation.md) first; a box a spec takes over moves there.
- Anything listed in [`not-a-finding.md`](reference/not-a-finding.md) is **not a
  finding at any severity** — cite the entry and move on.

ID scheme — the letter after the prefix is the kind of check the box makes:

| Form | Means | Example |
|---|---|---|
| `<PREFIX>F<n>` | functional | `SESS-F3` |
| `<PREFIX>B<n>` | boundary or error: a refusal, a failure, a degraded state | `SESS-B4` |
| `<PREFIX>A<n>` | accessibility | `A11Y-A4` |
| `<PREFIX>P<n>` | performance, load or weight | `PROXY-P1` |
| a trailing letter | a box appended between two existing ones, or one judgment split out of a crowded box — **part of the ID**, not a position | an `a` after the number |
| `BL-<n>` | a known-debt entry, not a box | `BL-5` |

## Judging

Ask, in this order:

1. **Is it already owned by a spec?**
   ([`automation.md`](reference/automation.md)) — then it is not a manual
   finding; a red there is a spec failure, and it belongs in the gate, not the
   round.
2. **Is it on a register?** ([`not-a-finding.md`](reference/not-a-finding.md)) —
   out of scope, a product quirk, or known debt: cite it and move on.
3. **Does a box say otherwise?** Read [`pins.md`](reference/pins.md) before
   deciding the box is wrong — the wording is usually specific on purpose.
4. **Does the README say otherwise?** It is the oracle: the box is stale (`docs`) or the app is.
5. **Then file it**, with exactly one severity.

### Severity rubric

| Severity | Means | Examples |
|---|---|---|
| `blocker` | Data loss, a secret or a password shown where it must not be, a crash, an exit IP that is yours instead of the proxy's, or a core path with **no** workaround. | A proxy password in an API answer; the manager that cannot be stopped; a session that shares cookies with another. |
| `bug` | Wrong behaviour with a workaround, or a violated documented contract. | A time zone that is not the exit IP's; a toast that names the wrong session; a stage that stays Connecting. |
| `polish` | Cosmetic / UX nit, no functional impact. | Truncation one character too early; a focus ring that is faint; a button over a line of text. |
| `docs` | These files or the service readme are inaccurate. | The guide names a control that is called something else now. |

## Failure policy

When a box fails: assign the next `R<round>-<box-id>`, capture evidence
(screenshot + console transcript) to
`/tmp/session-manager-qa/r<nnnn>/<box-id>/`, then decide whether to continue.

| Situation | Do |
|---|---|
| a **blocker on a state-feeding box** (anything a later box depends on: the smoke chain, the viewer's one running session) | halt that suite; reset and restart it once the fix lands |
| an **isolated or read-only failure** | log it and **continue**, so one bug does not mask the rest |
| any failure, mid-suite | **never fix in place** — fixes are a separate batched phase, so a round's findings stay comparable |

## Changing the suites

- **New behaviour earns a box** wherever a human still has to judge it — and
  **loses one** once a spec owns it end to end (move the row into
  [`automation.md`](reference/automation.md) instead).
- **Append IDs; never renumber one.**
- **Keep a box about the product**, not about the round that wrote it: the round
  belongs in [`runs/`](runs), the reason a box is worded oddly belongs in
  [`pins.md`](reference/pins.md).
- **A suite edit is a code change.** Change a flow, a route, a label or a cap,
  and the box that asserts it moves in the same commit — a stale box costs the
  next round a false finding. A new message key, a renamed control or a changed
  error sentence is exactly that.

`bun run lint:manual` enforces the shape of everything above.
