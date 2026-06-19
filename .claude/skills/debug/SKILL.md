---
name: debug
description: A structured method for chasing a bug to its root cause instead of patching the symptom. Read when investigating a failing test, a reported bug, flaky behaviour, or an error you don't yet understand. Reproduce → minimize → hypothesize → instrument → fix → regression-test — never change code before you can prove the cause.
---

# debug

The loop that turns a symptom into a proven root cause and a regression test that locks it shut. This
is the **fix** mode of [`engineering-approach`](../engineering-approach/SKILL.md); the fix itself is
easy — the discipline is not guessing.

## When this applies

A failing test, a reported bug, flaky behaviour, or an error you don't yet understand. Run the whole
loop in order — skipping a step is how a symptom-patch ships and the bug returns.

## The rules

- **Reproduce reliably first.** Find the smallest deterministic trigger (a failing test, a precise
  sequence) and capture the exact error, stack, and inputs. If you can't reproduce it, you can't know
  you fixed it. `reviewer-caught`.
- **Minimize the case.** Strip unrelated state until only the bug remains — a minimal repro usually
  points straight at the cause. `reviewer-caught`.
- **Hypothesize a specific, falsifiable cause** ("the query fires before auth, so identity is null"),
  not a vague hunch — read the relevant path and trace data + dependents. A vague theory can't be
  confirmed or killed. `reviewer-caught`.
- **Instrument to prove the cause before fixing.** Confirm or kill the hypothesis with evidence — a
  `console.warn`, the Convex MCP for live data/logs/schema, the Playwright console/network, a
  breakpoint. A fix on a guess just moves the bug. `reviewer-caught`.
- **Fix the root cause, minimally.** Change the cause, not the symptom; the smallest change that
  removes it. A drive-by refactor is a separate task and commit. `reviewer-caught`.
- **Write the regression test that fails on the old code and passes on the new**, then run
  [`verify`](../verify/SKILL.md) and the surrounding suite. Without it, this exact bug can return
  silently. `reviewer-caught`.

## Patterns

- **Rule out the environment before "fixing" a flaky test.** `--project server` Vitest tests are
  timing-sensitive (fake timers / `Date.now`) and flake under CPU starvation — run the server suite
  alone for a real verdict; and a hook mock returning a fresh object per render can infinite-loop. The
  known flake sources live in [`testing`](../testing/SKILL.md).
- **Cold-load / timing bugs** — check [`performance`](../performance/SKILL.md) for the auth-gating
  patterns before assuming a logic bug; queries that fire before WS auth look like data bugs but are
  ordering bugs.
- **Backend bugs** — run the function and read logs/schema via the Convex MCP rather than reasoning
  about it in the abstract.
- **Stuck after two honest hypotheses** — widen the lens (re-read the surrounding subsystem) or ask;
  don't thrash on a third guess.
