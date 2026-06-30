---
name: fix-bug
description: Use this skill whenever you investigate or fix a defect — a failing test, a reported bug, flaky behaviour, a crash, or an error you don't yet understand. It forces you to reproduce it, prove the cause with evidence, make the minimal fix, and lock it shut with a regression test. Load it the moment a task says "fix", "broken", "doesn't work", "regression", or pastes a stack trace or error message. Never patch a symptom without it — a guess just relocates the bug.
---

# fix-bug

A symptom patched on a guess just moves the bug. The discipline isn't the fix — it's **refusing to
change code until you can prove the cause**, and finding the real owner of the broken behaviour before
you touch anything. For new behaviour use `implement-feature`; for a structural change,
`make-improvement`; for the regression test itself, `test-code`; to open the PR, `create-pr`.

## When this applies

A failing test, a reported bug, flaky behaviour, a crash, or an error you don't yet understand. Run
the loop in order — skipping a step is how a symptom-patch ships and the bug comes back.

## Write a note first

**Invoke `write-notes`** and record your answers to this form before you change a line:

- **Symptom & repro:** Describe the exact observed behaviour and the smallest deterministic way to reproduce it.
- **Expected vs actual:** Describe what should happen instead and where exactly the two diverge.
- **Root cause:** Describe the cause and the evidence that proves it (a log, the data, a breakpoint) — and how you ruled out a guess.
- **The owner:** Describe which function or code path actually owns the broken behaviour, and how that differs from where the symptom surfaces.
- **Fix & regression test:** Describe the minimal change to the cause and the test that will fail on the old code and pass on the new.
- **Risks & unknowns:** Could this be a symptom of something deeper, or could the fix affect other callers? Describe where you might be wrong.

## Gate A — before you touch code

**Tick every box before you change a line** — you have not earned the right to fix until they hold:

- [ ] **Reproduced it reliably** — the smallest deterministic trigger, with the exact error, stack, and
      inputs captured. If you can't reproduce it, you can't know you fixed it.
- [ ] **Felt the status quo and found the real owner** — traced the actual code path and data to the
      function that owns the broken behaviour, not the first place the symptom surfaces. You read it; you
      didn't theorize from the abstract.
- [ ] **Minimized the case** — stripped unrelated state until only the bug remains.
- [ ] **Proved the cause with evidence** — a specific, falsifiable hypothesis confirmed or killed by a
      log line, the real backend's logs/data, the browser console/network, or a breakpoint, **before**
      changing code. A fix on a hunch just relocates the bug.

## Fix the cause, minimally

- **Change the cause, not the symptom** — the smallest change that removes it. A drive-by refactor or
  cleanup you noticed along the way is a separate task and a separate commit.
- **Match the file you're fixing** — discover its conventions and mirror them; a fix that looks foreign
  is a tell that you didn't read enough.

## Gate B — before you call it done

**Tick every box, or mark it N/A with a reason.** An unticked box means not done.

- [ ] **A regression test that fails on the old code and passes on the new** — you watched it do both.
      This is the deliverable, not an extra.
- [ ] **The surrounding suite is still green** — your fix didn't break a neighbour.
- [ ] **The blast radius is handled** — if the cause sat in shared code, the _other_ callers are checked.
- [ ] **Docs or error wording updated** if the bug was in something a user sees (or N/A).
- [ ] **The gate is green** — the project's format/lint/typecheck/test command passes.

Then take it to a clean PR with `create-pr`.

## Patterns

- **Rule out the environment before "fixing" a flaky test.** CPU starvation, fake-timer sensitivity,
  or a mock returning a fresh object per render can all masquerade as a logic bug. A flake "fixed" by
  changing code that was never broken is two bugs now.
- **Stuck after two honest hypotheses?** Widen the lens — re-read the surrounding subsystem — or ask.
  Don't thrash on a third guess.
