# Navigation & shell — Manual Test Plan

> **Purpose**: Exercise cross-app navigation — the primary side-nav rail, the
> breadcrumb trail, browser back/forward, the chat command palette
> (Cmd/Ctrl+K), the org switcher and team filter, the changelog viewer, the
> render-only pages (workforce/automation metrics, embedded Swagger, the
> `custom-agents` redirect), and the shared DataTable behaviours
> (search-filter, pagination, bulk select). No provider needed — every route
> here renders offline in the deterministic stack.

## Scope & routes

| Surface              | Route                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| Primary nav sections | `/dashboard/{org}/{chat\|apps\|projects\|conversations\|documents\|agents\|automations\|settings}` |
| Conversations        | `/dashboard/{org}/conversations` → redirects to `…/conversations/open`                             |
| Knowledge            | `/dashboard/{org}/documents` (the "Knowledge" rail item)                                           |
| Settings landing     | `/dashboard/{org}/settings` → redirects to `…/settings/account`                                    |
| Governance group     | `/dashboard/{org}/settings/governance` → redirects to `…/governance/content-models`                |
| Governance sub-page  | `/dashboard/{org}/settings/governance/policies-limits`                                             |
| Org-switch staging   | `/dashboard/switching?to={otherOrg}` → redirects to `/dashboard/{otherOrg}`                        |
| Changelog            | `/dashboard/changelog` (`?from=…&to=…`)                                                            |
| Workforce metrics    | `/dashboard/{org}/agents/metrics`                                                                  |
| Automation metrics   | `/dashboard/{org}/automations/metrics`                                                             |
| Swagger              | `/docs`                                                                                            |
| Redirect             | `/dashboard/{org}/custom-agents` → `…/agents/all`                                                  |

## Prerequisites

Bring the stack up and sign in per [SETUP.md](SETUP.md). For F4 (command
palette) have at least one chat thread with searchable content. F5 (org
switcher) needs the signed-in account to belong to **two or more** orgs — a
freshly-seeded single-org account cannot switch. F6 (team filter) needs the org
to have **at least one team** (Settings → Teams); the filter row is hidden when
the org has no teams.

> **Agent note**: smoke every route once (navigate + check it renders), then drive F4/F8/A1
> by hand. The chat palette (Cmd/Ctrl+K) is wired only on the **chat** route's
> header — open `/dashboard/{org}/chat` first. The changelog fetches GitHub
> releases; offline it lands on the "up to date" state, not a crash.

## Automated coverage

| Case(s)        | Status         | e2e spec                                   |
| -------------- | -------------- | ------------------------------------------ |
| F1, F2, F3, F7 | ✅ automated   | `navigation.spec.ts`                       |
| F4             | ✅ automated   | `search.spec.ts`                           |
| F9             | ✅ automated   | `page-loads.spec.ts` (render-only anchors) |
| F5, F6, F8     | ⛔ manual-only | —                                          |
| F10            | ⛔ manual-only | — (no DataTable bulk-action spec exists)   |
| B1             | ✅ automated   | `navigation.spec.ts` (not-found shell)     |

Legend: ✅ fully automated · 🔶 partially automated · ⛔ manual-only (no spec).
(`keyboard.spec.ts` only covers wizard focus order — NOT the Cmd+K palette.
`list-behaviors.spec.ts` does not exist.)

## Functional tests

