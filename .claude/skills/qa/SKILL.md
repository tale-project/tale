---
name: qa
description: Run one manual test guide end-to-end against a running Tale instance in a real browser via the Playwright MCP. Read when running the /qa command or asked to execute a specific manual test plan (chat, auth, agents, projects, knowledge, …) against a live instance. Resolves the guide, brings up + authenticates the stack (mock-LLM mode A for deterministic chat), runs the cases in order locating controls by role + i18n label, records defects with screenshots to a timestamped folder, and prints the scorecard. The browser-driving mechanics it leans on live in browser-qa.
argument-hint: '<area> e.g. chat, auth, agents, projects, knowledge, conversations, automations, settings, governance, notifications, navigation, accessibility, responsive, performance'
allowed-tools: Read, Write, Bash, Skill, mcp__playwright__*
---

# qa

Run one manual test guide against a running Tale instance, driving the browser through the Playwright
MCP. This is the invocable workflow; the how-to it leans on — stack bring-up, stable locators,
mock-LLM determinism, the act→verify loop, recording — is [`browser-qa`](../browser-qa/SKILL.md). Runs
as the `/qa <area>` command.

## When this applies

When `/qa <area>` runs, or the user asks to execute a specific manual test plan (chat, auth, agents,
projects, knowledge, …) against a live instance. To prove one specific change instead of a whole area,
use [`verify`](../verify/SKILL.md) (its UI step delegates here); authoring a CI spec is
[`testing`](../testing/SKILL.md).

## The rules

1. **Resolve the guide.** Read `services/platform/tests/manual/<area>.md`. If the area is empty or
   matches no guide, list the guides from `services/platform/tests/manual/README.md` and ask which to
   run — don't guess.
2. **Bring up + authenticate.** Ensure `http://localhost:3000` is up and you're signed in (see
   `services/platform/tests/manual/SETUP.md`). Prefer **mode A** (mock LLM) for deterministic chat.
   Reuse a running stack if one exists.
3. **Run the cases in order** — Functional → Boundary → Accessibility → Performance. Honour the
   guide's Prerequisites and its **Agent note**. Locate every control by **role + the i18n label**
   named in the case (resolve the text from `services/platform/messages/en.json`), never by CSS. For a
   chat turn, wait on Send re-enabling, not on streamed text.
4. **Record defects.** Write findings to
   `services/platform/tests/screenshots/<YYYY-MM-DD_HH_MM>/<area>/results.md` using the guide's Issues
   Found columns (test id, route, severity, description, screenshot), with screenshots in the same
   folder. **Do not edit the committed guide** — it's a reusable template.
5. **Skip what the environment can't support** (WebAuthn, SSO, fresh-DB first-run) and say which and why.
6. **Report.** Print the guide's Test-summary scorecard with PASS/FAIL and issue counts. Clean up
   throwaway data and restore any toggled settings.
