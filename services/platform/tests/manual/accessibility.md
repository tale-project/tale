# Accessibility — Manual Test Plan (cross-cutting)

> **Purpose**: A WCAG 2.1 **Level AA** sweep across the whole app. Tale's
> standard (root [`AGENTS.md`](../../AGENTS.md) → Accessibility) is mandatory, not
> aspirational. Per-area guides have their own A11y rows; this guide is the
> holistic pass and the place to log systemic findings.

## Scope

Run each check on a representative set of surfaces: `/log-in`, chat
(`/dashboard/{org}/chat`), a DataTable page (`/dashboard/{org}/agents` or
`/documents`), a settings form (`/dashboard/{org}/settings/account`), a dialog
(any create/delete), and the mobile shell (see [responsive.md](responsive.md)).

## Prerequisites

Stack up + signed in per [SETUP.md](SETUP.md). Use the keyboard only (no mouse)
for the keyboard checks. A screen reader (VoiceOver on macOS) helps for the
announce checks. There is no axe dependency wired into the e2e suite, so this is
a manual / assisted pass; component-level coverage comes from `vitest-axe` and
the Storybook a11y addon.

## Automated coverage

| Layer                       | Status                                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Per-component               | ✅ `checkAccessibility()` in component tests; Storybook `addon-a11y` audits every story against WCAG 2.1 AA |
| Keyboard / responsive flows | 🔶 `keyboard.spec.ts`, `responsive.spec.ts`                                                                 |
| Full-page audits            | ⛔ manual-only (no axe in e2e)                                                                              |

## Checks

| ID  | Check            | Expected                                                                                                                                                          |
| --- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Landmarks        | Exactly one `<main>` and one `<h1>` per page; `<header>`, `<nav aria-label>`, `<aside>`, `<footer>` structure the rest                                            |
| A2  | Skip link        | The first focusable element is a skip-to-content link                                                                                                             |
| A3  | Keyboard reach   | Every interactive control is reachable and operable with Tab / Shift+Tab / Enter / Space; no mouse-only actions                                                   |
| A4  | Visible focus    | Focus ring always visible and meets 3:1 contrast                                                                                                                  |
| A5  | Focus management | Focus traps exist only inside open dialogs and return to the trigger on close                                                                                     |
| A6  | Images & icons   | Every image has `alt` (decorative = `alt=""`); every icon-only button has a translated `aria-label` (never hardcoded English)                                     |
| A7  | Forms            | Labels pair via `htmlFor`/wrapping; errors say what + how, wired with `aria-describedby` + `aria-invalid` + `role="alert"`                                        |
| A8  | Contrast         | Text ≥ 4.5:1; large text ≥ 3:1; non-text UI ≥ 3:1; colour is never the only signal                                                                                |
| A9  | Motion           | `prefers-reduced-motion: reduce` is respected on every animation (chat reveal, transitions)                                                                       |
| A10 | Tables           | `<caption>` (may be `sr-only`), `scope="col"` on every `<th>`, `aria-selected` on selected rows                                                                   |
| A11 | Live regions     | `aria-live="polite"` for non-urgent updates (streaming chat, toasts); `assertive` only for critical alerts; spinners are `role="status"`, loaders set `aria-busy` |
| A12 | Dialogs          | Every dialog has a title (visible or `VisuallyHidden`); focus trapped while open                                                                                  |
| A13 | Headings         | Heading levels never skip (no `h1` → `h3`)                                                                                                                        |
| A14 | Touch targets    | ≥ 24×24 CSS px (≥ 44×44 on mobile)                                                                                                                                |

## Per-surface sweep

| Surface        | A1  | A3  | A6  | A7  | A10 | A11 | A12 | Notes           |
| -------------- | --- | --- | --- | --- | --- | --- | --- | --------------- |
| `/log-in`      |     |     |     |     | —   |     |     |                 |
| Chat           |     |     |     | —   | —   |     |     | streaming = A11 |
| DataTable page |     |     |     | —   |     |     |     |                 |
| Settings form  |     |     |     |     | —   |     |     |                 |
| Dialog         |     |     |     |     | —   |     |     |                 |
| Mobile shell   |     |     |     | —   | —   |     |     |                 |

## Issues Found

| #   | Check ID | Route / URL | Severity | Description | Screenshot |
| --- | -------- | ----------- | -------- | ----------- | ---------- |
|     |          |             |          |             |            |

## Test summary

```
Area: Accessibility (WCAG 2.1 AA)
Checks passed: ___/14   Surfaces swept: ___/6
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
