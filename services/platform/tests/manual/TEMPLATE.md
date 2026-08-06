<!--
Canonical shape for every guide in this directory. Copy this file, rename it to
`<area>.md`, and fill each section. Keep the section order and the table columns
so coverage stays comparable across guides and an agent can parse any guide the
same way. Delete this comment in the copy.

Authoring conventions (READ THIS — it's why the guides are executable by both a
human and an AI agent):

1. Every test names its ROUTE. Write the URL with the `{org}` placeholder, e.g.
   `/dashboard/{org}/chat`. Pathless layout segments (`_auth`, `_knowledge`) do
   NOT appear in the URL — it's `/log-in` and `/dashboard/{org}/documents`, not
   `/_auth/log-in`. `{org}` is the 16+ char id in the dashboard URL.
2. Every control is named by its VISIBLE label plus the i18n key that resolves
   it, e.g. the **Send** button (`chat.send`). Labels live in
   `services/platform/messages/en.yml`; the app pins `en` in test contexts.
   Locate by role + name (`getByRole('button', { name: … })`), never by CSS or
   guessed text. This is the same rule the e2e suite follows (helpers/i18n.ts).
3. Every Expected result is CHECKABLE — a URL change, an element/text that
   becomes visible, a toast string, or a field value that survives a reload.
   "Looks right" is not an expectation. For persisted writes, assert by
   reloading and reading the field back (never the transient success toast).
4. IDs are stable per guide: F# functional, B# boundary/error, A# accessibility,
   P# performance. Reference them from the Issues Found table. When PATCHING a
   guide, never renumber: retire a dead case by striking its row
   (`~~Test name~~ (retired)`) and marking it ⛔ retired in the coverage table.
   Only a full REWRITE of a guide (the surface itself changed shape) may
   renumber; it carries forward still-open Issues Found rows re-keyed to the new
   IDs and drops resolved ones (git history keeps them).
5. The Automated coverage table maps each case to the Playwright spec that
   already automates it (`services/platform/tests/e2e/specs/<name>.spec.ts`) so a
   tester spends manual effort on the 🔶 partial / ⛔ manual-only rows. Cite
   only specs that exist in that directory at the time of writing.
-->

# <Area> — Manual Test Plan

> **Purpose**: One or two sentences — what this area is and what a tester
> exercises here. Note any feature-flag or provider precondition.

## Scope & routes

| Surface | Route                     |
| ------- | ------------------------- |
| <Page>  | `/dashboard/{org}/<path>` |

## Prerequisites

Bring the stack up and sign in per [SETUP.md](SETUP.md). <Any area-specific
setup: required governance flag, a provider configured, seed data to create
first, mock-LLM vs. live mode.>

> **Agent note**: <one line on how to drive this area — e.g. "chat turns reach a
> terminal state when Send re-enables; wait on that, not on text.">

## Automated coverage

| Case(s) | Status         | e2e spec                       |
| ------- | -------------- | ------------------------------ |
| F1–F3   | ✅ automated   | `navigation.spec.ts`           |
| F4      | 🔶 partial     | `settings.spec.ts` (rail only) |
| F5      | ⛔ manual-only | —                              |

Legend: ✅ fully automated · 🔶 partially automated · ⛔ manual-only (no spec).

## Functional tests

| ID  | Test | Steps (route + control) | Expected (verifiable) |
| --- | ---- | ----------------------- | --------------------- |
| F1  |      |                         |                       |

## Boundary & error tests

| ID  | Test | Input | Expected |
| --- | ---- | ----- | -------- |
| B1  |      |       |          |

## Accessibility (WCAG 2.1 AA)

| ID  | Check | Expected |
| --- | ----- | -------- |
| A1  |       |          |

## Performance

| ID  | Metric | Target |
| --- | ------ | ------ |
| P1  |        |        |

## Issues Found

| #   | Test ID | Route / URL | Severity (crit/high/med/low) | Description | Screenshot |
| --- | ------- | ----------- | ---------------------------- | ----------- | ---------- |
|     |         |             |                              |             |            |

## Test summary

```
Area: <Area>
Functional: ___/_   Boundary: ___/_   A11y: ___/_   Perf: ___/_
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
