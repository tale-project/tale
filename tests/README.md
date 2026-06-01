# AI-directed test guides

Modular, AI-directed test documentation for comprehensive site testing. Each guide is a self-contained playbook for one feature module: it lists concrete, codebase-grounded test cases (functional, boundary, API/integration, accessibility, performance) and an **Issues Found** table for collecting discovered problems.

These are manual / AI-agent testing playbooks — not the automated suites. Unit and component tests live in `services/*/`; this directory is for end-to-end, exploratory, and accessibility passes driven by a human or an AI agent against a running instance.

## How to use

1. Bring a clean instance up once via [`FULL_SITE_TESTING.md`](FULL_SITE_TESTING.md) (steps 1–5) — every module guide assumes that environment and the seeded admin (`admin@admin.test` / `Admin@123`).
2. Run the modules in dependency order: **Auth first**, then Chat, then the rest.
3. For each defect, add a row to that guide's **Issues Found** table with the test ID, page, severity, description, and screenshot.
4. Finish with [`ACCESSIBILITY_TESTING.md`](ACCESSIBILITY_TESTING.md) as a cross-cutting WCAG 2.1 AA sweep.

## Guides

| Guide                                                            | Module                                                           |
| ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| [`FULL_SITE_TESTING.md`](FULL_SITE_TESTING.md)                   | Smoke test — every page loads, environment bring-up              |
| [`AUTH_TESTING.md`](AUTH_TESTING.md)                             | Authentication, account model, password policy, 2FA, lockout     |
| [`CHAT_TESTING.md`](CHAT_TESTING.md)                             | AI chat: messages, attachments, tool surface, arena, voice       |
| [`CONVERSATIONS_TESTING.md`](CONVERSATIONS_TESTING.md)           | Inbox: statuses, priority, bulk actions, AI reply assistance     |
| [`APPROVALS_TESTING.md`](APPROVALS_TESTING.md)                   | Approval workflows: lifecycle, confidence, audit                 |
| [`AUTOMATIONS_TESTING.md`](AUTOMATIONS_TESTING.md)               | Workflows: triggers, step types, action catalogue, schedules     |
| [`KNOWLEDGE_BASE_TESTING.md`](KNOWLEDGE_BASE_TESTING.md)         | Products, Customers, Documents, Websites, Vendors, Tone of Voice |
| [`SETTINGS_TESTING.md`](SETTINGS_TESTING.md)                     | Account, People & Teams, Providers, Integrations, Governance     |
| [`ACCESSIBILITY_TESTING.md`](ACCESSIBILITY_TESTING.md)           | Cross-cutting WCAG 2.1 AA sweep                                  |
| [`PROTEL_INTEGRATION_TESTING.md`](PROTEL_INTEGRATION_TESTING.md) | Protel PMS integration                                           |

## Shared template

Each module guide follows the same shape so coverage is comparable across modules:

```
# [Module] Testing Guide (AI-Directed)
> Purpose
## Prerequisites          (references FULL_SITE_TESTING.md for bring-up)
## Screenshot Setup
## Functional tests
## Boundary & error tests
## API / integration tests
## Accessibility tests (WCAG 2.1 AA)
## Performance tests
## Issues Found            (collection table)
## Test summary
```
