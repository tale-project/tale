# Manual test plans (AI-directed)

Modular, codebase-grounded test playbooks for the Tale **platform**, written so
either a human QA tester or an AI agent driving a browser can execute them
against a running instance. One guide per feature area; each lists concrete test
cases (functional, boundary/error, accessibility, performance), cross-references
the automated Playwright spec that already covers each case, and carries an
**Issues Found** table for collecting defects.

These are manual / exploratory / accessibility passes — **not** the automated
suites. Unit and component tests live in `services/*/`; the full-app Playwright
suite lives in [`services/platform/tests/e2e/`](../../services/platform/tests/e2e/README.md).
The `web` and `docs` services have their own guide sets in
[`services/web/tests/manual/`](../../../web/tests/manual/README.md) and
[`services/docs/tests/manual/`](../../../docs/tests/manual/README.md).

## How to use

1. Bring the stack up and sign in once via [SETUP.md](SETUP.md), then run its
   smoke checklist (every page loads).
2. Run guides in dependency order: **auth first**, then the rest.
3. Judge behaviour against the user docs: the pages under
   [`docs/en/platform/`](../../../../docs/en/platform/) are the behaviour
   reference (the oracle). Where a guide states no expected value, the area's
   docs page decides — a mismatch between the running app and its documented
   behaviour is a reportable defect (of one or the other), never a judgment
   call to resolve silently.
4. For each defect, add a row to that guide's **Issues Found** table (test id,
   route, severity, description, screenshot).
5. Finish with [accessibility.md](accessibility.md), [responsive.md](responsive.md),
   and [performance.md](performance.md) as cross-cutting sweeps.

An AI agent can run a whole guide by loading it and driving the app through the
Playwright MCP — proving behaviour by observing the real outcome, per the
[test-code](../../.agents/skills/test-code/SKILL.md) skill. New guides copy
[TEMPLATE.md](TEMPLATE.md) (which documents the authoring conventions).

## Guides

| Guide                                | Area                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| [auth.md](auth.md)                   | login, SSO, 2FA, passkeys, password policy, first-run setup, RBAC                    |
| [chat.md](chat.md)                   | messages, attachments, tools + approvals, arena, share, reasoning                    |
| [workspace.md](workspace.md)         | chat side panel: canvas viewers, workspace files, live browser + takeover, plan pane |
| [agents.md](agents.md)               | agent list + editor tabs, catalog, metrics                                           |
| [automations.md](automations.md)     | automations marketplace: catalog/empty, upload, install, run, per-project config     |
| [projects.md](projects.md)           | projects, tasks (attachments, comments), files, secrets, instructions, threads       |
| [knowledge.md](knowledge.md)         | documents, knowledge entries, products, contacts, websites                           |
| [conversations.md](conversations.md) | inbox: statuses, priority, search                                                    |
| [workflows.md](workflows.md)         | editor, configuration, triggers, executions, per-node run status                     |
| [settings.md](settings.md)           | account, personalization, org, teams, branding, connectors, API, providers, skills   |
| [connectors.md](connectors.md)       | connect/disconnect connectors; mailbox (IMAP/SMTP), Slack config, package upload     |
| [governance.md](governance.md)       | content models, guardrails, policies, run-code, legal hold, DSAR, logs, trash        |
| [notifications.md](notifications.md) | notification center, inbox reviews                                                   |
| [navigation.md](navigation.md)       | side-nav, breadcrumbs, command palette, changelog, page-loads                        |
| [accessibility.md](accessibility.md) | cross-cutting WCAG 2.1 AA sweep                                                      |
| [responsive.md](responsive.md)       | mobile viewport, bottom tab bar, mobile save bar                                     |
| [performance.md](performance.md)     | cold load, chat TTFT, thread switch, pagination                                      |

## Coverage matrix

Where the automated Playwright suite already exercises an area, the manual guide
focuses on the gaps. Status reflects the **area** as a whole; each guide's own
_Automated coverage_ table is case-by-case.

| Guide         | Status         | Automated by                                                                                                                                                                           |
| ------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| auth          | ✅ strong      | `auth`, `auth-account`, `onboarding`, `rbac`                                                                                                                                           |
| chat          | ✅ strong      | `chat-threads`, `chat-advanced`, `chat-features`, `chat-depth`, `chat-scenarios`, `search`                                                                                             |
| workspace     | ⛔ manual-only | — (component tests only: `workspace-file-tabs`, `chat-panel`; no e2e touches the panes)                                                                                                |
| agents        | ✅ strong      | `agents`, `agent-editor`                                                                                                                                                               |
| automations   | ⛔ manual-only | — (no spec; the whole automations surface is untested in e2e)                                                                                                                          |
| projects      | ✅ strong      | `projects`, `projects-depth`                                                                                                                                                           |
| knowledge     | ✅ strong      | `knowledge`                                                                                                                                                                            |
| conversations | 🔶 partial     | `conversations` (read-only / empty-state only; status transitions, bulk actions, search uncovered — and transitions currently FAIL, crit audit-log RLS defect, see the guide's Issues) |
| workflows     | ✅ strong      | `workflow-editor`                                                                                                                                                                      |
| settings      | ✅ strong      | `settings`, `settings-depth`, `preferences`, `token-sources`                                                                                                                           |
| connectors    | ✅ strong      | `connectors` (connect + offline `testConnection`)                                                                                                                                      |
| governance    | 🔶 partial     | `governance` (system-prompt, voice-output, run-code, content-safety toggle, budget guard; DSAR/legal-hold dialogs, logs, security-monitoring, usage, trash uncovered)                  |
| notifications | ⛔ manual-only | — (no spec)                                                                                                                                                                            |
| navigation    | ✅ strong      | `navigation`, `page-loads`, `search`, `keyboard`                                                                                                                                       |
| accessibility | 🔶 partial     | per-component vitest-axe; e2e `keyboard`, `responsive`                                                                                                                                 |
| responsive    | ✅ strong      | `responsive`                                                                                                                                                                           |
| performance   | ⛔ manual-only | — (load timing not asserted in e2e)                                                                                                                                                    |

Negative paths (invalid slugs, empty names, cascade-delete typed-phrase gating)
are automated by `validation.spec.ts` and live in each guide's _Boundary &
error_ section. List behaviours (search-filter, pagination) have no dedicated
spec; they are exercised piecemeal by the per-area specs and otherwise live in
the manual guides.

The enterprise & compliance-readiness features (per-API-key budgets, ODT
ingestion, Entra ID SSO real-error surfacing + issuer hardening, and the
Documentation menu link) are covered manually in the guides they belong to —
[governance](governance.md) (F4b/B6), [knowledge](knowledge.md) (F8), [auth](auth.md)
(F15/F16/B7), [settings](settings.md) (B5), and [navigation](navigation.md) (F11) —
and, where hermetically testable, by new e2e cases in `governance.spec.ts`,
`knowledge.spec.ts`, `auth.spec.ts`, and `navigation.spec.ts`.
