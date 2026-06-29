---
name: browser-qa
description: Drive the Tale platform in a real browser via Playwright MCP to RUN the manual test guides in services/platform/tests/manual/. Read before QAing the app, running a manual test plan, verifying a UI change against a running instance, browsing the running app, or running the /qa command. Covers stack bring-up (mock vs full dev), authentication, mock-LLM determinism, stable locators (role + i18n label, never CSS), the navigate→snapshot→act→wait→verify→record loop, and recording results. Authoring CI specs instead lives in the testing skill.
---

# browser-qa

How to drive the Tale **platform** through a real browser to **run** the manual test guides in
[`services/platform/tests/manual/`](../../../services/platform/tests/manual/README.md) (e.g. `auth.md`,
`chat.md`, `agents.md`, `governance.md`). The browser is the Playwright MCP server, configured in
[`.mcp.json`](../../../.mcp.json) (headless Chrome, `--isolated`, `--output-dir=.playwright-mcp` with
`--save-session` traces, `--config=playwright-mcp.config.json` pinning locale `en-US`). This skill
_runs_ guides; authoring the CI specs lives in
[`tests/e2e/AGENTS.md`](../../../services/platform/tests/e2e/AGENTS.md) (the [`testing`](../testing/SKILL.md) skill).

## When this applies

QAing the app, running a manual plan, verifying a UI change in the running app, browsing a running
instance, or running the [`/qa <area>`](../qa/SKILL.md) command (which loads one guide and runs
it end-to-end). Adjacent: verifying that one specific change works → [`verify`](../verify/SKILL.md)
(its UI step delegates here); labels rendering in a non-English locale → [`translation`](../translation/SKILL.md).

## The rules

- **Drive a running instance, never a fresh process per case.** The browser hits
  `http://localhost:3000`; reuse one if `browser_navigate` to the base URL succeeds, else start it.
  Convex pre-warm dominates cold boot — start servers in the background and poll the base URL until it
  answers before navigating. Two modes (full env/ports/seed recipe in
  [`SETUP.md`](../../../services/platform/tests/manual/SETUP.md)):
  - **Mode A — deterministic / offline** (default for chat + AI runs): start the mock gateway with
    `bun lib/mocks/start.ts` (from `services/platform`, port 4141 — mocks chat + AI + integration APIs),
    then the dev stack pointed at hermetic fixtures (`TALE_DEV_SKIP_DOCKER=1`,
    `TALE_CONFIG_DIR=…/e2e/fixtures/config`, `TALE_PROVIDER_KEY_E2E_MOCK`,
    `TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1`, `TALE_MOCK_INTEGRATIONS_BASE=http://127.0.0.1:4141`). Every
    new org is seeded (agent `E2E Assistant`, mock provider, `Summarize Text` prompt, `test` workflow)
    and chat returns a canned reply with no API key.
  - **Mode B — full local dev**: `bun run dev` (repo root) or `bun run --filter @tale/platform dev:fast`,
    then configure an OpenRouter key in Settings → Providers. Required for cases needing true tool
    execution (`product_read`, `rag_search`, document generation, write-op approvals).

- **Locate by ARIA role + visible name, never CSS.** Generated class names break a run on any markup
  change; the a11y tree is stable. `browser_snapshot` first (it carries roles + names, unlike a
  screenshot); act on a node by role + name. Every guide names the control's i18n key — resolve the
  exact string from [`services/platform/messages/en.json`](../../../services/platform/messages/en.json)
  (the same rule the e2e suite follows via
  [`tests/e2e/helpers/i18n.ts`](../../../services/platform/tests/e2e/helpers/i18n.ts)). If a control
  isn't in the a11y tree (canvas surfaces — the React Flow organigram, the automation editor), fall
  back to the `vision` capability (coordinate clicks on a screenshot).

- **Locale first.** `.mcp.json` pins the browser to `en-US`, so labels should match `en.json`. But a
  stored personalization preference can override it — a fresh account once rendered the chrome in
  French. If labels don't match, switch the workspace language to English (Settings → Personalization)
  or treat each cited `namespace.key` as the control's identity and match its value in the active locale
  (`de.json` / `fr.json`); see [`translation`](../translation/SKILL.md).

- **Verify the persisted outcome, not the toast.** A success toast is transient and lies about
  persistence — reload, then read the field back. (reviewer-caught)

- **Leave the org as you found it.** Delete throwaway threads/agents/projects you created; restore any
  settings/governance toggle you flipped. A polluted org breaks the next run's seed assumptions.

## Patterns

**The MCP loop — per test case: navigate → snapshot → act → wait → verify → record.**

- `browser_navigate` to the case's route; `browser_snapshot` to orient.
- Act with `browser_click` / `browser_type` / `browser_fill_form` / `browser_select_option` /
  `browser_file_upload` by role + name.
- **Wait on the authoritative signal, not a sleep.** `browser_wait_for` text/an element to appear or
  disappear. For a **chat turn**, the terminal signal is **Send** re-enabling (the Send⇄Stop toggle),
  not text appearing.
- Verify the Expected: a URL change, an element/text visible, a toast string, or a persisted value
  after reload.
- `browser_console_messages` to catch console errors (ignore warnings). On any defect,
  `browser_take_screenshot` into `services/platform/tests/screenshots/<YYYY-MM-DD_HH_MM>/<area>/`
  (`mkdir -p` it first). Traces land in `.playwright-mcp/` via `--save-session`.

**Authenticate** — a fresh DB has no users; three paths (details in SETUP.md §2):

1. **storageState (preferred for repeated runs)** — run
   [`scripts/save-auth-state.ts`](../../../services/platform/tests/manual/scripts/save-auth-state.ts)
   once to mint an owner + org and write a Playwright `storageState`, then add `--storage-state=<path>`
   to the `playwright` args in `.mcp.json`. The browser starts signed in.
2. **Sign-up loophole** — `POST /api/auth/sign-up/email` accepts new accounts even though the UI hides
   sign-up after the first user. Password must satisfy the policy (length + lower + upper + digit +
   special, e.g. `TaleE2E!Passw0rd`). A fresh user lands on `/dashboard/create-organization`; complete
   the wizard (name → Next → Skip provider → Go to dashboard).
3. **Existing account** — sign in at `/log-in`.

`{org}` in every guide is the 16+ char org id in the dashboard URL.

**Mode-A determinism** — any prompt returns the canned reply byte-for-byte. Lowercase keyword triggers
exercise specific chat UI (defined in
[`lib/mocks/overrides/canned.ts`](../../../services/platform/lib/mocks/overrides/canned.ts)):
`e2e:reasoning` (thinking timeline), `e2e:nextsteps` (`[[NEXT_STEPS]]` block), `e2e:humaninput`
(`request_human_input` card), `e2e:error` (HTTP 500 on generation → provider-error UI; routing/title
still succeed). No trigger → plain canned reply. An API-key integration's `testConnection` runs against
the gateway, so it succeeds offline.

**Execute a guide** — read `services/platform/tests/manual/<area>.md`; honour its **Prerequisites**
(mode, role, seed data, governance flags) and **Agent note**. Run cases in order
(Functional → Boundary → Accessibility → Performance); skip ⛔ cases the environment can't support
(WebAuthn, SSO, fresh-DB first-run) and say so. Record each defect to a `results.md` in the screenshots
folder (the `/qa` command writes there) — never edit the committed guide. Fill the **Test summary**
scorecard and report PASS/FAIL with issue counts. When a manual case proves stable and valuable,
promote it to a Playwright spec under the e2e authoring contract ([`testing`](../testing/SKILL.md)).
