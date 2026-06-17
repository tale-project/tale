---
description: Run a manual test guide against the running app in a real browser
argument-hint: <area> e.g. chat, auth, agents, projects, knowledge, conversations, automations, settings, governance, notifications, navigation, accessibility, responsive, performance
allowed-tools: Read, Write, Bash, Skill, mcp__playwright__*
---

Execute the manual QA guide for **$ARGUMENTS** against a running Tale platform
instance, driving the browser via the Playwright MCP.

Follow the [`browser-qa`](../skills/browser-qa/SKILL.md) skill end to end:

1. **Resolve the guide.** Read `services/platform/tests/manual/$ARGUMENTS.md`. If `$ARGUMENTS` is
   empty or doesn't match a guide, list the guides from
   `services/platform/tests/manual/README.md` and ask which to run — do not guess.
2. **Bring up + authenticate.** Ensure `http://localhost:3000` is up and you're
   signed in (see `services/platform/tests/manual/SETUP.md`). Prefer **mode A** (mock LLM) for
   deterministic chat. Reuse a running stack if one exists.
3. **Run the cases in order** (Functional → Boundary → Accessibility →
   Performance). Honour the guide's Prerequisites and its **Agent note**.
   Locate every control by role + the i18n label named in the case (resolve the
   text from `services/platform/messages/en.json`), never by CSS. Use
   `browser_navigate` / `browser_snapshot` / `browser_click` / `browser_type` /
   `browser_wait_for` / `browser_console_messages` / `browser_take_screenshot`.
   For a chat turn, wait on Send re-enabling, not on text.
4. **Record defects.** Write findings to
   `services/platform/tests/screenshots/<YYYY-MM-DD_HH_MM>/$ARGUMENTS/results.md` using the guide's
   Issues Found columns (test id, route, severity, description, screenshot),
   with screenshots in the same folder. Do **not** edit the committed guide —
   it's a reusable template.
5. **Skip what the environment can't support** (WebAuthn, SSO, fresh-DB
   first-run) and say which and why.
6. **Report.** Print the guide's Test-summary scorecard with PASS/FAIL and issue
   counts. Clean up throwaway data and restore any toggled settings.
