---
name: browser-qa
description: How to drive the Tale platform in a real browser (Playwright MCP) to RUN the manual test guides in services/platform/tests/manual/. Read before QAing the app, running a manual test plan, verifying a UI change against a running instance, browsing the running app, or running the /qa command. Covers stack bring-up (mock vs full dev), authentication, mock-LLM determinism, stable locators (role + i18n label, never CSS), the navigate→snapshot→act→wait→verify→record loop, and recording screenshots/results. Writing automated specs instead lives in tests/e2e/AGENTS.md (the testing skill).
---

# browser-qa

The contract for driving the Tale **platform** through a browser to **run** the
manual test guides in
[`services/platform/tests/manual/`](../../../services/platform/tests/manual/README.md)
(e.g. `auth.md`, `chat.md`, `agents.md`, `governance.md`). The browser is the
Playwright MCP server — configured in [`.mcp.json`](../../../.mcp.json) (headless
Chrome, `--isolated` profile, `--output-dir=.playwright-mcp` with `--save-session`
traces, `--config=playwright-mcp.config.json` pinning locale `en-US`).

## When this applies

Read this when asked to QA the app, run a manual plan, verify a UI change in the
running app, browse a running instance, or run the [`/qa <area>`](../../commands/qa.md)
command (which loads one guide and runs it end-to-end). Adjacent skills:

- **Writing or extending the automated Playwright specs** →
  [`services/platform/tests/e2e/AGENTS.md`](../../../services/platform/tests/e2e/AGENTS.md),
  surfaced by [`testing`](../testing/SKILL.md). This skill _runs_ guides; that one
  _authors_ CI specs.
- **Verifying a specific change works** end-to-end → [`verify`](../verify/SKILL.md)
  (its UI step delegates here).
- **Labels render in a non-English locale** → resolve via [`translation`](../translation/SKILL.md).

## 1. Bring the stack up

The browser drives a **running** instance at `http://localhost:3000`. Reuse one if
`browser_navigate` to the base URL succeeds; otherwise start it. Full recipe (env
vars, ports, seed data) in
[`SETUP.md`](../../../services/platform/tests/manual/SETUP.md):

- **Mode A — deterministic / offline** (default for chat + AI runs): start the
  mock gateway with `bun lib/mocks/start.ts` (from `services/platform`, port 4141 —
  it mocks chat + AI + integration APIs), then the dev stack pointed at the
  hermetic fixtures (`TALE_DEV_SKIP_DOCKER=1`, `TALE_CONFIG_DIR=…/e2e/fixtures/config`,
  `TALE_PROVIDER_KEY_E2E_MOCK`, `TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1`,
  `TALE_MOCK_INTEGRATIONS_BASE=http://127.0.0.1:4141`). Every new org is seeded
  (agent `E2E Assistant`, mock provider, `Summarize Text` prompt, `test` workflow)
  and chat returns a canned reply with no API key.
- **Mode B — full local dev**: `bun run dev` (repo root) or
  `bun run --filter @tale/platform dev:fast`, then configure an OpenRouter key in
  Settings → Providers.

Start servers in the background and poll the base URL until it answers before
navigating. Convex pre-warm dominates cold boot — be patient.

## 2. Authenticate

A fresh DB has no users. Three paths (details in SETUP.md §2):

1. **storageState (preferred for repeated runs)** — run
   [`scripts/save-auth-state.ts`](../../../services/platform/tests/manual/scripts/save-auth-state.ts)
   once to mint an owner + org and write a Playwright `storageState` file, then
   point the MCP server at it by adding `--storage-state=<path>` to the
   `playwright` args in `.mcp.json`. The browser then starts signed in.
2. **Sign-up loophole** — `POST /api/auth/sign-up/email` accepts new accounts even
   though the UI hides sign-up after the first user. The password must satisfy the
   policy (length + lower + upper + digit + special, e.g. `TaleE2E!Passw0rd`). A
   fresh user lands on `/dashboard/create-organization`; complete the wizard
   (name → Next → Skip provider → Go to dashboard).
3. **Existing account** — sign in at `/log-in`.

`{org}` in every guide is the 16+ char org id in the dashboard URL.

## 3. Locate by role + i18n label, never CSS

