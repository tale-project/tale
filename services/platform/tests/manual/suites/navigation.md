# Navigation & shell

> **Prefix** `NAV-` · **Reset** none · **Cost** 25 boxes

Exercise cross-app navigation — the primary side-nav rail, the breadcrumb
trail, browser back/forward, the chat command palette (Cmd/Ctrl+K), the org
switcher and team filter, the changelog viewer, the embedded Swagger page, and
the shared DataTable behaviours (search-filter, pagination, bulk select). No
provider needed — every route here renders offline in the deterministic stack.
Shell/PWA/connectivity behaviours (changelog release toast, install sheet,
service-worker update, offline gate) live HERE; [responsive.md](responsive.md)
keeps viewport-layout rows only.

## Scope & routes

| Surface              | Route                                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Primary nav sections | `/dashboard/{org}/{chat\|projects\|documents\|automations\|conversations\|settings}`                                                                                                 |
| Knowledge            | `/dashboard/{org}/documents` (the "Knowledge" rail item)                                                                                                                             |
| Settings landing     | `/dashboard/{org}/settings` → redirects by role (`getDefaultSettingsRoute`): `…/settings/organization` (owner/admin), `…/settings/connectors` (developer), else `…/settings/account` |
| Governance group     | `/dashboard/{org}/settings/governance` → redirects to `…/governance/content-models`                                                                                                  |
| Governance sub-page  | `/dashboard/{org}/settings/governance/policies-limits`                                                                                                                               |
| Org-switch staging   | `/dashboard/switching?to={otherOrg}` → redirects to `/dashboard/{otherOrg}`                                                                                                          |
| Changelog            | `/dashboard/changelog` (`?from=…&to=…`)                                                                                                                                              |
| Swagger              | `/docs`                                                                                                                                                                              |

## Preconditions

Bring the stack up and sign in per [SETUP.md](../setup.md). For NAV-F4
(command palette) have at least one chat thread with searchable content.
NAV-F5 (org switcher) needs the signed-in account to belong to **two or more**
orgs — a freshly-seeded single-org account cannot switch. NAV-F6 (team filter)
needs the org to have **at least one team** (Settings → Teams); the filter row
is hidden when the org has no teams.

> **Agent note**: smoke every route once (navigate + check it renders), then
> drive NAV-F4/NAV-F8/NAV-A1 by hand. The chat palette (Cmd/Ctrl+K) is wired
> only on the **chat** route's header — open `/dashboard/{org}/chat` first.
> The changelog fetches GitHub releases; offline it lands on the "up to date"
> state, not a crash.

## Functional tests

- [ ] `NAV-F1` · **Side nav** — In the rail (`<nav aria-label>` = **Main
  navigation**, `common.aria.mainNavigation`) click each item in order: **New
  chat** (`navigation.newChat`), **Projects** (`projects.title`),
  **Knowledge** (`navigation.knowledge`), **Automations**
  (`navigation.automations`), **Inbox** (`conversations.title`, gated on inbox
  availability), **Settings** (`navigation.userSettings`) → Each click commits
  the matching URL: `/chat`, `/projects`, `/documents` (Knowledge expands
  sub-items Documents/Websites/Products/Contacts), `/automations`,
  `/conversations`, and for **Settings** the role's default landing
  (`/settings/organization` for the seeded **owner** — see Scope & routes).
  The clicked rail item gets `aria-current`/active styling; the rail persists
  across navigations; the item order matches the list above.
- [ ] `NAV-F2` · **Breadcrumbs** — Open `/dashboard/{org}/projects`, click a
  project row to open it (`/dashboard/{org}/projects/{projectId}`) → The
  adaptive header shows a breadcrumb trail (e.g. **Projects** → project name);
  the leaf is a switcher button (`projects.switcher.ariaLabel`) opening a
  searchable menu of sibling projects — an automation's page carries the same
  switcher on its name (`automations.switcher.ariaLabel`); clicking the parent
  **Projects** crumb returns to `/dashboard/{org}/projects`
- [ ] `NAV-F3` · **Back/forward** — Visit chat → projects → agents, then
  browser Back twice, then Forward once → The URL and the visible section
  content track each history entry; no error boundary; no blank view.
