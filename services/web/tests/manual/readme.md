# Manual tests

The manual layer of the marketing site's test suite, beside the automated [e2e specs](../e2e/specs) and the vitest i18n suite. Everything here is driven by a human (or an agent driving a browser) against a running instance or the live site: layout at every width, copy in every locale, the forms' real delivery path, and the things a crawler sees.

**Suites and rounds are separate things.** The files under [`suites/`](suites)
are the tests: evergreen, re-runnable, and **never ticked in place**.
[`runs/`](runs) is the history: one record per round. A suite never names a
round; a record is never a test.

The shape of this directory, the box grammar and the ID rules are the
tale-project standard ([`AGENTS.md`](../../../../AGENTS.md) "Manual tests"), and
`bun run lint:manual` enforces them.

## The files

| Path | What it is |
|---|---|
| [`readme.md`](readme.md) | this guide — how a round works, how a box works, how to judge |
| [`setup.md`](setup.md) | the environment: the stack's modes, ports, sign-in, and the smoke checklist |
| [`template.md`](template.md) | the shape of a NEW suite, and the authoring conventions |
| [`suites/`](suites) | the tests — one file per area, listed below |
| [`reference/automation.md`](reference/automation.md) | what the automated specs already own — **read before hand-verifying anything** |
| [`reference/not-a-finding.md`](reference/not-a-finding.md) | out of scope · product quirks · known debt (`BL-n`) |
| [`reference/error-codes.md`](reference/error-codes.md) | every error surface and how to provoke it |
| [`reference/pins.md`](reference/pins.md) | why a box says what it says — read before rewording one |
| [`runs/readme.md`](runs/readme.md) | the round journal + how to close a round |
| [`runs/template.md`](runs/template.md) | the round record to copy to `r<nnnn>.md` |
| [`runs/template-session-log.md`](runs/template-session-log.md) | the tick-as-you-go log to copy **outside** the repo |

## The suites

120 boxes across 8 suites. Every suite declares the ID prefix its
boxes carry, in its header blockquote; a box ID is unique across this whole
directory and greppable as one token.

| Suite | Prefix | Area | Boxes |
|---|---|---|---|
| [accessibility](suites/accessibility.md) | `A11Y-` | cross-cutting WCAG 2.1 AA sweep | 11 |
| [forms](suites/forms.md) | `FORM-` | contact + request-demo forms end-to-end, incl. the Discord delivery path | 21 |
| [locale](suites/locale.md) | `LOC-` | locale switching, `/de` + `/fr` trees, translated content | 14 |
| [navigation](suites/navigation.md) | `NAV-` | page inventory, header/footer nav, legal pages, changelog timeline, 404s | 20 |
| [platform-pages](suites/platform-pages.md) | `PAGE-` | the `/platform` hub + six module pages, demo scenes/tours, `/changelog` | 19 |
| [responsive](suites/responsive.md) | `RESP-` | mobile menu, narrow viewports, no-overflow | 10 |
| [seo](suites/seo.md) | `SEO-` | prerendered titles/canonicals, JSON-LD, security headers, sitemap, llms.txt | 14 |
| [theme](suites/theme.md) | `THEME-` | light/dark/system switching, persistence, no-flash, themed demo scenes | 11 |

## How a round runs

1. **Baseline an untouched tree.** Every gate green before you judge anything.
2. **Set up** — the stack, the mode, the signed-in session
   ([setup.md](setup.md)), then its smoke checklist.
3. **Copy the templates** — the [session log](runs/template-session-log.md) to
   `/tmp/tale-qa/r<nnnn>/`, and tick there.