**Locale first.** `.mcp.json` pins the MCP browser to `en-US`, so labels should
match the `en.json` values the guides cite. But a stored personalization
preference can override the browser locale — a fresh account rendered the chrome
in **French** in one run. If labels don't match `en.json`, switch the workspace
language to English (Settings → Personalization) or treat each cited
`namespace.key` as the control's identity and match its value in the active locale
(`de.json` / `fr.json`) — see [`translation`](../translation/SKILL.md). Either way,
locate by ARIA role + visible name.

This is the rule that keeps a run from breaking on markup changes:

1. Call `browser_snapshot` for the accessibility tree (preferred over screenshots
   for locating — it carries roles and names).
2. Act on a node by its **role + visible name**. Every guide names the control's
   i18n key; resolve the English string from
   [`services/platform/messages/en.json`](../../../services/platform/messages/en.json)
   when you need exact text — the same rule the e2e suite follows via
   `tests/e2e/helpers/i18n.ts`.
3. Never target generated class names or guess copy. If a control isn't in the a11y
   tree (canvas surfaces — the React Flow organigram and automation editor), fall
   back to the `vision` capability (coordinate clicks on a screenshot).

## 4. The MCP loop

For each test case: **navigate → snapshot → act → wait → verify → record**.

- `browser_navigate` to the case's route; `browser_snapshot` to orient.
- Act with `browser_click` / `browser_type` / `browser_fill_form` /
  `browser_select_option` / `browser_file_upload` by role + name.
- Wait on the authoritative signal, not a sleep: `browser_wait_for` text/an element
  to appear or disappear. For a **chat turn**, the terminal signal is **Send**
  re-enabling (the Send⇄Stop toggle), not text appearing.
- Verify the Expected: a URL change, an element/text visible, a toast string, or a
  **persisted value after reload** (reload, then read the field — never trust the
  transient success toast).
- `browser_console_messages` to catch console errors (ignore warnings). Capture a
  `browser_take_screenshot` into
  `services/platform/tests/screenshots/<YYYY-MM-DD_HH_MM>/<area>/` for any defect
  (`mkdir -p` it first). Traces land in `.playwright-mcp/` via `--save-session`.

## 5. Determinism & scenario triggers (mode A)

Any prompt returns the canned reply byte-for-byte. Lowercase keyword triggers in a
message exercise specific chat UI (defined in
[`lib/mocks/overrides/canned.ts`](../../../services/platform/lib/mocks/overrides/canned.ts)):
`e2e:reasoning` (thinking timeline), `e2e:nextsteps` (`[[NEXT_STEPS]]` block),
`e2e:humaninput` (`request_human_input` card), `e2e:error` (HTTP 500 on generation
→ provider-error UI; routing/title still succeed). A message with no trigger gets
the plain canned reply. Connecting an API-key integration runs its real
`testConnection` against the gateway, so it succeeds offline. Cases needing true
tool execution (`product_read`, `rag_search`, document generation, write-op
approvals) need real execution — run those in mode B.

## 6. Execute a guide

1. Read `services/platform/tests/manual/<area>.md`. Honour its **Prerequisites**
   (mode, role, seed data, governance flags) and the per-guide **Agent note**.
2. Run cases in order (Functional → Boundary → Accessibility → Performance). Skip
   ⛔ cases the environment can't support (WebAuthn, SSO, fresh-DB first-run) and
   say so.
3. For each defect, add a row to the guide's **Issues Found** table: test id,
   route, severity (crit/high/med/low), description, screenshot path. Do **not**
   edit the committed guide — record findings to a `results.md` in the screenshots
   folder (the `/qa` command writes there).
4. Fill the **Test summary** scorecard. Report a PASS/FAIL with the issue counts.
5. Leave the org as you found it — delete throwaway threads/agents/projects you
   created, and restore any settings/governance toggle you flipped.

## Where this fits

The manual guides are the _what_ to test; this skill is the _how_ to drive them in
a browser; the [e2e suite](../../../services/platform/tests/e2e/README.md) is the
automated subset that runs in CI ([`testing`](../testing/SKILL.md)). When a manual
case proves stable and valuable, promote it to a Playwright spec under the e2e
authoring contract.