- [ ] `NAV-F4` · **Command palette** — On `/dashboard/{org}/chat` press
  **Cmd/Ctrl+K**; type thread content into the **Search** field
  (`dialogs.search.placeholder`) → A `role="dialog"` palette opens on
  **Everything** (`dialogs.search.scopeEverything`) with the **Search** input;
  typing matches a thread; selecting it navigates to that thread; **Esc**
  closes the dialog. ⌘K toggles this palette; the thread-list search
  (`CHAT-F30`) opens the same dialog on **Chats**.
- [ ] `NAV-F5` · **Org switcher** — Open the **Organization** switcher
  (`navigation.orgSwitcher.label`) in the org button; pick a second org (needs
  ≥2 orgs) → URL passes through `/dashboard/switching?to={otherOrg}` (shows
  the switching spinner), then lands on `/dashboard/{otherOrg}/…`; data is
  scoped to the new org.
- [ ] `NAV-F6` · **Team filter** — In the user/avatar menu (bottom-left),
  expand the **Team** row (`navigation.teamFilter.label`) and pick a team
  (needs ≥1 team) → The selected team name shows as the row badge; lists scope
  to that team (verify a list count/contents changes)
- [ ] `NAV-F7` · **Governance disclosure** — **Settings** → in the settings
  rail (`<nav aria-label>` = **Settings**, `navigation.userSettings`) expand
  **Governance** (`navigation.governance`) → click **Policies & Limits**
  (`governance.groups.policiesAndLimits`) → The Governance group expands; URL
  commits `/dashboard/{org}/settings/governance/policies-limits` and the page
  renders.
- [ ] `NAV-F8` · **Changelog** — Open `/dashboard/changelog` → Heading
  **What's new** (`changelog.viewer.heading`) is visible. Offline/up-to-date
  stack: shows **You're up to date.** (`changelog.viewer.upToDate`) + **View
  older releases on GitHub ↗** link (`changelog.viewer.viewAllOnGitHub`).
  Online with newer releases: release entries render and the range filters
  (`?from=&to=`) narrow them.
- [ ] `NAV-F9` · **Render-only page** — Visit `/docs` (Swagger) → `/docs`
  mounts `main.swagger-ui-standalone`. No console/page error.
- [ ] `NAV-F10` · **DataTable behaviours** — On a list with a DataTable (e.g.
  Knowledge → Documents), use the search/filter; paginate
  (`common.aria.previousPage` / `common.aria.nextPage`); **Select all**
  (`common.aria.selectAll`) → **Delete selected**
  (`common.actions.deleteSelected`) → Filter narrows the rows; page controls
  change the visible page; the bulk action affects only the selected rows;
  **reload** to confirm the delete persisted.
- [ ] `NAV-F11` · **User-menu Documentation link** — Open the user/avatar menu
  (bottom-left); in the help group find **Documentation**
  (`auth.userButton.documentation`, BookOpen icon) → The **Documentation**
  item is an external link to `https://tale.dev/docs` opening in a new tab
  (`target="_blank"`, `rel="noopener noreferrer"`); the old **Help &
  feedback** item (formerly a HelpCircle item linking to the contact page) is
  **gone**.
- [ ] `NAV-F12` · **Changelog release toast** — Env-gated (the forcing
  mechanism is unverified — check live): sign in on a deployment whose version
  is **newer** than the account's last-toasted version (e.g. first session
  after a version bump) → A **one-shot** toast **Upgraded to v{version}**
  (`changelog.toast.title`, description `changelog.toast.description`) appears
  with a **View** action (`changelog.toast.action`); clicking **View**
  navigates to `/dashboard/changelog?from=…&to=…`. The toast **never re-fires
  for the same version** — reload and re-sign-in show no repeat (the client
  records the toasted version)