| ID  | Test                  | Steps (route + control)                                                                                                                                                                                                                                                                                                                                                                                                  | Expected (verifiable)                                                                                                                                                                                                                                                                                                                     |
| --- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Side nav              | In the rail (`<nav aria-label>` = **Main navigation**, `common.aria.mainNavigation`) click each item: **New chat** (`navigation.newChat`), **Apps** (`navigation.apps`), **Projects** (`projects.title`), **Conversations** (`navigation.conversations`), **Knowledge** (`navigation.knowledge`), **Agents** (`navigation.agents`), **Automations** (`navigation.automations`), **Settings** (`navigation.userSettings`) | Each click commits the matching URL: `/chat`, `/apps`, `/projects`, `/conversations/open`, `/documents`, `/agents/all`, `/automations`, `/settings/account`. The clicked rail item gets `aria-current`/active styling; the rail persists across navigations                                                                               |
| F2  | Breadcrumbs           | Open `/dashboard/{org}/agents/all`, click an agent row to open its editor (`/dashboard/{org}/agents/{agentId}`)                                                                                                                                                                                                                                                                                                          | The adaptive header shows a breadcrumb trail (e.g. **Agents** → agent name); clicking the parent **Agents** crumb returns to `/dashboard/{org}/agents/all`                                                                                                                                                                                |
| F3  | Back/forward          | Visit chat → projects → agents, then browser Back twice, then Forward once                                                                                                                                                                                                                                                                                                                                               | The URL and the visible section content track each history entry; no error boundary; no blank view                                                                                                                                                                                                                                        |
| F4  | Command palette       | On `/dashboard/{org}/chat` press **Cmd/Ctrl+K**; type thread content into the **Search chat** field (`dialogs.searchChat.placeholder`)                                                                                                                                                                                                                                                                                   | A `role="dialog"` palette opens with the **Search chat** input; typing matches a thread; selecting it navigates to that thread; **Esc** closes the dialog                                                                                                                                                                                 |
| F5  | Org switcher          | Open the **Organization** switcher (`navigation.orgSwitcher.label`) in the org button; pick a second org (needs ≥2 orgs)                                                                                                                                                                                                                                                                                                 | URL passes through `/dashboard/switching?to={otherOrg}` (shows the switching spinner), then lands on `/dashboard/{otherOrg}/…`; data is scoped to the new org                                                                                                                                                                             |
| F6  | Team filter           | In the user/avatar menu (bottom-left), expand the **Team** row (`navigation.teamFilter.label`) and pick a team (needs ≥1 team)                                                                                                                                                                                                                                                                                           | The selected team name shows as the row badge; lists scope to that team (verify a list count/contents changes)                                                                                                                                                                                                                            |
| F7  | Governance disclosure | **Settings** → in the settings rail (`<nav aria-label>` = **Settings**, `navigation.userSettings`) expand **Governance** (`navigation.governance`) → click **Policies & Limits** (`governance.groups.policiesAndLimits`)                                                                                                                                                                                                 | The Governance group expands; URL commits `/dashboard/{org}/settings/governance/policies-limits` and the page renders                                                                                                                                                                                                                     |
| F8  | Changelog             | Open `/dashboard/changelog`                                                                                                                                                                                                                                                                                                                                                                                              | Heading **What's new** (`changelog.viewer.heading`) is visible. Offline/up-to-date stack: shows **You're up to date.** (`changelog.viewer.upToDate`) + **View older releases on GitHub ↗** link (`changelog.viewer.viewAllOnGitHub`). Online with newer releases: release entries render and the range filters (`?from=&to=`) narrow them |
| F9  | Render-only pages     | Visit `/dashboard/{org}/agents/metrics` (heading **Metrics**, `settings.agents.tabs.metrics`), `/dashboard/{org}/automations/metrics` (heading **Automation Metrics**, `automations.metrics.title`), `/docs` (Swagger), and `/dashboard/{org}/custom-agents`                                                                                                                                                             | Metrics pages render their heading + period switcher; `/docs` mounts `main.swagger-ui-standalone`; `/custom-agents` redirects to `/dashboard/{org}/agents/all`. None throw a console/page error                                                                                                                                           |
| F10 | DataTable behaviours  | On a list with a DataTable (e.g. Knowledge → Documents), use the search/filter; paginate (`common.aria.previousPage` / `common.aria.nextPage`); **Select all** (`common.aria.selectAll`) → **Delete selected** (`common.actions.deleteSelected`)                                                                                                                                                                         | Filter narrows the rows; page controls change the visible page; the bulk action affects only the selected rows; **reload** to confirm the delete persisted                                                                                                                                                                                |

## Boundary & error tests

| ID  | Test              | Input                                         | Expected                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ----------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Bad deep link     | Open `/dashboard/{org}/agents/does-not-exist` | Inside the shell, renders the graceful message **Agent not found or you don't have access.** (`settings.agents.agentNotFound`) — no crash, no error boundary                                                                                                                                                                                                                                                                                                   |
| B2  | Unknown route     | Open `/dashboard/{org}/nope-not-a-route`      | A styled 404 renders inside the dashboard layout (rail still present): heading **Page not found** (`common.notFound.title`), the message **The page you're looking for doesn't exist or may have been moved.** (`common.notFound.description`), and a **Back to dashboard** link (`common.notFound.backToDashboard`) to `/dashboard/{org}`. Document title is **Page not found** (`metadata.notFound.title`), not the marketing default. No white-screen crash |
| B3  | Back after delete | Delete a list row, press browser Back         | No stale/ghost row reappears; the list stays consistent with the persisted state                                                                                                                                                                                                                                                                                                                                                                               |
| B4  | Bad version range | Open `/dashboard/changelog?from=zzz&to=000`   | Handled gracefully — heading **What's new** still renders; no blank screen, no console/page error                                                                                                                                                                                                                                                                                                                                                              |

## Accessibility (WCAG 2.1 AA)

| ID  | Check      | Expected                                                                                                                 |
| --- | ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| A1  | Landmarks  | Exactly one `role="main"` and one `<nav aria-label="Main navigation">` (`common.aria.mainNavigation`) per dashboard page |
| A2  | Skip link  | A focusable **Skip to main content** link (`common.aria.skipToContent`) is present as an early focus target              |
| A3  | Palette    | The Cmd/Ctrl+K palette is a `role="dialog"`; **Esc** closes it and focus returns to the page                             |
| A4  | Breadcrumb | The breadcrumb is an ordered, labelled navigation; the current page is marked (`aria-current`)                           |

## Performance

| ID  | Metric          | Target                                                                                                                                            |
| --- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Warm in-app nav | A rail-click route commit (`waitForURL`) settles in **< 1 s** on the warm deterministic stack; hovered targets prefetch so they feel near-instant |
| P2  | Palette open    | Cmd/Ctrl+K → the **Search chat** input is visible in **< 0.5 s** on the warm deterministic stack                                                  |

## Issues Found

| #   | Test ID | Route / URL | Severity (crit/high/med/low) | Description | Screenshot |
| --- | ------- | ----------- | ---------------------------- | ----------- | ---------- |
|     |         |             |                              |             |            |

## Test summary

```
Area: Navigation & shell
Functional: ___/10   Boundary: ___/4   A11y: ___/4   Perf: ___/2
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
