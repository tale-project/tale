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
Playwright MCP — always proving behaviour by observing the real outcome, never
by assuming a step worked. New guides copy [TEMPLATE.md](TEMPLATE.md) (which
documents the authoring conventions).

## Guides

| Guide                                  | Area                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| [auth.md](auth.md)                     | login, SSO, 2FA, passkeys, password policy, first-run setup, RBAC                    |
| [chat.md](chat.md)                     | messages, attachments, tools + approvals, arena, share, reasoning                    |
| [automations.md](automations.md)       | draft→deploy→version automations: list, builder, upload, trigger, runs, bindings     |
| [approvals.md](approvals.md)           | human-in-the-loop: run approval/ask cards, task review gate, DSAR dual-approval      |
| [projects.md](projects.md)             | projects, agents, tasks (attachments, comments), files, secrets, threads             |
| [tasks.md](tasks.md)                   | project task board/list: DnD lanes, task sheet, agent runs, outputs, review          |
| [knowledge.md](knowledge.md)           | documents, knowledge entries, products, contacts, websites                           |
| [conversations.md](conversations.md)   | the shared Inbox: statuses, priority, search, mailbox sync                           |
| [settings.md](settings.md)             | account, personalization, org, teams, branding, connectors, API, providers           |
| [connectors.md](connectors.md)         | credential table + catalog picker; mailbox (IMAP/SMTP), OAuth, MCP endpoint          |
| [skills.md](skills.md)                 | skill library: table + facets, create/upload bundles, visibility, equip on agents    |
| [governance.md](governance.md)         | content models, guardrails, policies, run-code, legal hold, DSAR, logs, trash        |
| [metrics.md](metrics.md)               | org metrics tabs: usage, feedback, chat health, harness turns, automations, projects |
| [notifications.md](notifications.md)   | the notification bell + panel                                                        |
| [navigation.md](navigation.md)         | side-nav, breadcrumbs, command palette, changelog, page-loads                        |
| [data-residency.md](data-residency.md) | BYO knowledge database + object storage, embedding settings                          |
| [video-links.md](video-links.md)       | YouTube/video link ingestion (backend pipeline)                                      |
| [accessibility.md](accessibility.md)   | cross-cutting WCAG 2.1 AA sweep                                                      |
| [responsive.md](responsive.md)         | mobile viewport, bottom tab bar, mobile save bar                                     |
| [performance.md](performance.md)       | cold load, chat TTFT, thread switch, pagination                                      |

## Coverage matrix

Where the automated Playwright suite already exercises an area, the manual guide
focuses on the gaps. Status reflects the **area** as a whole; each guide's own
_Automated coverage_ table is case-by-case.

| Guide          | Status         | Automated by                                                                                                                                                    |
| -------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| auth           | ✅ strong      | `auth`, `auth-account`, `onboarding`, `rbac`                                                                                                                    |
| chat           | ⛔ manual-only | — (the five `chat-*` specs were retired in #2857 and have no successor; `search` covers command-palette chat search only)                                       |
| automations    | ⛔ manual-only | — (`automations` + `email-automation` specs retired in #2857)                                                                                                   |
| approvals      | ⛔ manual-only | — (no spec; `run-ask-card.test.tsx` + the `convex/approvals/` and `convex/tasks/review_mutations` backend suites cover slices)                                  |
| projects       | ✅ strong      | `projects`, `projects-depth`                                                                                                                                    |
| tasks          | 🔶 partial     | `projects`, `projects-depth`, `return-loops` (create, both views, live-edit, assign); DnD, agent runs, transcript, review all manual                            |
| knowledge      | ⛔ manual-only | — (`knowledge` spec retired in #2857; `page-loads`/`navigation` render the routes only)                                                                         |
| conversations  | ⛔ manual-only | — (`email-automation` spec retired in #2857; status transitions, bulk actions, search all manual)                                                               |
| settings       | ✅ strong      | `settings`, `settings-depth`, `preferences`                                                                                                                     |
| connectors     | 🔶 partial     | `settings` (catalog rendering) + the connectors component suite; connect/credential flows manual                                                                |
| governance     | 🔶 partial     | `governance` (system-prompt, voice-output, run-code, content-safety toggle, budget guard; DSAR/legal-hold dialogs, logs, security-monitoring, trash uncovered)  |
| skills         | ⛔ manual-only | — (no spec; logic-only unit tests `skill-filters.test.ts`, `skill-load-error.test.ts` + the `convex/skills/` backend suite)                                     |
| metrics        | 🔶 partial     | `metrics` (usage/feedback/automations/projects tabs render, empty data); chat-health + harness-turns tabs component-tested only; redirects, gating, data manual |
| notifications  | ⛔ manual-only | — (no spec)                                                                                                                                                     |
| navigation     | ✅ strong      | `navigation`, `page-loads`, `search`, `keyboard`                                                                                                                |
| data-residency | 🔶 partial     | backend vitest suites (config store, S3, external knowledge DB); no e2e drives the settings page                                                                |
| video-links    | ⛔ manual-only | — (backend unit tests only, e.g. `convex/video_links/ytdlp.test.ts`; no e2e)                                                                                    |
| accessibility  | 🔶 partial     | per-component vitest-axe; e2e `keyboard`, `responsive`                                                                                                          |
| responsive     | ✅ strong      | `responsive`                                                                                                                                                    |
| performance    | ⛔ manual-only | — (load timing not asserted in e2e)                                                                                                                             |

Negative paths (invalid slugs, empty names, cascade-delete typed-phrase gating)
are automated by `validation.spec.ts` and live in each guide's _Boundary &
error_ section. List behaviours (search-filter, pagination) have no dedicated
spec; they are exercised piecemeal by the per-area specs and otherwise live in
the manual guides.

The enterprise & compliance-readiness features (per-API-key budgets, ODT
ingestion, Entra ID SSO real-error surfacing + issuer hardening, and the
Documentation menu link) are covered manually in the guides they belong to —
[governance](governance.md), [knowledge](knowledge.md), [auth](auth.md),
[settings](settings.md), and [navigation](navigation.md) — and, where
hermetically testable, by e2e cases in `governance.spec.ts`, `auth.spec.ts`,
and `navigation.spec.ts`.
