# Accessibility Testing Guide (AI-Directed)

> **Purpose**: A cross-cutting WCAG 2.1 Level AA sweep of the whole app — keyboard, focus, structure, labels, contrast, screen-reader, alt text, and live regions — and collect defects in Issues Found. The per-module guides each carry an "Accessibility tests" block; this guide is the shared checklist and the place to run an automated axe pass on every major page.

## Prerequisites

Bring the stack up per [FULL_SITE_TESTING.md](FULL_SITE_TESTING.md) and sign in as `admin@admin.test` / `Admin@123`. Have the browser tooling's accessibility snapshot and console available; the component suite also ships `vitest-axe`, so unit-level a11y is covered — this guide is the live-page pass.

> **AI Instructions**: For each page in the matrix, run the checks below, capture the accessibility snapshot, and log any violation in Issues Found with the page, the check ID, and the element. Treat axe "serious"/"critical" as failures; "moderate" as warnings to record.

## Screenshot Setup

```bash
mkdir -p tests/screenshots/$(date +%Y-%m-%d_%H_%M)/a11y
```

## Page matrix

Run the full checklist against each of these, then spot-check dialogs (add-member, create-team, document team, schedule):

```
/                                  (login)
/dashboard/{id}/chat
/dashboard/{id}/conversations/open
/dashboard/{id}/approvals
/dashboard/{id}/automations
/dashboard/{id}/documents
/dashboard/{id}/products
/dashboard/{id}/settings
/dashboard/{id}/settings/people
/dashboard/{id}/settings/governance
```

## Checklist (WCAG 2.1 AA)

| ID  | Check                  | How to verify                                            | Expected                                                                  |
| --- | ---------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------- |
| A1  | Keyboard navigation    | Tab through the page without a mouse                     | Every interactive control is reachable and operable; no keyboard trap     |
| A2  | Focus visibility       | Tab and watch the focus ring                             | A visible focus indicator on every focused control                        |
| A3  | Focus order            | Tab order vs visual order                                | Order is logical (left→right, top→bottom); dialogs trap + restore focus   |
| A4  | Heading hierarchy      | Inspect the heading outline                              | One H1 per page; no skipped levels (H1→H3 without H2)                     |
| A5  | Form labels            | Inspect inputs                                           | Every field has a programmatic label; placeholders are not the only label |
| A6  | Error identification   | Submit an invalid form                                   | Errors are text (not colour-only) and associated with their field         |
| A7  | Colour contrast        | Sample body text, buttons, badges, muted text            | ≥ 4.5:1 for normal text, ≥ 3:1 for large text and UI boundaries           |
| A8  | Non-text contrast      | Icons-as-controls, input borders, focus ring             | ≥ 3:1 against adjacent colours                                            |
| A9  | Images / icons         | Inspect meaningful images and icon-only buttons          | Meaningful images have alt text; icon buttons have an accessible name     |
| A10 | Live regions           | Trigger a toast, a streaming chat reply, a status change | Announced via `aria-live` / appropriate role                              |
| A11 | Landmarks              | Inspect the page regions                                 | `nav`, `main`, and notification regions are present and named             |
| A12 | Motion / reduce-motion | Enable OS "reduce motion"                                | Animations (spinners, typewriter, pulse) respect `prefers-reduced-motion` |
| A13 | Zoom / reflow          | Zoom to 200%                                             | Content reflows without horizontal scroll or clipped controls             |
| A14 | Target size            | Inspect small controls (row 3-dot menus, mic, close)     | Hit targets are comfortably tappable (coarse-pointer friendly)            |

## Automated pass

For each page in the matrix:

1. Navigate, wait for load (spinners gone).
2. Capture the accessibility snapshot.
3. Run an axe-style audit if available; record serious/critical violations.
4. Screenshot, then move on.

## Issues Found

| #   | Check ID | Page / URL | Element | Severity (crit/serious/moderate) | Description | Screenshot |
| --- | -------- | ---------- | ------- | -------------------------------- | ----------- | ---------- |
|     |          |            |         |                                  |             |            |

## Test summary

```
Module: Accessibility (WCAG 2.1 AA)
Pages audited: ___/10   Dialogs spot-checked: ___
Checks run per page: 14
Violations: crit ___ / serious ___ / moderate ___
Status: PASS / FAIL
```
