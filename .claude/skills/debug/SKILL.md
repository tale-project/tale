---
name: debug
description: A structured method for chasing a bug to its root cause instead of patching the symptom. Read when investigating a failing test, a reported bug, flaky behaviour, or an error you don't yet understand. Reproduce → minimize → hypothesize → instrument → fix → regression-test. The fix is the easy part; the discipline is not guessing.
---

# debug

Most bad fixes come from changing code before understanding the failure. Work the loop; resist the
urge to "try something." This is the **fix** mode of [`engineering-approach`](../engineering-approach/SKILL.md).

## The loop

1. **Reproduce — reliably.** Find the smallest, most deterministic way to trigger the bug (a failing test, a precise sequence). If you can't reproduce it, you can't know you fixed it. Capture the exact error, stack, and inputs.
2. **Minimize.** Strip the case down to the essential trigger — remove unrelated state until only the bug remains. A minimal repro usually points at the cause.
3. **Hypothesize.** Form a specific, falsifiable theory of the root cause ("the query fires before auth, so identity is null"), not a vague hunch. Read the relevant code path; trace data and dependents.
4. **Instrument.** Confirm or kill the hypothesis with evidence — a `console.warn`, the Convex MCP to inspect live data/logs, the Playwright console/network, a breakpoint. Don't fix on a guess; _prove_ the cause first.
5. **Fix the root cause, minimally.** Change the cause, not the symptom; the smallest change that removes it. Avoid drive-by refactors — those are a separate task and commit.
6. **Regression test.** Write the test that fails on the old code and passes on the new — capturing this exact bug so it can't return. Then run [`verify`](../verify/SKILL.md) and the surrounding suite.

## Tips for this repo

- **Cold-load / timing bugs** — the [`performance`](../performance/SKILL.md) skill documents the auth-gating and fake-timer flake patterns; check there before assuming a logic bug.
- **Backend** — reach for the Convex MCP to run the function and read logs/schema rather than reasoning about it in the abstract.
- **Flaky tests** — the [`testing`](../testing/SKILL.md) skill lists the known flake sources (CPU-starved `--project server`, fresh-object hook mocks). Rule out the environment before "fixing" the test.
- **When stuck after two honest hypotheses**, widen the lens: re-read the surrounding subsystem, or ask. Don't thrash.