- [ ] `NAV-F13` · **Get app / iOS install sheet** — Env-gated (emulate an iOS
  Safari UA, or a browser that offers PWA install): open the user/avatar menu
  (bottom-left) → The menu shows **Get app** (`auth.userButton.getApp`) only
  when the app is installable or the UA is iOS. On iOS, choosing it opens the
  sheet **Install Tale** (`auth.userButton.iosInstall.title`) with the steps
  **"Tap the Share button in your browser's toolbar."**
  (`auth.userButton.iosInstall.step1`) and **'Choose "Add to Home Screen",
  then tap "Add".'** (`auth.userButton.iosInstall.step2`), closed by **OK**
  (`auth.userButton.iosInstall.done`)
- [ ] `NAV-F14` · **Service-worker update toast** — Env-gated (production
  build with a **waiting** service worker — a dev stack registers no SW): load
  the app while a newer SW is waiting → Toast **Update available**
  (`pwa.updateAvailableTitle`) with **A new version of Tale is ready.**
  (`pwa.updateAvailableDescription`) and an **Update now** action
  (`pwa.updateNow`); clicking it reloads the page onto the new version.
  Separately, the benign one-off toast **"Tale is ready to work offline."**
  (`pwa.offlineReady`) fires on first SW install — expected, do **not** file
  it (it can photobomb unrelated screenshots)

## Boundary & error tests

- [ ] `NAV-B1` · **Bad deep link** — Open
  `/dashboard/{org}/automations/does-not-exist` → Inside the shell, renders
  the graceful **Automation not found** EmptyState
  (`automations.notFound.title` + `automations.notFound.description`) — no
  crash, no error boundary.
- [ ] `NAV-B2` · **Unknown route** — Open `/dashboard/{org}/nope-not-a-route`
  → A styled 404 renders inside the dashboard layout (rail still present):
  heading **Page not found** (`common.notFound.title`), the message **The page
  you're looking for doesn't exist or may have been moved.**
  (`common.notFound.description`), and a **Back to dashboard** link
  (`common.notFound.backToDashboard`) to `/dashboard/{org}`. Document title is
  **Page not found** (`metadata.notFound.title`), not the marketing default.
  No white-screen crash.
- [ ] `NAV-B3` · **Back after delete** — Delete a list row, press browser Back
  → No stale/ghost row reappears; the list stays consistent with the persisted
  state.
- [ ] `NAV-B4` · **Bad version range** — Open
  `/dashboard/changelog?from=zzz&to=000` → Handled gracefully — heading
  **What's new** still renders; no blank screen, no console/page error.
- [ ] `NAV-B5` · **Offline gate** — Mode A via network emulation: on any
  dashboard page, set the browser **offline**; later, restore the network.
  Backend-stale variant: keep the device online but **stop the local backend**
  → After the websocket goes stale past a **~3 s grace** (both variants — a
  brief blip does not trigger it), a full-screen overlay
  (`role="alertdialog"`) shows **You're offline** (`connectivity.deviceTitle`)
  + its description (`connectivity.deviceDescription`). Restoring the network
  clears the overlay **without a reload** — the page underneath stays mounted
  (children keep rendering below the overlay). With the backend stopped
  instead, the overlay reads **Can't reach Tale**
  (`connectivity.backendTitle`) with a **Try again** button
  (`connectivity.retry`)

## Accessibility (WCAG 2.1 AA)

- [ ] `NAV-A1` · **Landmarks** → Exactly one `role="main"` and one `<nav
  aria-label="Main navigation">` (`common.aria.mainNavigation`) per dashboard
  page.
- [ ] `NAV-A2` · **Skip link** → A focusable **Skip to main content** link
  (`common.aria.skipToContent`) is present as an early focus target.
- [ ] `NAV-A3` · **Palette** → The Cmd/Ctrl+K palette is a `role="dialog"`;
  **Esc** closes it and focus returns to the page.
- [ ] `NAV-A4` · **Breadcrumb** → The breadcrumb is an ordered, labelled
  navigation; the current page is marked (`aria-current`)

## Performance

- [ ] `NAV-P1` · **Warm in-app nav** → A rail-click route commit
  (`waitForURL`) settles in **< 1 s** on the warm deterministic stack; hovered
  targets prefetch so they feel near-instant.
- [ ] `NAV-P2` · **Palette open** → Cmd/Ctrl+K → the **Search chat** input is
  visible in **< 0.5 s** on the warm deterministic stack.
