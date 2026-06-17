# Navigation & shell — Manual Test Plan

> **Purpose**: Exercise cross-app navigation — the side nav, breadcrumbs,
> browser back/forward, the command palette, org switcher and team filter, the
> changelog, render-only pages (metrics, embedded Swagger, redirects), and the
> shared DataTable behaviours (search-filter, pagination, bulk select).

## Scope & routes

| Surface     | Route                                                                                        |
| ----------- | -------------------------------------------------------------------------------------------- |
| Any section | `/dashboard/{org}/{chat\|projects\|conversations\|documents\|agents\|automations\|settings}` |
| Changelog   | `/dashboard/changelog` (`?from=…&to=…`)                                                      |
| Metrics     | `/dashboard/{org}/agents/metrics` · `…/automations/metrics`                                  |
| Swagger     | `/docs`                                                                                      |
| Redirect    | `/dashboard/{org}/custom-agents` → `…/agents`                                                |

## Prerequisites

Stack up + signed in per [SETUP.md](SETUP.md). For the command-palette test,
have at least one chat thread with searchable content.

## Automated coverage

| Case(s)        | Status            | e2e spec                             |
| -------------- | ----------------- | ------------------------------------ |
| F1, F2, F3, F7 | ✅ automated      | `navigation.spec.ts`                 |
| F9             | ✅ automated      | `page-loads.spec.ts`                 |
| F4             | ✅ automated      | `search.spec.ts`, `keyboard.spec.ts` |
| F10            | ✅ automated      | `list-behaviors.spec.ts`             |
| F5, F6, F8     | 🔶/⛔ manual-only | —                                    |

## Functional tests

| ID  | Test                  | Steps (route + control)                                                                                                                                                    | Expected                                                         |
| --- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| F1  | Side nav              | Use the main nav (`common.aria.mainNavigation`) to visit chat / projects / conversations / knowledge / agents / automations / settings                                     | Each section loads; active item marked                           |
| F2  | Breadcrumbs           | Navigate into a nested page (e.g. an agent editor)                                                                                                                         | Breadcrumbs reflect the path and are clickable                   |
| F3  | Back/forward          | Use browser back/forward across several pages                                                                                                                              | State restores; no broken view                                   |
| F4  | Command palette       | Cmd/Ctrl+K → type thread content (`dialogs.searchChat.placeholder`)                                                                                                        | Palette finds and opens the matching thread                      |
| F5  | Org switcher          | Open the org switcher (`navigation.orgSwitcher.label`), pick another org                                                                                                   | Switches via `/dashboard/switching`; data scoped to the new org  |
| F6  | Team filter           | Apply a team filter (`navigation.teamFilter.label`)                                                                                                                        | Lists scope to the team                                          |
| F7  | Governance disclosure | Settings → **Governance** (`navigation.governance`) → a sub-page (`governance.groups.policiesAndLimits`)                                                                   | Disclosure expands; sub-page loads                               |
| F8  | Changelog             | `/dashboard/changelog` (`changelog.viewer.heading`); apply `?from=&to=`; observe the new-version badge                                                                     | Releases render; version range filters; badge clears once viewed |
| F9  | Render-only pages     | Visit metrics (`workforce.title`, `automations.metrics.title`), `/docs` (Swagger), and a redirect (`/custom-agents` → `/agents`)                                           | All render / redirect without error                              |
| F10 | DataTable behaviours  | On a list, search-filter; paginate (`common.aria.previousPage` / `nextPage`); select-all (`common.aria.selectAll`) → **Delete selected** (`common.actions.deleteSelected`) | Filter narrows; pages change; bulk action affects the selection  |

## Boundary & error tests

| ID  | Test              | Input                                         | Expected                             |
| --- | ----------------- | --------------------------------------------- | ------------------------------------ |
| B1  | Bad deep link     | Open `/dashboard/{org}/agents/does-not-exist` | Graceful 404 / redirect, not a crash |
| B2  | Back after delete | Delete a row, press back                      | No stale/ghost row; list consistent  |
| B3  | Bad version range | Changelog `?from=zzz&to=000`                  | Handled gracefully (no blank screen) |

## Accessibility (WCAG 2.1 AA)

| ID  | Check      | Expected                                                  |
| --- | ---------- | --------------------------------------------------------- |
| A1  | Landmarks  | One `<main>`, one `<h1>`; nav is `<nav aria-label>`       |
| A2  | Skip link  | First focusable element skips to main content             |
| A3  | Palette    | Command palette traps focus; Esc closes and returns focus |
| A4  | Breadcrumb | Ordered, labelled navigation; current page marked         |

## Performance

| ID  | Metric     | Target                                                                |
| --- | ---------- | --------------------------------------------------------------------- |
| P1  | In-app nav | Warm route commit < 1 s (prefetch makes hovered targets near-instant) |
| P2  | Palette    | Opens < 0.5 s                                                         |

## Issues Found

| #   | Test ID | Route / URL | Severity | Description | Screenshot |
| --- | ------- | ----------- | -------- | ----------- | ---------- |
|     |         |             |          |             |            |

## Test summary

```
Area: Navigation & shell
Functional: ___/10   Boundary: ___/3   A11y: ___/4   Perf: ___/2
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
