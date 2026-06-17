---
description: Prove a change works by observing the real outcome, not by inspection
argument-hint: [what changed] e.g. "customer tags field", "login redirect fix"
allowed-tools: Read, Bash, Skill, mcp__playwright__*, mcp__convex__*
---

Verify that **$ARGUMENTS** actually does what it's supposed to. A change is not done
because the code looks right — it is done when you have observed the expected outcome
and can show the evidence. Follow the [`verify`](../skills/verify/SKILL.md) skill.

Escalate to match the change; do not stop at the first green layer:

1. **Static** — `bun run check` and (if a boundary changed) `bun run lint:sast`. Necessary, never sufficient.
2. **Unit/integration** — run the specific suite for the touched workspace; if the change isn't
   covered, add a test that captures the new behaviour and watch it go red→green.
3. **Backend** — if Convex changed, exercise the function on the live deployment via the Convex MCP
   (run the query/mutation, read logs + schema) and confirm the data shape matches expectation.
4. **Frontend/UI** — if a screen changed, drive the real app via the Playwright MCP: navigate →
   snapshot → act (role + i18n label) → wait → assert → screenshot before/after → check the console
   for errors.
5. **Codify** — turn the manual check into a rerunnable artifact (an e2e spec) so it survives in CI.

Report outcome vs. expectation with evidence (test output, screenshots, logs). If a layer could not
be verified in this environment, say which and why — never claim a success you have not observed.
