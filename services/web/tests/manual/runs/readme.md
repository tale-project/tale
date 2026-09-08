# The round journal

One file per round, newest first: what was in scope, what it found, how it
ended. The tick-as-you-go session log stays **outside** the repo
(`/tmp/tale-qa/r0001/`); the record here is the durable trace.

**File naming.** A record is `r<nnnn>.md` — the round number **zero-padded to
four digits**, so the directory sorts in round order for good (`r0001.md`,
`r0002.md`, … `r0042.md`). Prose, journal rows and finding IDs use the bare
number (`R42`, `R42-NAV-F3`); only the filename pads.

**A record is history, not a test.** The [suites](../suites) are written to be
run again; a record describes one pass and is never rewritten afterwards. Found
a wrong expectation? Fix the suite and say so in the *new* round's record —
never edit an old one. Where an expectation exists *because* something went
wrong, the reason belongs in [`../reference/pins.md`](../reference/pins.md), not
in the record and not in the box text.

## Rounds

Newest first. `R<n>` numbers are consumed in order and never reused.

| Round | Date | Scope | Findings | Verdict |
|---|---|---|---|---|
| [R1](r0001.md) | 2026-09-08 | not a round — the findings the guides were carrying when they became suites | 1 blocker · 1 bug · 3 polish | carried over |

Column rules, so the table stays diffable:

| Column | Holds |
|---|---|
| **Round** | `[R<n>](r<nnnn>.md)` — the record's own link, e.g. `[R7](r0007.md)`. |
| **Date** | `YYYY-MM-DD`, or `YYYY-MM-DD/DD` when a round spans days. |
| **Scope** | one clause: what was driven, and what was deliberately left. |
| **Findings** | counts by severity (`2 bug · 1 polish`), or `0`. |
| **Verdict** | how it ended: `clean exit` · `fixed + pinned` · `filed + pinned` · `shipped`. |

## Running a round

1. **Copy the two templates.**
   [`template-session-log.md`](template-session-log.md) →
   `/tmp/tale-qa/r<nnnn>/log.md` (tick there, never in a suite),
   and later [`template.md`](template.md) → `r<nnnn>.md`.
2. **Baseline an untouched tree** — every gate green before you judge anything
   ([setup.md § baseline](../setup.md#baseline)).
3. **Set up** the stack and its accounts ([setup.md](../setup.md)).
4. **Run the suites you mean to run**, respecting every ordering contract they
   declare.
5. **Log as you go**, citing box IDs, with evidence under
   `/tmp/tale-qa/r<nnnn>/<box-id>/`.
6. **Fix in batches after the pass**, re-running every gate after each batch.
7. **Close the round** (below).

A round is **clean** when a full pass produces zero new findings.

## Recording findings

One line per finding in the session log, so rounds diff cleanly:

```
R<n>-<box-id> | <severity> | <surface> | <repro> | expected vs actual | fix (files) | verified by
```

Cite a real pin in the last field — the unit or e2e test that would fail if the
fix regressed. "Verified by hand" is only honest for a box no test can hold, and
that is itself worth recording.

## Closing a round

- [ ] `r<nnnn>.md` written from the session log, using
  [`template.md`](template.md).
- [ ] Its row added at the **top** of the [rounds table](#rounds).
- [ ] A row in [`../reference/pins.md`](../reference/pins.md) for every
  expectation this round **added or sharpened** in a suite — keyed by box, never
  by round.
- [ ] Anything permanent folded into the registers: a new box in a suite, a
  quirk or `BL-n` entry in
  [`../reference/not-a-finding.md`](../reference/not-a-finding.md), a row in
  [`../reference/automation.md`](../reference/automation.md) where a spec took
  the check over, a code in
  [`../reference/error-codes.md`](../reference/error-codes.md).
- [ ] Every gate green again after the last fix batch, `bun run lint:manual`
  included.
- [ ] The boxes in the suites are still **empty** (`- [ ]`) — ticks live in the
  session log.
