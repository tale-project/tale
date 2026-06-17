---
name: verify
description: How to prove a change works by observing the real outcome — not by inspecting the diff. Read before declaring anything done, when asked to verify a fix/PR/feature, or when running the /verify command. Escalates from static checks to running the backend on the live deployment (Convex MCP) and driving the real UI (Playwright MCP), then codifies the check as a rerunnable test. Never claim a success you haven't observed.
---

# verify

A change is not done because the code looks right — it is done when you have **observed the expected
outcome and can show the evidence**. Verifying your own work is the step agents skip most; don't.
This skill backs the `/verify` command and is the last gate before [`ship`](../ship/SKILL.md).

## Escalate to match the change — don't stop at the first green layer

1. **Static** — `bun run check` (format, lint, typecheck, tests) and, if a boundary changed, `bun run lint:sast`. Necessary, never sufficient: a green typecheck proves nothing about behaviour.
2. **Unit/integration** — run the specific suite for the workspace you touched (`bun run --filter @tale/<workspace> test`). If the change isn't covered, write a test that captures the new behaviour and watch it go **red → green**. ([`testing`](../testing/SKILL.md))
3. **Backend behaviour** — if Convex changed, exercise the function on the **live deployment via the Convex MCP**: run the query/mutation with real args, read the logs and the returned shape, and confirm it matches expectation. Inspecting the handler is not verifying it. ([`convex`](../convex/SKILL.md))
4. **Frontend/UI behaviour** — if a screen changed, drive the **real app via the Playwright MCP** (see [`browser-qa`](../browser-qa/SKILL.md)):
   navigate → accessibility-snapshot → act (locate by **role + i18n label**, never brittle CSS/XY) → wait-for → assert → screenshot before/after → check the console and network for errors. For a chat turn, wait on Send re-enabling, not on text; use the mock-LLM determinism triggers.
5. **Codify** — turn the manual check into a **rerunnable artifact** (an e2e spec, or a small Playwright script). Outcome-as-test, not outcome-as-claim — so the check survives in CI and the next change can't silently break it.

## Browser verification, done well

- Prefer the accessibility snapshot + role/label locators over coordinates — they're stable and they double-check a11y.
- Use disposable, isolated sessions; capture screenshots at decision points, not every step.
- On failure, **re-snapshot and re-read** rather than blindly retrying the same click — recover, don't thrash.
- For a multi-step flow, write a Playwright script and run it (a verified, rerunnable program) instead of a long ad-hoc click sequence.

## Report honestly

State **outcome vs. expectation** and attach the evidence (test output, screenshots, logs). If a
layer couldn't be verified in this environment (no live backend, WebAuthn, fresh-DB first-run), say
**which and why** — an honest "couldn't verify X" is worth far more than a false "done".