4. **Smoke first** if you are short on time ([below](#smoke-subset)); red ⇒
   stop and fix before touring.
5. **Run the suites you mean to run.** Auth first where a suite needs a
   session; the cross-cutting sweeps last.
6. **Log as you go**, citing box IDs, with evidence under
   `/tmp/tale-qa/r<nnnn>/<box-id>/`.
7. **Fix in batches after the pass**, re-running every gate after each batch.
8. **Close the round** — record, journal row, pins, registers
   ([runs/readme.md](runs/readme.md#closing-a-round)).

Keep devtools open throughout. **An unexpected console message at error level
is always a finding, on any page** — check it against the known-benign list in
[`not-a-finding.md`](reference/not-a-finding.md) first.



## Choosing what to run

| Profile | Run | When |
|---|---|---|
| **Smoke** | the [boxes below](#smoke-subset) | before investing in anything bigger; after a dependency bump |
| **Change-scoped** | the suites the change touches | the ordinary case — a feature or a fix landed |
| **Full** | every suite | before a release, after a platform-level change (auth, router, data layer), or when a round is asked for by name |

Change-scoped, by area:

| What changed | Run |
|---|---|
| cross-cutting WCAG 2.1 AA sweep | [accessibility](suites/accessibility.md) (`A11Y-`) |
| contact + request-demo forms end-to-end | [forms](suites/forms.md) (`FORM-`) |
| locale switching | [locale](suites/locale.md) (`LOC-`) |
| page inventory | [navigation](suites/navigation.md) (`NAV-`) |
| the `/platform` hub + six module pages | [platform-pages](suites/platform-pages.md) (`PAGE-`) |
| mobile menu | [responsive](suites/responsive.md) (`RESP-`) |
| prerendered titles/canonicals | [seo](suites/seo.md) (`SEO-`) |
| light/dark/system switching | [theme](suites/theme.md) (`THEME-`) |

<a id="smoke-subset"></a>

## Smoke subset

A fast "is this build even drivable" pass. Green ⇒ proceed; red ⇒ stop and fix.

| Box | Proves |
|---|---|
| `NAV-F1` | every page in the inventory renders |
| `NAV-B1` | an unknown route 404s properly |
| `LOC-F1` | each locale tree resolves |
| `FORM-F1` | the contact form renders and validates |
| `SEO-F1` | the head tags are present |

## How a box works

Every box is one line of markdown that a round can tick, cite and diff:

```
- [ ] `NAV-F3` · **Back/forward** — Visit chat → projects → agents, then
  browser Back twice → the URL and the visible section track each entry.
```

- **Do the bolded action, judge against everything after the `→`.** A box that
  bundles several judgments still passes only if all of them hold.
- **The ID is a stable contract.** Session logs, round records,
  [`pins.md`](reference/pins.md) and the automation register all cite them.
  **Append, never renumber.**
- **Keep the boxes in these files empty.** Tick in the session log; findings go
  to the log, then to a [record](runs) — never into a suite.
- **A box states what to check and why the expectation is what it is.** Where
  the "why" is a war story, it lives in [`pins.md`](reference/pins.md) instead,
  so the box stays readable.
- Anything listed in
  [`not-a-finding.md`](reference/not-a-finding.md) is **not a finding at any
  severity** — cite the entry and move on.

ID scheme — the letter after the prefix is the kind of check the box makes,
carried over from the guides these suites came from:

| Form | Means | Example |
|---|---|---|
| `<PREFIX>F<n>` | functional | NAV-F3 |
| `<PREFIX>B<n>` | boundary / error | NAV-B1 |
| `<PREFIX>A<n>` | accessibility | NAV-A2 |
| `<PREFIX>P<n>` | performance | NAV-P1 |
| a trailing letter | a box appended between two existing ones — **part of the ID**, not a position | NAV-F3a |
| `BL-<n>` | a known-debt entry, not a box | BL-1 |

## Judging

Ask, in this order:

1. **Is it already owned by a spec?**
   ([`automation.md`](reference/automation.md)) — then it is not a manual
   finding; a red there is a spec failure, and it belongs in the gate, not the
   round.
2. **Is it on a register?** ([`not-a-finding.md`](reference/not-a-finding.md))
   — out of scope, a product quirk, or known debt: cite it and move on.
3. **Does a box say otherwise?** Read [`pins.md`](reference/pins.md) before
   deciding the box is wrong — the wording is usually specific on purpose.
4. **Then file it**, with exactly one severity.

### Severity rubric

| Severity | Means | Examples |
|---|---|---|
| `blocker` | Data loss, an auth/tenant-isolation breach, a crash, or a core path with **no** workaround. | One org can read another's thread; a save throws and loses the draft. |
| `bug` | Wrong behaviour with a workaround, or a violated documented contract. | A DE date renders in en-US format; a toast names the wrong file. |
| `polish` | Cosmetic / UX nit, no functional impact. | Truncation one char too early; a focus ring is faint. |
| `docs` | These files, the service readme or the user docs are inaccurate. | The guide names a route the router no longer has. |

## Failure policy

When a box fails: assign the next `R<round>-<box-id>`, capture evidence
(screenshot + console transcript) to `/tmp/tale-qa/r<nnnn>/<box-id>/`, then
decide whether to continue.

| Situation | Do |
|---|---|
| a **blocker on a state-feeding box** (anything a later box depends on) | halt that suite; reset and restart it once the fix lands |
| an **isolated or read-only failure** | log it and **continue**, so one bug does not mask the rest |
| any failure, mid-suite | **never fix in place** — fixes are a separate batched phase, so a round's findings stay comparable |

## Changing the suites

- **New behaviour earns a box** wherever a human still has to judge it — and
  **loses one** once a spec owns it end to end (move the row into
  [`automation.md`](reference/automation.md) instead).
- **Append IDs; never renumber one.**
- **Keep a box about the product**, not about the round that wrote it: the
  round belongs in [`runs/`](runs), the reason a box is worded oddly belongs in
  [`pins.md`](reference/pins.md).
- **A suite edit is a code change.** Change a flow, a route, a label or a cap,
  and the box that asserts it moves in the same commit — a stale box costs the
  next round a false finding.
