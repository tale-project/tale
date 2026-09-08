# R\<n\> — \<one line: what this round was for\>

> Copy to `r<nnnn>.md` (the round number zero-padded to four digits —
  `r0001.md`), fill it in from the session log, delete this quote block and
  every `<…>` placeholder. Keep the section order — rounds are read side by
  side. Drop a section only if it is genuinely empty, and say so in a line
  rather than leaving an empty heading.

| | |
|---|---|
| **Round** | R\<n\> |
| **Date** | \<YYYY-MM-DD\> (\<HH:MM TZ\>) |
| **Tree** | `<short sha>` at start · `<short sha>` at close |
| **Stack** | \<how it was run\> · \<ports\> |
| **Browser** | \<engine + version\> |
| **Viewports** | \<1440×900, plus any a box named\> |
| **State** | \<reset at every documented boundary · other\> |
| **Tester** | \<name / agent\> |

## Scope

\<Two or three sentences: why this round exists (a feature landed, a user
report, the catalogue a previous round left), and what it deliberately did not
touch.\>

## Baseline

- [ ] `bun run check` green on an **untouched** tree (\<n/n\> gates).
- [ ] `bun run lint:manual` green.
- [ ] \<the service's own preflight — one line per check\>
- [ ] Devtools console open, and open for the whole pass.

\<Anything that was already red before the round started belongs here, not in
the findings.\>

## What was exercised

Legend: ✅ green · ⚠️ finding (see below) · ❌ blocked · — not run.

| Suite | Boxes | Result | Notes |
|---|---|---|---|
| [navigation](../suites/navigation.md) | \<NAV-F1–NAV-F9\> | ✅ | \<personas, locales, anything worth naming\> |
| \<suite\> | \<boxes\> | ⚠️ | \<…\> |

## Findings

Severities per the [rubric](../readme.md#severity-rubric). One row each, most
severe first; the detail sits under the table.

| ID | Severity | Box | What |
|---|---|---|---|
| R\<n\>-1 | `bug` | `NAV-F3` | \<one line: what is wrong, not what to do about it\> |

\<Or: **No findings.** — and then say what was driven, so "clean" is
falsifiable.\>

### R\<n\>-1 · \<short title\>

**Surface** \<page / endpoint / component\> · **Repro** \<the shortest path to
it\> · **Expected vs actual** \<…\>

\<Why it happens — the mechanism, not the symptom. This paragraph is what the
pins register will quote.\>

**Fix** \<files touched, in one line\> · **Pinned by** \<the test that would
fail if this regressed\>

## Not reached

\<The catalogue this round left, box by box — the next round's scope. Say why
(time, a missing device, a blocked precondition), so nobody re-derives it.\>

## Verdict

\<One paragraph: what the round says about the tree. Was it clean? Did every fix
land and get re-driven for real? What is still open, and who owns it?\>

- [ ] Every finding fixed, or explicitly recorded as a product call.
- [ ] `bun run check` and `bun run lint:manual` green again after the last fix
  batch.
- [ ] Fixes re-driven by hand, not only in the test suite.
- [ ] [Closing checklist](readme.md#closing-a-round) worked through.
