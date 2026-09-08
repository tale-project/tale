# Manual tests

The manual layer of the platform's test suite, beside the automated [e2e specs](../e2e) and the vitest lanes. Everything here is driven by a human (or an agent driving a browser) against a running instance: the edges no headless run can judge — layout, focus, downloads, printouts, live reactivity across two sessions, degraded modes, and exploratory pokes.

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

542 boxes across 20 suites. Every suite declares the ID prefix its
boxes carry, in its header blockquote; a box ID is unique across this whole
directory and greppable as one token.

| Suite | Prefix | Area | Boxes |
|---|---|---|---|
| [accessibility](suites/accessibility.md) | `A11Y-` | cross-cutting WCAG 2.1 AA sweep | 22 |
| [approvals](suites/approvals.md) | `APV-` | human-in-the-loop: run approval/ask cards, task review gate, DSAR dual-approval | 20 |
| [auth](suites/auth.md) | `AUTH-` | login, SSO, 2FA, passkeys, password policy, first-run setup, RBAC | 32 |
| [automations](suites/automations.md) | `AUTO-` | draft→deploy→version automations: list, builder, upload, trigger, runs, bindings | 52 |
| [chat](suites/chat.md) | `CHAT-` | messages, attachments, tools + approvals, arena, share, reasoning | 60 |
| [connectors](suites/connectors.md) | `CONN-` | credential table + catalog picker; mailbox (IMAP/SMTP), OAuth, MCP endpoint | 29 |
| [conversations](suites/conversations.md) | `CONV-` | the shared Inbox: statuses, priority, search, mailbox sync | 26 |
| [data-residency](suites/data-residency.md) | `DATA-` | BYO knowledge database + object storage, embedding settings | 15 |
| [governance](suites/governance.md) | `GOV-` | content models, guardrails, policies, legal hold, DSAR, logs, trash | 29 |
| [knowledge](suites/knowledge.md) | `KNOW-` | documents, knowledge entries, products, contacts, websites | 24 |
| [metrics](suites/metrics.md) | `MET-` | org metrics tabs: usage, feedback, chat health, harness turns, automations, projects | 17 |
| [navigation](suites/navigation.md) | `NAV-` | side-nav, breadcrumbs, command palette, changelog, page-loads | 25 |
| [notifications](suites/notifications.md) | `NOTIF-` | the notification bell + panel | 24 |
| [performance](suites/performance.md) | `PERF-` | cold load, chat TTFT, thread switch, pagination | 13 |
| [projects](suites/projects.md) | `PROJ-` | projects, agents, tasks (attachments, comments), files, secrets, threads | 31 |
| [responsive](suites/responsive.md) | `RESP-` | mobile viewport, bottom tab bar, mobile save bar | 16 |
| [settings](suites/settings.md) | `SET-` | account, personalization, org, teams, branding, connectors, API, providers | 52 |
| [skills](suites/skills.md) | `SKILL-` | skill library: table + facets, create/upload bundles, visibility, equip on agents | 18 |
| [tasks](suites/tasks.md) | `TASK-` | project task board/list: DnD lanes, task sheet, agent runs, outputs, review | 25 |
| [video-links](suites/video-links.md) | `VID-` | YouTube/video link ingestion (backend pipeline) | 12 |

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

**Judge behaviour against the user docs.** The pages under [`docs/en/platform/`](../../../../docs/en/platform) are the behaviour reference. Where a box states no expected value, the area's docs page decides — a mismatch between the running app and its documented behaviour is a reportable defect (of one or the other), never a judgment call to resolve silently.

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
| human-in-the-loop: run approval/ask cards | [approvals](suites/approvals.md) (`APV-`) |
| login | [auth](suites/auth.md) (`AUTH-`) |
| draft→deploy→version automations: list | [automations](suites/automations.md) (`AUTO-`) |
| messages | [chat](suites/chat.md) (`CHAT-`) |
| credential table + catalog picker | [connectors](suites/connectors.md) (`CONN-`) |
| the shared Inbox: statuses | [conversations](suites/conversations.md) (`CONV-`) |
| BYO knowledge database + object storage | [data-residency](suites/data-residency.md) (`DATA-`) |
| content models | [governance](suites/governance.md) (`GOV-`) |
| documents | [knowledge](suites/knowledge.md) (`KNOW-`) |
| org metrics tabs: usage | [metrics](suites/metrics.md) (`MET-`) |
| side-nav | [navigation](suites/navigation.md) (`NAV-`) |
| the notification bell + panel | [notifications](suites/notifications.md) (`NOTIF-`) |
| cold load | [performance](suites/performance.md) (`PERF-`) |
| projects | [projects](suites/projects.md) (`PROJ-`) |
| mobile viewport | [responsive](suites/responsive.md) (`RESP-`) |
| account | [settings](suites/settings.md) (`SET-`) |
| skill library: table + facets | [skills](suites/skills.md) (`SKILL-`) |
| project task board/list: DnD lanes | [tasks](suites/tasks.md) (`TASK-`) |
| YouTube/video link ingestion (backend pipeline) | [video-links](suites/video-links.md) (`VID-`) |

<a id="smoke-subset"></a>

## Smoke subset

A fast "is this build even drivable" pass. Green ⇒ proceed; red ⇒ stop and fix.

| Box | Proves |
|---|---|
| `AUTH-F1` | sign-in lands on the dashboard |
| `NAV-F1` | every rail item commits its route |
| `NAV-F9` | the render-only pages mount |
| `CHAT-F1` | a chat turn reaches a terminal state |
| `PROJ-F1` | a project opens and lists its tasks |
| `SET-F1` | settings lands on the role default |

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
