# Navigation & shell

> **Prefix** `NAV-` · **Reset** none · **Cost** 37 boxes

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
orgs — a freshly-seeded single-org account cannot switch. NAV-F6 (teams row)
needs the signed-in account to be a member of **at least one team** (Settings
→ Teams → add yourself); the row is always present once the teams have
loaded, and reads **No teams** for an account in none.

> **Agent note**: smoke every route once (navigate + check it renders), then
> drive NAV-F4/NAV-F8/NAV-A1 by hand. The chat palette (Cmd/Ctrl+K) is wired
> only on the **chat** route's header — open `/dashboard/{org}/chat` first.
> The changelog fetches GitHub releases; offline it lands on the "up to date"
> state, not a crash.

## Functional tests

- [ ] `NAV-F1` · **Side nav** — In the rail (`<nav aria-label>` = **Main
  navigation**, `common.aria.mainNavigation`) click each item in order:
  **Chat** (`navigation.chat`), **Projects** (`projects.title`), **Knowledge**
  (`navigation.knowledge`), **Automations** (`navigation.automations`),
  **Inbox** (`conversations.title`, gated on inbox availability), **Settings**
  (`navigation.userSettings`) → Each click commits that section's DEFAULT
  entry: `/chat`, `/projects`, `/documents` (Knowledge exposes Documents/Knowledge entries/Websites/Products/Contacts),
  `/automations`, `/conversations` (which forwards to `/conversations/open`),
  and for **Settings** the role's default landing (`/settings/organization`
  for the seeded **owner** — see Scope & routes). The clicked rail item gets
  `aria-current`/active styling; the rail persists across navigations; the
  item order matches the list above.
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
- [ ] `NAV-F6` · **Teams row** — In the user/avatar menu (bottom-left), read
  the **Teams** row (`navigation.myTeams.label`), then click it → The row is a
  plain item, not a picker: its badge COUNTS the caller's teams
  (`navigation.myTeams.count`; `navigation.myTeams.none` for an account in no
  team), and the **Teams** label reads in full — never clipped to an ellipsis,
  at any team count or locale; clicking it closes the menu and lands on
  `/dashboard/{org}/settings/account#teams` with the **Your teams** section
  (`settings.account.teams.title`) in view, which is where the names live; no
  list anywhere changes — a team is an audience label on work, never a context
  to switch into.
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
- [ ] `NAV-F9` · **API reference and developer links** — Visit `/docs` → The
  Swagger reference renders the running instance’s contract. Above it,
  **Developer guides** (`settings.apiDocs.guides`) opens the public API guide
  in a new tab; **OpenAPI document (JSON)** (`settings.apiDocs.openapiDocument`)
  opens the same instance’s raw contract in the current tab. Tab through both
  links and repeat at phone width → Both labels remain readable and keyboard
  reachable; no page error.
- [ ] `NAV-F10` · **DataTable behaviours** — On a list with a DataTable (e.g.
  Knowledge → Documents), use the search/filter; paginate
  (`common.aria.previousPage` / `common.aria.nextPage`); **Select all**
  (`common.aria.selectAll`) → **Delete selected**
  (`common.actions.deleteSelected`) → Filter narrows the rows; page controls
  change the visible page; the bulk action affects only the selected rows;
  **reload** to confirm the delete persisted.
- [ ] `NAV-F11` · **User-menu Documentation link** — Open the user/avatar menu
  and find **Documentation** (`auth.userButton.documentation`) → It links to
  the public documentation at `https://docs.tale.dev` in a new tab with
  `target="_blank"` and `rel="noopener noreferrer"`. The API reference is a
  separate surface, reached from the API settings.
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
- [ ] `NAV-F15` · **Archived work in the palette** — Needs a project with one
  archived task and one live task, plus a second project that is itself
  archived and still holds a live task. Press **Cmd/Ctrl+K** on **Everything**
  (`dialogs.search.scopeEverything`) and search a term all four share → Every
  row appears. The archived task carries the **Archived** badge
  (`dialogs.search.badgeArchived`); the live task in the archived project
  carries **Archived project** (`dialogs.search.badgeProjectArchived`); the
  live task in the live project carries neither. Live rows list above archived
  ones. The badge reads as a quiet chip beside the title, not a second
  heading, and stays legible in dark mode and at 400px width.

