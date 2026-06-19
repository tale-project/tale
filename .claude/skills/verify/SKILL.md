---
name: verify
description: How to prove a change works by observing the real outcome — not by inspecting the diff. Read before declaring anything done, when asked to verify a fix/PR/feature, or when running the /verify command. Escalates from static checks to running the backend on the live deployment (Convex MCP) and driving the real UI (Playwright MCP), then codifies the check as a rerunnable test. Never claim a success you haven't observed.
---

# verify

A change is done when you have **observed the expected outcome and can show the evidence** — not
when the code looks right. This is the layer agents skip most, and the last gate before
[`ship`](../ship/SKILL.md). Backs the `/verify` command.

## When this applies

Before declaring anything done, when asked to verify a fix/PR/feature, and when `/verify` runs. Pick
the layer that matches the change — a backend-only change stops at layer 3; a UI change must reach 4.

## The rules

Escalate to match the change; **don't stop at the first green layer** — a green typecheck proves
nothing about behaviour.

1. **Static** — `bun run check` (format, lint, typecheck, tests) and, if a boundary changed, `bun run lint:sast`. Necessary, never sufficient.
2. **Unit/integration** — run the suite for the workspace you touched (`bun run --filter @tale/<workspace> test`). If the change isn't covered, write a test that captures the new behaviour and watch it go **red → green**. ([`testing`](../testing/SKILL.md))
3. **Backend behaviour** — if Convex changed, exercise the function on the **live deployment via the Convex MCP**: run the query/mutation with real args, read the logs and the returned shape, confirm it matches expectation. Inspecting the handler is not verifying it. ([`convex`](../convex/SKILL.md))
4. **Frontend/UI behaviour** — if a screen changed, drive the **real app via the Playwright MCP**: navigate → accessibility-snapshot → act (locate by **role + i18n label**, never brittle CSS/XY) → wait-for → assert → screenshot before/after → check console and network for errors. For a chat turn, wait on Send re-enabling, not on text, and use the mock-LLM determinism triggers. ([`browser-qa`](../browser-qa/SKILL.md))
5. **Codify** — turn the manual check into a **rerunnable artifact** (an e2e spec). Outcome-as-test, not outcome-as-claim — so the check survives in CI and the next change can't silently break it.

## Patterns

Browser verification, done well:

- Prefer the accessibility snapshot + role/label locators over coordinates — stable, and they double-check a11y.
- Use disposable, isolated sessions; screenshot at decision points, not every step.
- On failure, **re-snapshot and re-read** rather than blindly retrying the same click — recover, don't thrash.
- For a multi-step flow, write and run a Playwright script (a verified, rerunnable program), not a long ad-hoc click sequence.

Report **outcome vs. expectation** with the evidence attached (test output, screenshots, logs). If a
layer couldn't be verified here (no live backend, WebAuthn, fresh-DB first-run), say **which and
why** — an honest "couldn't verify X" beats a false "done".
