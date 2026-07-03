---
name: test-code
description: Use this skill whenever you test a change or prove it works — write tests that exercise real behaviour (happy path + one edge + one error), run them and watch red→green, drive the real app for anything user-visible, and codify the check so it can't silently break. Load it before writing or changing any test, adding an end-to-end spec, deciding what to cover, or whenever asked to "verify", "test", or "confirm it works". Never claim a change is done on a green typecheck alone — observe the real outcome.
---

# test-code

Two jobs in one skill: **write tests that carry the change**, and **prove behaviour by observing the
real outcome** — not by inspecting the diff. A green typecheck proves nothing about behaviour, and a
test that only asserts the code compiles is theatre. The bar: every feature and fix carries its test,
and every "done" is something you watched happen.

## When this applies

Writing or changing a test, adding an end-to-end spec, deciding what to cover, or when asked to verify
a change works. Driving the real app by hand for a one-off check is part of this too.

## Write a note first

**Invoke `write-notes`** and answer this form before you write tests:

- **What you're proving:** Describe the behaviour the test must pin down — the happy path, the edge, and the error.
- **Current coverage:** Describe what's already covered and what the existing tests assert, and where the gap is.
- **Affected parts:** Describe which other parts of the system depend on or share code/state with this change, and how you'll check they still work.
- **Layer & observation:** Describe how and where you'll watch the behaviour actually happen (red→green, real backend, the real app).
- **Risks & unknowns:** Describe what you can't verify here and why, and where a passing test might still be lying.

## Write tests that carry the change

- **Every feature and fix carries a test** — happy path **+ one edge + one error** condition, minimum.
- **Lock behaviour before you change it.** Touching untested code? Write the test that captures _today's_
  behaviour first, watch it pass, then change — now any regression is loud.
- **Cover the sweep set, not just the unit.** A change ripples — run the suites of the dependents
  enumerated in the sweep (`search-codebase`), and add a case where a dependent would break if your
  change is wrong. A green test on the changed unit while a neighbour silently breaks is the classic
  miss.
- **Watch a new test go red → green.** A test you never saw fail proves nothing: it might assert the
  wrong thing, or not run at all.
- **Query by role / accessible name, not by test-id or CSS.** An accessible-name query doubles as an
  accessibility check; a test-id couples the test to implementation details and skips that check.
- **Match the project's test conventions.** Discover the runner, the file naming and location, and the
  shared helpers from the existing tests and the config — don't invent a parallel style the next dev
  won't find.

## Prove behaviour — escalate to match the change

Don't stop at the first green layer:

1. **Static** — the project's lint/typecheck/test gate. Necessary, never sufficient.
2. **Unit / integration** — run the suite for what you touched; if it isn't covered, add the test and
   watch it go red → green.
3. **Backend behaviour** — exercise the function on a real backend with real arguments; read the logs
   and the returned shape. Inspecting the handler is not verifying it.
4. **Frontend / UI** — drive the real app (browser mechanics: `browse-web`): navigate → snapshot →
   act (locate by role + label) → wait on **authoritative state** (a control re-enabling, a reload
   settling), not on text appearing → assert → screenshot before/after → check the console and
   network for errors.
5. **Codify** — turn the manual check into a **rerunnable artifact** (a spec). Outcome-as-test, not
   outcome-as-claim — so it survives in CI and the next change can't silently break it.

Report **outcome vs expectation** with the evidence attached. If a layer couldn't be verified here (no
live backend, a hardware-key login, a fresh-DB first-run), say **which and why** — an honest "couldn't
verify X" beats a false "done".

## Gate B — before you call it tested

**Tick every box, or N/A with a reason — an unticked box means not done.**

- [ ] **Covered** — happy path + one edge + one error, and you watched the new test go red → green.
- [ ] **Sweep covered** — the suites of the dependents enumerated in the sweep (`search-codebase`) still pass, and a case guards the interaction most likely to regress.
- [ ] **Located by role / accessible name**, never test-id or CSS (for UI tests).
- [ ] **Matched the project's test conventions** — runner, file naming/location, shared helpers.
- [ ] **Observed** — behaviour watched at the right layer: backend exercised on a real backend, UI driven in the real app — not just a green typecheck.
- [ ] **Codified as a rerunnable artifact** so the next change can't silently break it.
- [ ] **Anything you couldn't verify is stated, with why.**

## Patterns

- **On a failing UI step, re-snapshot and re-read** rather than blindly retrying the same click —
  recover, don't thrash.
- **Don't tail-truncate a failing test run.** You'll throw away the failure detail you need to fix it.
- **A flaky test is a bug.** Rule out the environment (timing, CPU starvation, an unstable mock) before
  you "fix" logic that was never broken.