- [ ] `NAV-F16` · **A rail click is not a history replay** — Open
  **Projects**, open a project, land on **Tasks → Board**, open a task so the
  URL carries `?task=…`. Click **Chat** in the rail, then click **Projects**
  again → You land on `/projects`, the list, with no `?task=…`. Repeat for
  **Knowledge** (switch to **Websites** first → `/documents`), **Automations**
  (open one automation's **Runs** tab → `/automations`), and **Inbox**
  (switch to **Closed** → `/conversations/open`): each opens the section's own
  first page, never the tab or record you left. Only **Chat** resumes, because
  its own entry point reopens the last thread (`NAV-F18`).
- [ ] `NAV-F17` · **Re-entry resets the section** — While sitting on a
  project's board (deep inside Projects), click the **Projects** rail item you
  are already on → You land on `/projects`, the list. Same gesture in **Inbox**
  lands on `/conversations/open`; in **Settings** on the role's default
  landing; in **Knowledge** on `/documents`.
- [ ] `NAV-F18` · **Chat** — From **Projects**, click **Chat** → It opens the
  thread you last READ (not merely the one with the newest activity: have a
  second account post into an older thread first, then confirm the rail still
  reopens yours). Now click the **Chat** rail item while already in chat → A
  fresh composer opens (`?new=1`), not a thread.
- [ ] `NAV-F20` · **A pasted key stays in page memory** — Open `/docs`, click
  **Authorize**, paste an API key, run one request, then reload the page →
  The request went out authorized; after the reload the lock is open again
  and DevTools → Application → Local storage for the origin holds no
  `authorized` entry.
- [ ] `NAV-F21` · **Every overview list is one fixed frame** — At a viewport
  short enough that the rows overflow (1280×720 is enough with ~25 rows), visit
  `/dashboard/{org}/automations`, `/dashboard/{org}/projects` and
  `/dashboard/{org}/knowledge-entries` in turn and scroll each with the wheel →
  On all three the rows move INSIDE the bordered table while the search field,
  the create button, the column header row and the "Showing all N …" footer
  stay put; the page itself never scrolls. In the console,
  `[...document.querySelectorAll('*')].filter(el => el.scrollHeight >
  el.clientHeight + 4 && ['auto','scroll'].includes(getComputedStyle(el).overflowY))`
  returns exactly ONE element per page, and it is
  `[data-testid="data-table-scrollport"]` — never the page shell
  (`[scrollbar-gutter:stable]`). Filter a list down to two rows: the frame
  hugs those rows instead of stretching. Repeat at 390×740: the frame ends
  above the bottom tab bar, same three pages, same behaviour.

- [ ] `NAV-F22` · **Every overview list ends on the same footer** — With ~25
  rows seeded in each, visit `/dashboard/{org}/documents`,
  `/dashboard/{org}/knowledge-entries`, `/dashboard/{org}/websites`,
  `/dashboard/{org}/products` and `/dashboard/{org}/contacts` in turn → Each
  ends on ONE sticky line inside the bordered frame reading "Showing all N
  <entity>" (`common.pagination.showingAll`, the noun from the list's own
  `entityLabel` — "products", "contacts"); none of them renders a page
  selector or Previous/Next buttons (`common.aria.previousPage` /
  `common.aria.nextPage`) below the frame. On Contacts, click the **Name**
  column header → the list re-orders across ALL contacts (row 1 is the
  alphabetically first contact in the org, not the first of the loaded page)
  and the footer still reads "Showing all N contacts".

## Boundary & error tests

- [ ] `NAV-B1` · **Bad deep link** — Open
  `/dashboard/{org}/automations/does-not-exist` → Inside the shell, renders
  the graceful **Automation not found** EmptyState
  (`automations.notFound.title` + `automations.notFound.description`) — no
  crash, no error boundary.
- [ ] `NAV-B2` · **Unknown route** — Open `/dashboard/{org}/` with a made-up
  trailing segment (nope-not-a-route — deliberately no such route)
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

- [ ] `NAV-B7` · **A project that is gone** — Open a project, then in a
  second session **delete it**. Back in the first session, reload that
  project's URL → The page explains it cannot find the project and offers a
  **Projects** link out, rather than a bare dead end.
- [ ] `NAV-B8` · **Knowledge entries lights the rail** — Navigate to
  `/dashboard/{org}/knowledge-entries` → The **Knowledge** rail item shows
  active styling (it previously did not), and clicking it returns you to
  `/documents`, the section's first tab.
- [ ] `NAV-B10` · **Unknown route outside the dashboard** — Signed in, open a
  made-up top-level path (such as login without the hyphen — deliberately no
  such route); then repeat in a private window, signed out → Both show the
  standalone 404: the logo home link in the top corner over a centred **Page
  not found** (`common.notFound.title`), its message
  (`common.notFound.description`) and a **Back to dashboard** button
  (`common.notFound.backToDashboard`), never the bare framework "Not Found"
  text. The tab reads **Page not found** (`metadata.notFound.title`). The
  button opens the organization's dashboard when signed in, and **Log in**
  (continuing to the dashboard) when signed out. Signed out, a path beneath a
  sign-in page (such as log-in/typo) shows the same state inside the sign-in
  frame: one logo, no second page nested in it. Both themes render.

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
