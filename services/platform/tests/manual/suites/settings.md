# Settings

> **Prefix** `SET-` · **Reset** none · **Cost** 168 boxes

Exercise the settings surface along its real rail — **Personal** (Account,
Preferences, Notifications, Usage), **Organization** (Organization, Teams, Members,
AI providers, Connectors, Skills, Branding, Sandboxes, Governance, Metrics)
and **Advanced** (API: REST / Models / MCP / Connected agents / WebDAV, Enterprise SSO, Data residency).
Governance has its own guide ([governance.md](governance.md)); data-residency
depth lives in [data-residency.md](data-residency.md) (one route case here);
connector depth (per-type credentials, OAuth, imap-smtp) lives in
[connectors.md](connectors.md); 2FA/passkeys/sessions live in
[auth.md](auth.md). The token-sources page and the per-provider detail page
were retired — both providers and connectors are now one credential table
each, and metrics gets one smoke case (a dedicated metrics guide lands later).

## Scope & routes

The settings rail (`navigation.userSettings`) groups pages as **Personal** /
**Organization** / **Advanced** (`settings.menu.railSections.personal` /
`…railSections.organization` / `…railSections.advanced`). The rail label for
the `/settings/personalization` route is **Preferences**
(`navigation.personalization`). Governance, Metrics, and API are expandable
disclosure rows whose children render indented.

| Surface                    | Route                                                                      |
| -------------------------- | -------------------------------------------------------------------------- |
| Settings index (workspace) | `/dashboard/{org}/settings`                                                |
| Personal overview (mobile) | `/dashboard/{org}/settings/personal`                                       |
| Account                    | `/dashboard/{org}/settings/account`                                        |
| Preferences                | `/dashboard/{org}/settings/personalization`                                |
| Notifications              | `/dashboard/{org}/settings/notifications`                                  |
| Usage                      | `/dashboard/{org}/settings/usage`                                          |
| Organization               | `/dashboard/{org}/settings/organization`                                   |
| Teams                      | `/dashboard/{org}/settings/teams`                                          |
| Members                    | `/dashboard/{org}/settings/members`                                        |
| AI providers               | `/dashboard/{org}/settings/providers` · `…?provider=<slug>` opens filtered |
| Connectors                 | `/dashboard/{org}/settings/connectors`                                     |
| Skills                     | `/dashboard/{org}/settings/skills`                                         |
| Branding                   | `/dashboard/{org}/settings/branding`                                       |
| Sandboxes                  | `/dashboard/{org}/settings/sandboxes`                                      |
| Metrics (smoke only)       | `/dashboard/{org}/settings/metrics/usage` (index redirects here)           |
| API → REST (API keys)      | `/dashboard/{org}/settings/api/rest` (`…/settings/api` redirects here)     |
| API → Models               | `/dashboard/{org}/settings/api/models`                                     |
| API → MCP                  | `/dashboard/{org}/settings/api/mcp`                                        |
| API → Connected agents     | `/dashboard/{org}/settings/api/agents`                                     |
| API → WebDAV               | `/dashboard/{org}/settings/api/webdav`                                     |
| Enterprise SSO             | `/dashboard/{org}/settings/enterprise-sso`                                 |
| Data residency             | `/dashboard/{org}/settings/data-residency`                                 |

**Legacy redirects** (author against the targets, but SET-B1–SET-B3 assert the
bounces): `/dashboard/{org}/settings/api-keys` and
`/dashboard/{org}/settings/api/runtimes` → `…/api/rest`;
`/dashboard/{org}/settings/webdav` → `…/api/webdav`;
`/dashboard/{org}/settings/mcp` and `/dashboard/{org}/settings/mcp-servers` →
`…/connectors`; `/dashboard/{org}/settings/people` → `…/members`;
`/dashboard/{org}/settings/logs` → `…/governance/logs`;
`/dashboard/{org}/settings/deployment` → `…/data-residency`;
`/dashboard/{org}/settings/providers/{providerName}` → the providers index
with `?provider=<slug>` applied.

## Preconditions

Bring the stack up and sign in per [SETUP.md](../setup.md) as an **owner**.
Role gating (from `lib/permissions/ability.ts`): the Organization-group pages
plus Enterprise SSO, Data residency, Governance, and Metrics need
`orgSettings` read (**owner/admin**); Providers, Connectors, Sandboxes, and
the API section need `developerSettings` read (**owner/admin/developer**), except that a member holding the **Call models over the API** right opens the API section's REST and Models tabs (SET-B26), and one who may connect a coding agent here, or still holds a live connection, opens Connected agents (SET-B38);
Skills and the Personal group are open to every member. SET-B4–SET-B5 need a
second account per role (mint via `POST /api/auth/sign-up/email`, add under
Settings → Members); SET-F16 needs a second **already-existing** account. Mode
A makes the connector add-credential smoke (SET-F25) deterministic. The model
endpoint boxes (SET-F64–SET-F68, SET-B23–SET-B26, SET-A10) need the
endpoints switched on as in governance.md GOV-F41; a real answer needs mode B
with the sandbox model gateway running. The Connected agents boxes (SET-F85–SET-F88, SET-B38, SET-A11)
need coding agents connected as auth.md AUTH-F34–AUTH-F36 describe; the agent
sign-in is on unless `TALE_MCP_CLIENT_METADATA_DOCUMENTS` and
`TALE_MCP_DYNAMIC_CLIENT_REGISTRATION` are both `false`, and the page itself is
absent while it is off (SET-B38). The member rights boxes (SET-F93–SET-F101,
SET-B42–SET-B45, SET-A13–SET-A14) need a Member, an Editor, a Developer and
a second Admin, one more account whose role is **Disabled**, and the model
endpoints on as above.
Restore any toggled setting after the run.

> **Agent note**: pages on the header **Save** / **Discard** cluster
> (`common.actions.save` / `common.actions.discard`) — Account profile,
> Preferences custom-instructions text, Organization, Branding, Enterprise
> SSO, Data residency — flash **Saved** (`common.actions.saved`) and settle
> back to a disabled Save; there is no page toast. Everything else saves
> through its own dialog, row action, or on-flip toggle. Verify every
> persisted write by reloading and reading the value back, never by a
> transient toast. On desktop a bare `/settings` hit client-side-redirects to
> a permission-appropriate leaf — a momentarily blank main panel there is
> expected, not a render error. Destructive flows marked "cancel-only" are
> opened and dismissed, never confirmed.

## Functional tests

- [ ] `SET-F1` · **Rail structure & index redirect** — Desktop: open
  `/dashboard/{org}/settings` as owner, then as a developer and a member →
  The URL is replaced by `…/settings/account`, the panel's first row, for
  every role; the Settings panel runs the full height beside
  the page under its own header, **Settings** (`navigation.userSettings`), and
  shows the three section headers **Personal** / **Organization** /
  **Advanced** (`settings.menu.railSections.*`); every row carries an icon;
  the personalization row is labelled **Preferences**
  (`navigation.personalization`); **Governance**, **Metrics**, and **API** are
  disclosure rows (chevron, `aria-expanded`) whose children indent when open;
  one highlight glides to the open page's row (`aria-current="page"`), and
  rests on a collapsed group's row while the open page is inside it.
- [ ] `SET-F2` · **Mobile settings overviews** — Narrow viewport (or emulate
  mobile): open `/dashboard/{org}/settings`, then
  `/dashboard/{org}/settings/personal` → The workspace overview lists grouped
  entries — **You** (`settings.menu.groups.you`), **Organization**
  (`settings.menu.groups.organization`), **Advanced**
  (`settings.menu.groups.advanced`) — each with its description (e.g.
  `settings.menu.account.description`); `/settings/personal` shows only the
  **You** group; on desktop `/settings/personal` bounces to
  `…/settings/account`
- [ ] `SET-F3` · **Account profile name** —
  `/dashboard/{org}/settings/account` → **Name** field
  (`settings.account.profile.name`) → edit → header **Save**
  (`common.actions.save`) → The Save cluster flashes **Saved**
  (`common.actions.saved`) and disables again — no page toast; the new value
  reaches other mounted current-user readers, including the account menu,
  without a reload. Edit the name
  again, then header **Discard** (`common.actions.discard`) → the last saved
  name returns, not the name from before Save; the saved value
  is still in the Name field after a reload; the **Email** field
  (`settings.account.profile.email`) is read-only.
- [ ] `SET-F4` · **Account security** — Same page → **Password** section
  (`settings.account.security.title`) → open the change-password dialog
  (`auth.changePassword.title`) → The dialog opens with current/new/confirm
  fields and enforces the password policy (`auth.validation.passwordMinLength`
  etc.); 2FA, passkeys, and session depth are covered in [auth.md](auth.md) —
  here only confirm the sections render.
- [ ] `SET-F5` · **Account bulk chat actions** — Same page → **Your chats**
  section (`settings.account.chats.title`) → click **Archive all chats**
  (`settings.account.chats.archiveAll`), read the dialog, **cancel**; same for
  **Delete all chats** (`settings.account.chats.deleteAll`) — **cancel-only**
  → Each button opens a destructive confirm dialog (shared dialog copy — the
  per-dialog keys were consolidated in #2897) stating the consequence before
  anything happens; cancelling changes nothing (chat list unchanged after
  reload)
- [ ] `SET-F6` · **Preference toggle** —
  `/dashboard/{org}/settings/personalization` (heading **User preferences**,
  `personalization.page.title`) → flip the **Custom instructions** toggle
  (`personalization.page.customInstructionsToggle.label`) → The flip saves
  immediately — toast **Preferences updated.**
  (`personalization.toasts.preferencesUpdated`) — and persists across reload;
  the section's description carries the org-default hint
  (`personalization.page.enable.followingOrgDefault` /
  `…overridingOrgDefault`); it is the page's ONLY toggle — no Memories switch
  (retired with SET-F8; chat memories were removed); theme and language are
  **not** on this page (SET-F11)
- [ ] `SET-F7` · **Custom instructions text** — With the toggle on, type into
  the instructions field
  (`personalization.page.customInstructions.placeholder`) → header **Save** →
  The field only exists while the toggle is on; saving runs through the header
  cluster (Saved flash, no toast); the text survives a reload; the field shows
  a character counter and text over the limit shows the inline error
  (`personalization.errors.tooLong`)
- [ ] `SET-F8` · **~~Memories & pending sections~~ (retired)** → The
  memories section left the preferences page when custom instructions were
  wired into chat: nothing ever proposed a memory, and the feature was later
  removed with its backend store (knowledge entries and the sandbox agent's
  own memory cover the need). The page carries the custom-instructions
  section only (SET-F6, SET-F7).
- [ ] `SET-F9` · **Notification preferences** —
  `/dashboard/{org}/settings/notifications` → flip e.g. **Task assigned to
  me** (`notificationPreferences.fields.taskAssigned.label`); inspect **Review
  requests** (`notificationPreferences.fields.taskReview.label`) → Flips save
  silently (no Save bar, no success toast — a failure raises
  `notificationPreferences.saveFailed`); the flipped state persists across
  reload; the review-requests toggle is locked on with the hint
  (`notificationPreferences.fields.taskReview.lockedHint`); the **Email
  delivery** section (`notificationPreferences.deliveryTitle`) carries the
  **Email me actionable alerts** toggle
  (`notificationPreferences.fields.actionableEmail.label`)
- [ ] `SET-F61` · **Automation alerts for owners and admins** — Open
  `/dashboard/{org}/settings/notifications` as an owner or admin → the
  **Automation alerts** toggle
  (`notificationPreferences.fields.automationAlerts.label`) sits after
  **Agent escalations**, on by default; flip it off → the state persists
  across reload. As a member, editor or developer → no such toggle.
- [ ] `SET-F11` · **Theme & language (Manage account)** — Click the **Manage
  account** trigger (top-right user icon, `auth.userButton.manageAccount`) →
  theme tabs (`auth.userButton.themeSystem` / `…themeLight` / `…themeDark`);
  **Language** submenu (`auth.userButton.language`) → pick EN / DE / FR → The
  chosen theme applies immediately (the `html` element gains/loses the `dark`
  class) and survives reload; the chosen language re-renders the UI strings
  and survives reload — neither lives on a settings page.
- [ ] `SET-F12` · **Organization details** —
  `/dashboard/{org}/settings/organization` → **Organization name**
  (`settings.organization.organizationName`) → edit → header **Save**; check
  **Default language (for agents)** (`settings.organization.defaultLocale`)
  and **Organization ID** (`settings.organization.organizationId`) with its
  copy button (`settings.organization.copyOrganizationId`) → Saved flash, no
  toast; the new name survives reload; the locale select persists its pick the
  same way; the org ID is read-only and its copy button fills the clipboard.
- [ ] `SET-F13` · **Org danger zone** — Same page → **Danger zone**
  (`settings.organization.dangerZoneTitle`) → **Delete organization**
  (`settings.organization.deleteConfirmAction`) — **cancel-only** → The
  confirm dialog (`settings.organization.deleteDialogTitle`) names the org and
  warns the deletion is irreversible
  (`settings.organization.deleteDialogDescription`); cancelling changes
  nothing.
- [ ] `SET-F14` · **Members table** — `/dashboard/{org}/settings/members` →
  The members table renders under the description
  (`settings.organization.membersDescription`) with the current owner row;
  search (`settings.organization.searchMember`) narrows it; roles render from
  `roles.*` (Owner/Admin/Developer/Editor/Member)
- [ ] `SET-F15` · **Add member (new account)** — Same page → **Add member**
  (`settings.organization.addMember`) → fill **Name** / **Email** /
  **Password** (`settings.form.name` / `settings.form.email` /
  `settings.form.password`) + **Role** (`settings.form.role`) → submit (**Add
  member**, `dialogs.addMember.title`) → Toast **Member added**
  (`toast.success.newMemberCreated.title`); the result dialog
  (`dialogs.memberAdded.title`) shows the credentials block with the save-now
  warning (`dialogs.memberAdded.credentialsWarning`); after reload the new
  member row is in the table.
- [ ] `SET-F16` · **Add existing user hides password** — Needs a second
  existing account. Same dialog → enter the **existing** account's email → The
  password field is replaced by the existing-user hint
  (`dialogs.addMember.existingUserHint`); on submit the toast is **Member
  added** (`toast.success.existingUserAdded.title`) and the result dialog
  shows the existing-user notice (`dialogs.memberAdded.existingUserNotice`)
  with **no** credentials block.
- [ ] `SET-F17` · **Member row actions** — A member row's action menu → **Edit
  member** (`settings.organization.editMember`) → change the role → save; open
  **Transfer ownership** (`settings.organization.transferOwnership`) —
  **cancel-only**; **Remove member** (`settings.organization.removeMember`) on
  a throwaway member → Role change toasts
  (`settings.organization.memberUpdated`) and survives reload; your own role
  is not editable (`settings.organization.cannotChangeOwnRole`); the transfer
  confirm (`settings.organization.transferOwnershipConfirmation`) warns you
  will be demoted — cancel; removing toasts
  (`settings.organization.memberRemoved`) and the row is gone after reload.
- [ ] `SET-F18` · **Teams create & delete** —
  `/dashboard/{org}/settings/teams` → **Create team**
  (`settings.teams.createTeam`) → **Team name** (`settings.teams.teamName`) →
  create; then the row's **Delete team** (`settings.teams.deleteTeam`) →
  confirm → Toast `settings.teams.teamCreated`; the row (columns
  `settings.teams.columns.name` / `…columns.members` / `…columns.created`)
  appears **without a reload** and is still there after one; the delete confirm
  (`settings.teams.deleteConfirmation`) counts what the delete touches
  (`settings.teams.deleteImpact.summary`: members, projects, folders,
  documents, queued conversations) and — only when some item has no other
  team — how many become organization-wide
  (`settings.teams.deleteImpact.becomeOrgWide`); the row leaves the table
  **without a reload** (toast `settings.teams.teamDeleted`) and stays gone
  after one. Repeat the delete on two rows at once through the selection
  checkboxes and the footer's bulk **Delete** — both rows leave the table
  without a reload too.
- [ ] `SET-F19` · **Team member management** — A team row → **Edit team**
  (`settings.teams.editTeam`) → **Members** (`settings.teams.manageMembers`) →
  add/remove members → **Save changes** (`settings.teams.saveChanges`) → The
  member checklist explains multi-team membership
  (`settings.teams.memberChecklistHint`); a team never drops to zero members —
  the last one is blocked with the hint (`settings.teams.lastMemberHint`), and
  the server refuses it too (a failed save toasts
  `settings.teams.membershipChangesFailed`); the new member count — and a name
  changed in the same save — show in the row **without a reload** and survive
  one. A team an identity provider provisions (needs SSO group sync or SCIM)
  carries the **Synced** badge (`settings.teams.syncedBadge`) and opens the
  dialog read-only with the notice (`settings.teams.syncedNotice`); its
  **Delete** still works.
- [ ] `SET-F20` · **Providers page** — `/dashboard/{org}/settings/providers` →
  The **Credentials** section (`settings.providers.credentialsSection.title`)
  renders the credential table (or the empty state
  `emptyStates.providers.title` on a fresh org) with **Add credential**
  (`settings.credentials.addCredential`); the header offers **Refresh
  catalogs** (`settings.providers.catalogs.refresh`) whose result dialog lists
  per-catalog model counts (`settings.providers.catalogs.refreshed`); the
  **Harnesses** section (`settings.providers.harnesses.title`) renders below.
- [ ] `SET-F21` · **Add a provider credential** — **Add credential** → the
  catalog pane (`settings.credentials.catalog.title`) lists configured
  providers first with a **Configured** badge
  (`settings.credentials.catalog.configured`), then the rest alphabetically →
  While the catalog is loading, the picker shows an accessible loading state instead of the empty-catalog warning; the warning remains for a successfully empty catalog. Then pick a vendor → **Name** (`settings.credentials.name`) arrives filled with
  the vendor's name; keep it, fill **API key**
  (`settings.providers.dialog.secret`), optionally narrow the **Model
  allowlist** (`settings.providers.dialog.allowlist`) → **Add credential**
  (`settings.credentials.create`) → Toast **Credential added**
  (`settings.credentials.createdToast`); after reload the row is in the table
  under the vendor's name, with the vendor column
  (`settings.providers.vendorColumn`), the auth method
  (`settings.credentials.columns.method`), and — as the vendor's first
  credential — the **Default** badge (`settings.credentials.default`); the
  stored secret is never echoed back.
- [ ] `SET-F21a` · **Second credential for the same provider** — With
  SET-F21's row still named after its provider, **Add credential** → the same
  provider → **Name** arrives numbered (`OpenRouter` → `OpenRouter 2`), never
  a name that provider's rows already carry; Escape closes the untouched step
  with no discard prompt (`common.discardChangesConfirm` asks only once
  something was typed). Rename the first row (**Edit credential**) and add
  again → the suggestion is the bare provider name once more.
- [ ] `SET-F22` · **Credential row actions** — A credential row's action menu
  (`settings.credentials.actionsLabel`) → **Make default**
  (`settings.credentials.makeDefault`) on a second credential; **Disable** /
  **Enable** (`settings.credentials.disable` / `…enable`); **Edit credential**
  (`settings.credentials.edit`) → rename → save; the replace-secret entry
  (`settings.providers.replace.apiKeyTitle`); **Delete**
  (`settings.credentials.delete`) → Each action survives reload: the Default
  badge moves, a disabled row shows **Disabled**
  (`settings.providers.credential.disabled`), the rename toasts
  `settings.credentials.savedToast`; the replace dialog states the stored
  secret is never shown; deleting confirms
  (`settings.credentials.deleteTitle`) — deleting the default adds the warning
  (`settings.credentials.deleteDefaultWarning`) — then toasts
  `settings.credentials.deletedToast` and the row is gone; with no default
  left for a vendor the table shows the no-default notice
  (`settings.credentials.noDefault`)
- [ ] `SET-F22a` · **Provider changes apply without a reload** — On an org
  whose only provider credential is disabled, open a project's **Agents** tab
  → **New agent** (`projects.agents.newAgent`) → **Model**
  (`projects.agents.modelLabel`), which reads
  `projects.agents.modelSearchEmpty`; in the same tab **Enable**
  (`settings.credentials.enable`) the credential on the providers page, then
  revisit each surface without reloading → the **Agent runtimes** rows
  (`settings.providers.harnesses.title`) trade
  `settings.providers.harnesses.noModel` for a model count
  (`settings.providers.harnesses.modelPool`) and the one note above them
  (`settings.providers.harnesses.noDirectCredential`) leaves; the agent **Model** picker
  lists the provider's models; **Governance → Models** names the model that
  reads images (`governance.visionModel.resolved.*`, no longer
  `governance.visionModel.resolvedNone`); **Data residency** offers the
  credential's embedding model
  (`settings.dataResidency.orgEmbedding.recommendationBody`). With the
  **Model** picker open, **Disable** (`settings.credentials.disable`) the
  credential from a second tab → the open picker empties within seconds.
- [ ] `SET-F23` · **Vendor filter & search** — On providers: the **Provider**
  filter (`settings.providers.vendorFilterLabel`) and the search field
  (`settings.credentials.searchPlaceholder`); on connectors the same filter is
  labelled **Connector** (`settings.connectors.vendorFilterLabel`) → Filtering
  by vendor narrows the rows to that vendor; searching narrows by credential
  name; clearing restores the full table.
- [ ] `SET-F24` · **Connectors page** — `/dashboard/{org}/settings/connectors`
  → The credential table renders under the description
  (`settings.connectors.sectionDescription`) — or the empty state
  (`emptyStates.connectors.title`) on a fresh org — with **Add credential** opening the same two-step catalog picker; while the connector catalog is loading, the picker shows a loading state rather than the empty-catalog warning; connector auth methods render from
  `settings.connectors.authMethod.*` (API key / Token / Username & password /
  OAuth)
- [ ] `SET-F25` · **Connector add-credential smoke** — Mode A. **Add
  credential** → pick an API-key connector (e.g. Tavily) → fill the key
  (`settings.connectors.dialog.apiKey`) → create → The connect test runs
  against the mock gateway and succeeds offline; toast
  `settings.credentials.createdToast` and the row is present after reload.
  Per-connector depth (OAuth consent, imap-smtp split SMTP, reconnect) is
  [connectors.md](connectors.md)'s job.
- [ ] `SET-F26` · **Skills table smoke** — `/dashboard/{org}/settings/skills`
  → The table renders (any member may see it) with columns from
  `skills.columns.*` (Name / Description / Visibility / Usage / Labels),
  visibility badges (`skills.visibility.org` / `…team` / `…private`), and
  search (`skills.searchPlaceholder`); a fresh org shows the seeded builtin
  skills or the empty state (`emptyStates.skills.title`)
- [ ] `SET-F27` · **Skills add-menu smoke** — **Add skill**
  (`skills.addMenu.label`) → **Blank skill** (`skills.createMenu.blank`) → The
  menu offers **Blank skill** / **Upload zip** / **Upload folder**
  (`skills.createMenu.uploadZip` / `…uploadFolder`); the create dialog
  (`skills.createDialog.title`) opens with slug-pattern validation
  (`skills.createDialog.namePatternError`); dismiss with Escape —
  authoring/upload depth belongs to a future skills guide.
- [ ] `SET-F28` · **Branding accent color** —
  `/dashboard/{org}/settings/branding` → **Accent color**
  (`settings.branding.accentColor`) → pick/enter a hex → header **Save** → The
  **Branding preview** (`settings.branding.preview`) re-tints live while
  editing; Saved flash, no toast; the hex survives reload; primary buttons and
  the sidebar highlight pick up the accent in light **and** dark themes.
- [ ] `SET-F28a` · **A hard accent in both themes** — Same page → **Accent
  color** → save `#F5F5F0`, then `#0B0B2A`, then `#FF00FF`; after each, look
  at a chat with a cited reply, the Home panel with an unread item, and this
  page, in **Light theme** and **Dark theme** (`auth.userButton.themeLight` /
  `…themeDark`) → The **Branding preview** shows what the app shows; primary
  buttons and the chat's send button wear the accent (rimmed in it on the
  light theme) with a legible label or arrow; Tab onto one draws a ring inside
  it in its label's colour; Home's unread dots and the view switcher's
  attention dots wear the accent, never a fixed blue; a citation, a link and
  the open settings row stay readable — a deeper shade of the accent on the
  light theme, a lighter one on the dark — and nothing set in the accent reads
  pale on the page.
- [ ] `SET-F29` · **Branding images & reset** — Same page → **Upload logo**
  (`settings.branding.uploadLogo`) / **Upload favicon**
  (`settings.branding.uploadFavicon`); then the header's **Reset** action
  (`common.actions.reset`) — **cancel-only** → Image uploads save immediately
  with their own toasts (they do not pass through the Save cluster); the
  uploaded logo appears in the preview and survives reload; the reset confirm
  (`settings.branding.resetConfirmTitle`) warns removed images can't be
  restored — cancel. Then remove the logo, light favicon and dark favicon
  individually with their named remove controls, using the keyboard for one
  removal → Each deletion persists immediately and survives reopening the
  page; Save/Discard stay disabled unless an accent edit is pending. Focus
  returns to the corresponding upload control after success. With a deletion
  delayed, its upload/remove controls prevent competing writes. With a
  deletion refused, one error toast appears and the image remains available
  for retry; Discard of a pending accent edit never restores a deleted image.
  With an accent Save response delayed, remove each image in turn; repeat with
  a committed DELETE response delayed and Save pressed before it returns →
  Writes settle in order and reopening never restores the deleted reference;
  the accent draft is preserved and remains retryable after a refusal. Repeat
  with a replacement upload and a logo-derived favicon while Save is pending;
  Save never overwrites those persisted image references. Reset also waits for
  earlier image/colour writes and leaves the confirmed cleared state saved.
- [ ] `SET-F30` · **Sandboxes page** — `/dashboard/{org}/settings/sandboxes` →
  A fresh org shows **No workspaces yet** (`sandboxes.empty.title`); with a
  live sandbox session (env-gated) the table renders columns
  `sandboxes.columns.owner` / `…agent` / `…status` / `…task` / `…spend` and
  admin row actions **Stop task** / **Pin** / **Destroy** (`sandboxes.actions.stop` /
  `…pin` / `…destroy`; Destroy confirms via `sandboxes.destroyConfirm.title`)
  — runtime and organization allocation are separate; a running container can
  show **Quota released** (`sandboxes.status.quotaReleased`). A project
  agent's workspace whose task finished more than 30 minutes ago still lists
  as **Stopped** (`sandboxes.status.runtime.stopped`) + **Quota released**,
  and stays listed after a reload — the page's mount probe never destroys a
  hibernated workspace. Every header label sits inside its own column in
  `en`, `de` and `fr` (no label paints over its neighbour, no horizontal
  scrollbar at the settings pane's width); the row-action column has no
  visible header. Quota editing is covered by GOV-F13.
- [ ] `SET-F31` · **Metrics smoke** — Expand the rail's **Metrics** group;
  open `/dashboard/{org}/settings/metrics` → The group lists six children from
  `metrics.groups.*` (Usage / Feedback / Chat health / Harness turns /
  Automations / Projects); the index redirects to `…/settings/metrics/usage`,
  which renders the period picker (`metrics.period.label`) and content without
  console errors — full coverage arrives with a dedicated metrics guide.
- [ ] `SET-F32` · **API keys lifecycle** —
  `/dashboard/{org}/settings/api/rest` → **Create API key**
  (`settings.apiKeys.createKey`) → **Key name** (`settings.apiKeys.form.name`)
  + **Expiration** (`settings.apiKeys.form.expiresIn`) → **Create key**
  (`settings.apiKeys.createKeySubmit`); read **Your API key**
  (`settings.apiKeys.yourApiKey`) → **Done** (`common.actions.done`); later
  the row's **Revoke key** (`settings.apiKeys.revokeKey`) → Toast
  `settings.apiKeys.keyCreated`; the secret is revealed exactly once (gone
  after Done); the row is in the table after reload (columns
  `settings.apiKeys.columns.name` / `…owner` / `…expires` / `…created` /
  `…lastUsed`, the masked key under the name);
  revoking confirms (`settings.apiKeys.revokeKeyTitle`), toasts
  `settings.apiKeys.keyRevoked`, and the row is gone after reload. The create
  dialog's hint (`settings.apiKeys.form.scopeHint`) says the key belongs to
  the person, not the organization; as a member of two organizations, `GET
  /api/v1/me` with the key and no `X-Organization-Slug` header answers `400
  ORG_SLUG_REQUIRED`, and with the header it lists the role in each.
- [ ] `SET-F76` · **An API key's expiry date** —
  `/dashboard/{org}/settings/api/rest` → **Create API key**
  (`settings.apiKeys.createKey`); read the line under **Expiration**
  (`settings.apiKeys.form.expiresIn`); choose **Custom date**
  (`settings.apiKeys.form.expiresOptions.custom`), open **Expiration date**
  (`settings.apiKeys.form.expiryDate`) and pick a day two weeks out → **Create
  key**; repeat with **Never** (`settings.apiKeys.form.expiresOptions.never`) →
  The line names the day a 30-day key expires
  (`settings.apiKeys.form.expiresOn`) and, for **Never**, that the key works
  until it is revoked (`settings.apiKeys.form.neverExpiresHint`); the calendar
  disables today and every day more than one year out; after reload the
  custom key's **Expires** (`settings.apiKeys.columns.expires`) shows the
  picked day and the other key's reads **Never**
  (`settings.apiKeys.neverExpires`); `GET /api/v1/me` with the custom key
  reports the picked day as the key's `expiresAt`.
- [ ] `SET-F77` · **A key for another member** — as an Admin,
  `/dashboard/{org}/settings/api/rest` → **Create API key** → **Belongs to**
  (`settings.apiKeys.form.owner`) = **Another member**
  (`settings.apiKeys.form.ownerOptions.member`); open **Member**
  (`settings.apiKeys.form.member`) and pick a Member → **Create key** → The
  picker lists no Admin, no Owner and not you; the success view reads **New
  API key** (`settings.apiKeys.newApiKey`) and tells you to hand the key to
  the member (`settings.apiKeys.keyCreatedForMember`); the table's **Belongs
  to** (`settings.apiKeys.columns.owner`) names the member, with **Made by**
  you beneath (`settings.apiKeys.owner.madeBy`). Signed in as the member, the
  bell shows **API key created for you** (`inbox.apiKeyCreatedForYou`), whose
  link opens this page; the row reads **You** (`settings.apiKeys.owner.you`)
  and **Revoke key** ends it. `GET /api/v1/me` with the key, sent without
  `X-Organization-Slug` by a member of two organizations, answers 200 with
  one organization and `key.owner.kind` `member`; with the other
  organization's slug it answers 403 `ORG_FORBIDDEN` listing this one.
- [ ] `SET-F78` · **A team's, a project's and the organization's key** — as an
  Admin, create three keys with **Belongs to** = **A team**, **A project**
  and **The organization** (`settings.apiKeys.form.ownerOptions.*`), each
  with a role under **Acts as** (`settings.apiKeys.form.role`) → **Acts as**
  offers Member, Editor and Developer for the team and the project, and Admin
  too for the organization; the hint under **Belongs to** changes with the
  choice (`settings.apiKeys.form.ownerHints.*`); each row's **Belongs to**
  reads **Team ‹name›** / **Project ‹name›** / **Organization**
  (`settings.apiKeys.owner.*`) with **Acts as ‹role›** beneath. `GET
  /api/v1/me` answers an empty `user.email`, one organization with the chosen
  role and `key.owner` naming the team or project; with the project's key,
  `GET /api/v1/projects` lists that project alone and `GET /api/v1/contacts`
  answers 403 `API_KEY_SCOPE_FORBIDDEN`, and a message sent with it in one of
  the project's threads asking for the organization's contacts gets none;
  the team's key lists the team's projects and the organization-wide ones,
  not another team's.
- [ ] `SET-F104` · **Turn off members' personal keys** — with a Developer
  who belongs to this organization and a second one and holds a key of
  their own, a key of your own (both SET-F32's way), and SET-F77's and
  SET-F78's keys live, as an Owner or Admin open
  `/dashboard/{org}/settings/api/rest` → Below the keys table the section
  **Members' personal keys** (`settings.apiKeys.personalKeys.title`) reads
  `settings.apiKeys.personalKeys.description`, beside a switch that is on
  and that a screen reader names **Members' personal keys work here**
  (`settings.apiKeys.personalKeys.enabledLabel`). Turn it off → the toast
  says `settings.apiKeys.personalKeys.saved`, and the switch is still off
  after a reload. `GET /api/v1/me` with the Developer's key and this
  organization's `X-Organization-Slug` answers 403
  `API_KEY_PERSONAL_REFUSED`, whose `data.organizations` lists the second
  organization and not this one; with the second organization's slug it
  answers 200. Your own key gets the same 403 here, and so does SET-F33's
  copied `tools/list` request with either key; `GET /api/v1/openai/models`
  answers the code in the OpenAI error shape (GOV-F40), with no list.
  SET-F77's and SET-F78's keys still answer 200. The audit log (**Settings
  → Governance → Logs**) lists a `governance_policy.created` row for
  `personal_keys` the first time the setting is saved here, and a
  `governance_policy.updated` one after that, with `enabled` `true` under
  **Previous state** and `false` under **New state**. Signed in as the
  Developer, the page opens with **Your own keys don't work here**
  (`settings.apiKeys.personalKeys.refusedTitle`) and
  `settings.apiKeys.personalKeys.refusedBody`, shows no **Members' personal
  keys** section, and **Create API key** still makes a key. Turn the switch
  back on → the Developer's key answers 200 here again, the notice is gone
  after a reload, and the audit log adds a `governance_policy.updated` row
  from `false` to `true`.
- [ ] `SET-F79` · **A key ends with what it belongs to** — with SET-F77's and
  SET-F78's keys live: open the team's **Delete** confirmation → it counts the
  team's API keys (`settings.teams.deleteImpact.apiKeys`); delete the team,
  delete the project, and remove the member from the organization → each of
  their keys answers 401 on its next call and leaves the table; the audit log
  (**Settings → Governance → Logs**) shows one **API key revoked** row per
  key, by the system, with the reason (`team_deleted`, `project_deleted`,
  `member_removed`). The organization's key keeps working. Make a second key
  for a Member as a second Admin, then change that Admin's role to Member →
  the key answers 403 `ORG_FORBIDDEN` ("whoever made it is no longer an Owner
  or Admin above the member"); remove that Admin instead → the key is revoked
  with the reason `maker_removed`.
- [ ] `SET-F103` · **Block a member's own key here** — with a Developer who
  belongs to this organization and a second one and holds a key of their
  own (SET-F32), as an Owner or Admin open `/dashboard/{org}/settings/members`
  → the Developer's row actions → **Personal API keys**
  (`settings.apiKeys.memberKeys.action`) → **Block**
  (`settings.apiKeys.memberKeys.block`) → **Block key**
  (`settings.apiKeys.memberKeys.blockDialog.confirm`) → The row turns from
  **Works here** (`settings.apiKeys.memberKeys.works`) to **Blocked here**
  (`settings.apiKeys.memberKeys.blocked`), naming you and the day
  (`settings.apiKeys.memberKeys.blockedBy`). `GET /api/v1/me` with the key and
  this organization's `X-Organization-Slug` answers 403 `API_KEY_BLOCKED`,
  whose `data.organizations` lists the second organization and not this one;
  with the second organization's slug it answers 200. Signed in as the
  Developer, the bell shows **Your API key was blocked in this organization**
  (`inbox.apiKeyBlockedForYou`), and `/dashboard/{org}/settings/api/rest`
  still lists the key, marked **Blocked in this organization**
  (`settings.apiKeys.owner.blockedHere`). The audit log (**Settings →
  Governance → Logs**) shows one **API key blocked**
  (`settings.logs.audit.actionLabels.api_key.blocked`) row by you, naming the
  key by its name and masked ends, never its secret. **Lift block**
  (`settings.apiKeys.memberKeys.unblock`) → the key answers 200 here again,
  the bell says **The block on your API key was lifted in this organization**
  (`inbox.apiKeyUnblockedForYou`), and the log adds **API key block lifted**.
  Turn off **Members' personal keys work here**
  (`settings.apiKeys.personalKeys.enabledLabel`, SET-F104) and reopen the
  dialog → it says so (`settings.apiKeys.memberKeys.refusedNotice`) and
  marks the unblocked key **Refused here**
  (`settings.apiKeys.memberKeys.refused`), never **Works here**, while
  **Block** stays offered. Turn the setting back on → the key is marked
  **Works here** again.
- [ ] `SET-F102` · **Every key that works here** — as an Admin, with a
  Member who made a key for themselves and SET-F77's key live:
  `/dashboard/{org}/settings/api/rest` → **Keys to show**
  (`settings.apiKeys.scope.label`) → **All keys in this organization**
  (`settings.apiKeys.scope.all`) → The description reads
  `settings.apiKeys.allKeysDescription`; the Member's own key joins the keys
  **Keys you manage** (`settings.apiKeys.scope.managed`) lists, its name
  marked **Personal key** (`settings.apiKeys.owner.personal`), the Member's
  name over their e-mail under **Belongs to**, **Last used** reading **Not
  available** (`settings.apiKeys.lastUsedUnavailable`) even after a `GET
  /api/v1/me` with it, and neither a checkbox nor a row menu; your own keys
  keep theirs. Change the Member's role to **Disabled**, or remove them from
  the organization, then open the view again → their own key has left it and
  still works in their other organizations. Turn **Members' personal keys work
  here** (`settings.apiKeys.personalKeys.enabledLabel`) off and open the view
  again → no one's own key is listed, the Member's and yours included, and the
  line above the table says why (`settings.apiKeys.scope.personalKeysRefused`);
  **Keys you manage** still lists your own. Turn it back on → the Member's key
  is listed again. Block the Member's key here as SET-F103 does and open
  the view again → the key has left it; signed in as the Member, their own
  list still shows it, marked **Blocked in this organization**
  (`settings.apiKeys.owner.blockedHere`). Lift the block → it is listed
  again. Signed in as the Member, the page offers no **Keys to show**, and
  `GET /api/app/api-keys?scope=all` from their session answers their own
  keys alone.
- [ ] `SET-F33` · **MCP endpoint page** — `/dashboard/{org}/settings/api/mcp`
  → copy the endpoint (`settings.mcpEndpoint.copyEndpoint`); read the tool
  inventory; **Copy example request** (`settings.mcpEndpoint.copyExample`) →
  The page (`settings.mcpEndpoint.title`) renders four tool groups —
  **Authoring** (`settings.mcpEndpoint.tools.authoring.title`), **Run &
  trigger management** (`settings.mcpEndpoint.tools.management.title`),
  **Discovery** (`settings.mcpEndpoint.tools.discovery.title`), **Capabilities
  & knowledge** (`settings.mcpEndpoint.tools.capability.title`) — each tool
  name whole and none running into another, also at 375 px; a screen reader
  names each list by its group; and
  the **Try it** example (`settings.mcpEndpoint.exampleTitle`); auth help
  points at REST API keys (`settings.mcpEndpoint.authLink`) — and, where agent
  sign-in is on and the person may connect an agent, first says a coding agent
  signs itself in and links to **Connected agents**
  (`settings.mcpEndpoint.signInHelp`, `settings.mcpEndpoint.signInLink`), the
  key then being for scripts and clients that cannot sign in
  (`settings.mcpEndpoint.authHelpScripts`); the
  **Organization slug** row (`settings.mcpEndpoint.orgSlug.title`) shows this
  org's slug with its own copy control (`settings.mcpEndpoint.orgSlug.copy`)
  and the copied example already carries `X-Organization-Slug: <that slug>`;
  with an SET-F32 key filled in, the copied `tools/list` request returns those
  tools — also for a user who belongs to two organizations.
- [ ] `SET-F34` · **WebDAV app-passwords** —
  `/dashboard/{org}/settings/api/webdav` → **Generate a new app-password**
  (`webdav.create.title`) → **Label** (`webdav.create.labelLabel`) →
  **Generate** (`webdav.create.submit`); read **Connection details**
  (`webdav.connectionDetails.title`); later the row's **Revoke**
  (`webdav.list.revoke`) → The password is shown once under the save-now
  banner (`webdav.create.savedTitle`) and dismissed with **I have saved it**
  (`webdav.create.dismiss`); the row joins the **App-passwords** list
  (`webdav.list.title`) after reload; the connection details show username +
  URL (`webdav.connectionDetails.usernameLabel`); revoking confirms
  (`webdav.revokeDialog.title`) and marks the row revoked after reload.
- [ ] `SET-F52` · **WebDAV refuses dot-segments** — with a SET-F34
  app-password, `MKCOL /dav/<org>/documents/dotprobe/`, then
  `curl --path-as-is --user <email>:<password> --upload-file note.txt
  <site>/dav/<org>/documents/dotprobe/%2E%2E/escape.txt` and the same with a
  raw `../` → both answer `404`; `PROPFIND Depth: 1` on `/dav/<org>/documents/`
  lists no `escape.txt`, and the Document Hub shows no stray file either;
  `dotprobe/` deletes cleanly afterwards. Repeat the raw spelling with
  backslashes (`dotprobe\..\escape.txt`, sent as-is) → `404` as well, and
  still no `escape.txt` anywhere.
- [ ] `SET-F53` · **WebDAV organization root** — with a SET-F34
  app-password, `curl --user <email>:<password> -X PROPFIND -H 'Depth: 1'
  <site>/dav/<org>/` → `207` whose first `href` is `/dav/<org>/` (a
  collection named after the org slug) followed by exactly
  `/dav/<org>/documents/` and `/dav/<org>/.trash/`; `Depth: 0` answers the
  root alone; mounting `/dav/<org>/` in Finder or Explorer shows the two
  folders and nothing else; a `PROPPATCH` on `/dav/<org>/` answers `405`
  with `Allow: OPTIONS, PROPFIND`.
- [ ] `SET-F35` · **Enterprise SSO configure** —
  `/dashboard/{org}/settings/enterprise-sso` → pick a **Protocol**
  (`settings.enterpriseSso.protocolLabel`; options
  `auth.sso.protocol.*`) → fill issuer/client fields
  (`settings.enterpriseSso.issuerLabel` / `…clientIdLabel` /
  `…clientSecretLabel`) → **Test connection** (`settings.enterpriseSso.test`)
  → header **Save**; in **SCIM provisioning**
  (`settings.enterpriseSso.scim.section`) click **Generate token**
  (`settings.enterpriseSso.scim.generate`) → The header **Save** flashes
  Saved, no toast;
  Test keeps its own result (`settings.enterpriseSso.testOk` / `…testFailed`);
  after reload the status shows **Sign-in is enabled.**
  (`settings.enterpriseSso.connected`); the read-only **Redirect URL**
  (`settings.enterpriseSso.redirectUrlLabel`) is copyable; the SCIM token is
  revealed once (`settings.enterpriseSso.scim.tokenCreatedHelp`) beside the
  base URL (`settings.enterpriseSso.scim.baseUrlLabel`); a **Setup guide**
  (`settings.enterpriseSso.guide.title`) renders per protocol.
- [ ] `SET-F36` · **Data residency route** —
  `/dashboard/{org}/settings/data-residency` → The page renders the **External
  Postgres** surface (`settings.dataResidency.externalPostgres`); a
  non-operator sees the **Read-only access** notice
  (`settings.dataResidency.readOnly.title`) naming their sign-in email — full
  depth (stores, tests, restart) is [data-residency.md](data-residency.md)'s
  job.
- [ ] `SET-F37` · **Infrastructure capacity** — `/dashboard/{org}/settings/sandboxes` → with a configured sandbox service, read **Deployment sandboxes** (`sandboxes.capacity.hostSessions`) as the running and starting count across all organizations / deployment capacity; **Your organization's sandboxes** (`sandboxes.capacity.organizationSessions`) shows only this organization's count, including idle sandboxes kept for reuse. Both cards keep their explanatory hints visible. Click **Refresh** (`sandboxes.capacity.refresh`) → **Observed** (`sandboxes.capacity.observedAt`) advances. CPU and memory show measured usage and total hardware separately from configured session limits; a Kubernetes deployment names namespace scope and an Incus deployment project scope (`sandboxes.capacity.namespaceSessions`, `sandboxes.capacity.projectSessions`), and both leave unsupported host measurements unavailable; the first observation after opening the page already shows **Host CPU usage** (`sandboxes.capacity.cpu`) as a number, not `sandboxes.capacity.unknownValue`.
- [ ] `SET-F38` · **Concurrent tasks and spend per workspace** —
  `/dashboard/{org}/settings/sandboxes` as an admin, after starting three
  tasks for the SAME project agent (env-gated) → The agent keeps ONE workspace
  row (`sandboxes.limits.usage` counts one project session) whose
  `sandboxes.columns.task` cell reads **3 project tasks**
  (`sandboxes.task.project`) above the three task ids; when a task settles,
  its id drops from the cell and `sandboxes.columns.spend` grows by that
  turn's metered cost (a workspace whose turns never settled shows **—**).
- [ ] `SET-F39` · **Usage limits as a member** — As owner, give Budget rules
  (Governance → Policies & Limits) a monthly default cost cap with a warning
  threshold, a daily default request cap and an organization cost cap; then
  open `/dashboard/{org}/settings/usage` as a plain **member** → The rail lists
  **Usage** (`navigation.usage`) under Personal; **Your limits**
  (`settings.usage.personal.title`) shows one row per capped dimension, such as
  **Monthly cost** (`settings.usage.metric.costCents`) and **Daily requests**
  (`settings.usage.metric.requests`), each with its reset in local time
  (`settings.usage.resets`) and a used-of-limit meter
  (`settings.usage.usedOfLimit`); **Shared limits**
  (`settings.usage.shared.title`) shows the organization cap as **Entire
  organization · resets …** (`settings.usage.organizationScope`); a bar at or
  over the warning threshold turns amber; **Storage**
  (`settings.usage.storage.title`) meters **Uploaded files**
  (`settings.usage.storage.label`) against the upload policy's per-user volume.
- [ ] `SET-F40` · **Usage page entry points** — With the member past the
  warning threshold, open Chat → The budget banner links **View usage**
  (`chat.budgetViewUsage`) to `/dashboard/{org}/settings/usage`; as owner, the
  page's first section offers **Manage limits** (`settings.usage.manageLimits`)
  to `/dashboard/{org}/settings/governance/policies-limits`, and the member
  sees no such link.
- [ ] `SET-F105` · **What fills the storage meter** — As a member with the
  upload policy's per-user volume set, upload a document into a folder of
  **Knowledge** and attach a file in a chat, then open
  `/dashboard/{org}/settings/usage` → Under the **Storage** meter, **Breakdown**
  (`settings.usage.storage.breakdown.label`) lists **Documents**, **Chat
  attachments** and **Files made by agents** with sizes that add up to the
  meter's used amount, and **Other files** only when some count; **View my
  documents in Knowledge** (`settings.usage.storage.viewDocuments`) opens
  Knowledge › Documents with **Uploaded by** (`tables.headers.uploadedBy`) ›
  **Me** (`documents.filter.uploadedBy.me`) selected, listing the document
  without folder rows or breadcrumb, and clearing the filter returns to the
  root; the chat is listed under **Chats that hold your files**
  (`settings.usage.storage.chats.label`) and its name opens it.
- [ ] `SET-F41` · **Team writes reach a second session** — Two signed-in
  sessions of the SAME organization (two browsers/profiles), both parked on
  `/dashboard/{org}/settings/teams`, neither reloaded for the whole box → In
  session A create a team, then **Edit team** (`settings.teams.editTeam`) →
  rename it → **Save changes**, then delete it. Session B's table gains the
  row, shows the NEW name, and loses the row — each within a couple of
  seconds and with no reload, because every team write emits its `team`
  invalidation hint on the backend's realtime hint stream (the dialogs only
  refresh the tab they run in). In session A — whose user the create dialog
  added to the team — the account menu's **Teams** row
  (`navigation.myTeams.label`) and **Settings › Account › Your teams**
  (`settings.account.teams.title`) show the created name, then the new name,
  then drop it, without a reload.
- [ ] `SET-F42` · **Your teams on the account page** —
  `/dashboard/{org}/settings/account` (its `#teams` anchor) as a member of two teams, then as
  an account in none, then as an owner → The **Your teams** section
  (`settings.account.teams.title`, its description
  `settings.account.teams.description`) lists each team as a badge; the
  account in no team reads `settings.account.teams.none` instead; only an
  admin/owner sees the **Manage teams** link
  (`settings.account.teams.manageLink`) to `/dashboard/{org}/settings/teams`.
- [ ] `SET-F43` · **Custom provider from the credential dialog** — **Add
  credential** (`settings.credentials.addCredential`) → the entry **Custom
  provider** (`settings.providers.custom.pickerTitle`) stays pinned under the
  catalog while a search matches nothing
  (`settings.credentials.catalog.noMatches`) → pick it → **Provider name**
  (`settings.providers.custom.nameLabel`) arrives empty; with the name and
  **API key** (`settings.providers.dialog.secret`) filled, **Add credential**
  (`settings.credentials.create`) stays disabled until **Base URL**
  (`settings.providers.custom.baseUrl`) holds a public `https://` host; pick
  the **API format** (`settings.providers.custom.apiFormat`), keep **Discover
  from the endpoint** (`settings.providers.custom.modelsDiscover`) → submit →
  Toast `settings.credentials.createdToast`; the row lists the provider with
  the **Custom** badge (`settings.providers.custom.badge`) and, for a host
  that refuses the listing, the catalog error
  (`settings.providers.card.catalogUnavailable`); the picker offers the
  provider with the same badge; the row menu
  (`settings.credentials.actionsLabel`) → **Check models**
  (`settings.providers.custom.check`) toasts
  `settings.providers.custom.checkOk` or `settings.providers.custom.checkFailed`;
  **Edit credential** (`settings.credentials.edit`) shows **Base URL** and
  **API format** beside the name and saving toasts
  `settings.credentials.savedToast`; **Delete** (`settings.credentials.delete`)
  on the provider's only credential shows
  `settings.providers.custom.deleteRetires` → confirm → after reload the row
  and the picker entry are gone while `TALE_CONFIG_DIR/<org>/providers/.history/`
  keeps the archived file; the same entry creates a second custom provider
  whose identifier numbers past the first (`qwen-cn`, then `qwen-cn-2`).
- [ ] `SET-F44` · **Role rules keep their order** —
  `/dashboard/{org}/settings/enterprise-sso` with **Auto-assign roles from the
  IdP** (`settings.enterpriseSso.autoRoleLabel`) on → add three rules
  (`settings.enterpriseSso.roleMapping.addRule`), move the last one up with
  its **Move up** arrow (`common.moveUp`), drag another by its handle
  (`common.drag`), header **Save**, reload → The help text
  (`settings.enterpriseSso.roleMapping.help`) says rules are checked top to
  bottom and the first match sets the role; the rules come back in the new
  order; the first row's **Move up** and the last row's **Move down**
  (`common.moveDown`) are disabled; a row's remove button
  (`settings.enterpriseSso.roleMapping.removeRule`) deletes only that row.
  With an IdP at hand, a user matching two rules signs in with the higher
  rule's role.
- [ ] `SET-F45` · **Your role on the account page** —
  `/dashboard/{org}/settings/account` (its `#role` anchor) as an editor, then
  as an owner → The **Your role** section (`settings.account.role.title`, its
  description `settings.account.role.description`) sits above **Your teams**
  and shows the role as a translated badge (`roles.editor`, never the
  raw `editor`); only the owner sees **Manage members**
  (`settings.account.role.manageLink`) to `/dashboard/{org}/settings/members`;
  hovering the name in the profile menu reads the name and the same translated
  role.
- [ ] `SET-F46` · **Typing a hex one character at a time** —
  `/dashboard/{org}/settings/branding` → click the **Accent color hex value**
  field (`settings.branding.hexValueAria`) and type `E`, `1`, `1`, `D`, `4`,
  `8` one keystroke at a time → The page stays responsive after every
  keystroke (no frozen tab, no CPU spin); the **Branding preview** keeps the
  last complete color until all six digits are in, then re-tints to
  `#E11D48`; **Save** stays disabled while the value is shorter than six
  digits.
- [ ] `SET-F48` · **The page header names the open page** — Desktop, as owner:
  click **Teams** in the Settings panel, then expand **Governance** and click
  **Policies & Limits**, then open **Branding** and edit a field → The page
  header beside the panel reads **Teams** (`navigation.teams`), then
  **Governance · Policies & Limits** (`navigation.governance` ·
  `governance.groups.policiesAndLimits`), then **Branding** — never a bare
  **Settings**, which the panel's own header already says; Branding's **Save**
  / **Discard** cluster sits in that same page header; each switch shows the
  new page at once, at its top and with no fade, while the panel stays put,
  its scroll untouched.
- [ ] `SET-F47` · **A page never prints its own name twice** — Desktop, as
  owner: open **Teams**, **Members** and **Notifications** in the Settings
  panel → Under the header **Teams** (`navigation.teams`) the page opens on
  its section's description (`settings.teams.sectionDescription`) and the
  table, with no second visible **Teams** heading; **Members**
  (`navigation.members`) likewise opens on
  `settings.organization.membersDescription`; the accessibility tree still
  holds each section's `h2` (**Teams**, **Members**). On **Notifications**,
  whose first section is **Email delivery**
  (`notificationPreferences.deliveryTitle`), the second section keeps its
  visible **Notifications** title (`notificationPreferences.title`).
- [ ] `SET-F54` · **A deleted agent's workspace goes with it** —
  `/dashboard/{org}/settings/sandboxes` as an owner, with a project agent
  that has run at least one task (its workspace is listed under the agent's
  name) → delete that agent from the project's Agents tab → back on
  Sandboxes → Within a minute the row is gone on its own. While a task still
  runs in it the row stays, its **Workspace** column reading **Deleted
  agent** (`sandboxes.deletedAgent`), never the owner id, and it leaves once
  that task ends. `/dashboard/{org}/settings/governance/logs` lists **Sandbox
  workspace deleted** for it.
- [ ] `SET-F55` · **One team name per organization** —
  `/dashboard/{org}/settings/teams` with a team named `Finance` →
  **Create team** (`settings.teams.createTeam`) → **Team name**
  (`settings.teams.teamName`) `finance ` (other case, trailing space) →
  create; then another team's row → **Edit team** (`settings.teams.editTeam`)
  → rename it to `FINANCE` → **Save changes** (`settings.teams.saveChanges`)
  → Both are refused under the field with
  `settings.teams.teamNameTaken`; each dialog stays open, the list keeps one
  `Finance` row and the audit log gains no team-created or team-updated row.
  Reopening `Finance` itself and saving its own name unchanged goes through.
- [ ] `SET-F49` · **Remove member names the organization** — A member row's
  action menu → **Remove member** (`settings.organization.removeMember`) →
  The confirmation (`dialogs.confirmRemoveMember`) asks about removing the
  person **from this organization** and says they lose access to it — never
  "from the team" (teams have their own Delete flow) — then cancel.
- [ ] `SET-F50` · **Branding Reset commits at once** — On a throwaway
  organization with a saved accent color and an uploaded logo →
  `/dashboard/{org}/settings/branding` → the header's **Reset** action
  (`common.actions.reset`) → confirm (`settings.branding.resetConfirmTitle`)
  → Toast `settings.branding.resetDone`; the accent field is empty, the logo
  slot shows the placeholder and **Reset** is disabled; navigating away
  raises no unsaved-changes prompt and no **Save** is needed; after a reload
  the accent is still the default; `logs` → **Audit logs** shows one
  **Branding updated** (`settings.logs.audit.actionLabels.branding.updated`)
  row beside the image removals.
- [ ] `SET-F51` · **Delete organization asks for its name** — Same page as
  SET-F13 → **Delete organization**
  (`settings.organization.deleteConfirmAction`) — **cancel-only** → The
  confirm shows a field labelled `settings.organization.deleteTypeNameLabel`
  and its **Delete organization** button stays disabled; typing a different
  name keeps it disabled, typing the organization's exact name enables it —
  then cancel; reopening the dialog starts with an empty field again.
- [ ] `SET-F56` · **Add a sandbox device** — As owner on
  `/dashboard/{org}/settings/sandboxes`, the **Devices** section
  (`sandboxes.devices.title`) shows **No devices yet**
  (`sandboxes.devices.empty.title`); click **Add device**
  (`sandboxes.devices.add`), select **Copy command**
  (`sandboxes.devices.addDialog.copyCommand`) under **Install and connect**
  (`…addDialog.commandLabel`) and run the copied line in a terminal on a Linux
  or macOS machine with Docker → The button confirms **Copied**
  (`…addDialog.copied`); the dialog shows the full command, the connect-only
  command under
  `…addDialog.cliInstalled` and **Waiting for the device to connect…**
  (`…addDialog.waiting`); the CLI installs, connects and starts the device, and
  within a few minutes (the first start downloads the images) the dialog reads
  **{name} is connected.** (`…addDialog.connected`). After **Done**
  (`common.actions.done`) and a reload, the row shows **Online**
  (`sandboxes.devices.status.online`), `0 / N` sandboxes, the machine's CPUs
  and memory, the server's release and **Now** (`sandboxes.devices.lastSeenNow`)
  under **Last seen**; on the machine, `tale sandbox status` names the
  organization and reports both containers running.
- [ ] `SET-F57` · **Workspaces start on the device** — With SET-F56's device
  online, start a task for a project agent that has no workspace yet →
  **Workspaces** shows its row with **On {name}** (`sandboxes.runsOn.device`)
  and the device row counts `1 / N`; the agent reads and writes files, calls
  its tools and gets model answers exactly as on the server; `docker ps` on the
  machine lists the session container; a website crawl in the same
  organization still renders **On the server** (`sandboxes.runsOn.server`).
- [ ] `SET-F58` · **A device goes offline and comes back** — Stop the device
  on the machine (`docker stop tale-device-sandbox`) → Within a minute its row
  reads **Offline** (`sandboxes.devices.status.offline`) with a relative
  **Last seen**, SET-F57's workspace reads **On {name} (offline)**
  (`sandboxes.runsOn.deviceOffline`), a new task for that agent fails with a
  message that the device is not connected, and a task for a DIFFERENT agent
  without a workspace starts **On the server**. Start it again
  (`docker start tale-device-sandbox`) → The row is **Online** within a minute
  and the first agent's next task reuses its workspace on the device.
- [ ] `SET-F59` · **Remove a device** — Row menu → **Remove**
  (`sandboxes.devices.actions.remove`) → **Remove {name}?**
  (`sandboxes.devices.removeConfirm.title`) → **Remove device**
  (`…removeConfirm.confirm`) → The toast **Device removed**
  (`sandboxes.devices.toast.removed`) appears, the row is gone after a reload
  and the audit log lists the removal; on the machine, `tale sandbox status`
  reports the device was removed from its organization, and
  `tale sandbox disconnect --force` removes the `tale-device-*` containers and
  `~/.tale/sandbox`. The removed device's agent starts with a fresh workspace
  on its next task.
- [ ] `SET-F60` · **Devices raise the limits ceiling** — With a device online
  that runs N sandboxes, read **Total organization sessions**
  (`sandboxes.limits.total`) → It reads `{total} / {capacity + N}` and its hint
  names the device slots (`sandboxes.limits.totalHintWithDevices`); raise a
  limit so the total lands between the deployment capacity and capacity + N →
  **Save** succeeds and the value survives a reload; above capacity + N the
  total explains `sandboxes.limits.totalExceedsCapacity` and Save stays
  disabled.
- [ ] `SET-F62` · **A pinned workspace comes back** — As owner on
  `/dashboard/{org}/settings/sandboxes`, while a project agent's task runs,
  pin its workspace (row menu → **Pin**, `sandboxes.actions.pin`; toast
  **Sandbox pinned**, `sandboxes.toast.pinned`) and let the task leave a file
  in it; once the task finished, remove the container on the sandbox host
  (`docker rm -f tale-sbx-ses-<sessionId>`) and reload the page (its mount
  probe runs the sandbox sweep's reconcile, which also runs unattended every
  five minutes, and queues the recreate for the worker; the page answers
  without waiting for it); wait for the queued recreate to finish → `docker ps` lists
  `tale-sbx-ses-<sessionId>` again; the row still lists with its **Pinned**
  badge (`sandboxes.status.pinned`) and **Running**
  (`sandboxes.status.runtime.running`), never disappearing as destroyed; the
  agent's next task finds its file where it left it; and on a stack with a
  short `SANDBOX_SESSION_MAX_IDLE_MS` the container outlives that idle window,
  so the pin holds on the spawner too.
- [ ] `SET-F63` · **Settings lists page and create alike** — With more than
  20 members (the console loop under "More than 20 members" in
  [setup.md](../setup.md) adds them; SET-F15 by hand), open
  `/dashboard/{org}/settings/members`,
  `/dashboard/{org}/settings/teams` and `/dashboard/{org}/settings/api/rest`
  (first with no API keys of your own, then with one), at 1280 px and at
  390 px, in the light and in the dark theme → Members shows 20 rows over the
  footer **Showing 20 of {n} members** (`common.pagination.showingFiltered`)
  and the rest arrive as you scroll to its end. **Add member**
  (`settings.organization.addMember`), **Create team**
  (`settings.teams.createTeam`) and **Create API key**
  (`settings.apiKeys.createKey`) are the same button: at the right end of the
  table's toolbar at 1280 px (beside the search box where the list has one),
  on a full-width row of its own at 390 px. With no keys the API page shows
  exactly one **Create API key**, inside the empty state
  (`emptyStates.apiKeys.title`), and it moves to the toolbar once a key
  exists. On a cold visit, delay the initial API-key list: the page paints a
  skeleton with no Create button; an empty response then shows the button
  only inside the empty state. Fail that initial read: the page shows an error
  with **Try again** (`common.errors.tryAgain`); allow the request and retry
  to reach the empty state. The button never first appears above the skeleton.
  **API docs**
  (`settings.apiDocs.openDocs`) sits under the table in both states. No page
  scrolls sideways at 390 px, and every button label is readable in both
  themes.
- [ ] `SET-F64` · **Models tab while the model endpoints are off** — As an
  owner, with **Model endpoints for API keys** off (governance.md GOV-F40),
  open `/dashboard/{org}/settings/api/models` → The API pages read **REST**,
  **Models** (`navigation.apiModels`), **MCP**, **Connected agents**
  (`navigation.connectedAgents`) and **WebDAV** in that order,
  in the settings rail's API row and, at narrow widths, in the tab strip; the
  page shows **Model endpoints are not enabled for your organization**
  (`settings.modelEndpoints.disabled.title`) with
  `settings.modelEndpoints.disabled.description` and an **Open model access**
  button (`settings.modelEndpoints.disabled.openPolicy`) that lands on
  `/dashboard/{org}/settings/governance/content-models`; a developer sees the
  same state without the button; no base URL, slug or setup renders.
- [ ] `SET-F65` · **Models tab once the model endpoints are on** — With
  GOV-F41's switch on, reload `/dashboard/{org}/settings/api/models` as an
  owner → The page (`settings.modelEndpoints.title`) shows its description and
  `settings.modelEndpoints.governanceNote`; **OpenAI-compatible base URL**
  (`settings.modelEndpoints.openaiUrl.label`) reads `<site>/api/v1/openai` and
  **Anthropic-compatible base URL**
  (`settings.modelEndpoints.anthropicUrl.label`) `<site>/api/v1/anthropic`,
  where `<site>` is the deployment's `SITE_URL` rather than the browser's
  address; **Organization slug** (`settings.modelEndpoints.orgSlug.label`)
  reads this org's slug; **Models you can call**
  (`settings.modelEndpoints.models.label`) lists exactly the ids
  `GET /api/v1/openai/models` answers for you, each with its own copy button
  (`settings.modelEndpoints.models.copy`); the **API key** row
  (`settings.modelEndpoints.apiKey.label`) links to the REST page; the
  **opencode**, **Claude Code** and **OpenAI SDK (Python)** setups
  (`settings.modelEndpoints.opencode.title`,
  `settings.modelEndpoints.claudeCode.title`,
  `settings.modelEndpoints.openaiSdk.title`) carry those URLs, the slug and the
  first listed model, and each copy button puts exactly the shown text on the
  clipboard. With no model available the list reads
  `settings.modelEndpoints.models.empty`.
- [ ] `SET-F66` · **The OpenAI SDK against Tale** — Mode B. Run the **OpenAI
  SDK (Python)** setup from SET-F65 with a SET-F32 key (`pip install openai`)
  → It prints a whole answer whose `model` field is the id you sent; with
  `stream=True` the text arrives in pieces, and a `curl -N` of the same
  streamed request ends with `data: [DONE]` and carries no usage chunk unless
  the body sets `"stream_options": {"include_usage": true}`, when the last
  chunk carries `usage`; a request offering one `function` tool that the
  prompt makes the model call comes back with `tool_calls` and
  `finish_reason` `tool_calls`, and sending the tool result back yields the
  final answer; an `image_url` part with a `data:` URL sent to a vision model
  is answered.
- [ ] `SET-F67` · **Claude Code and the Anthropic SDK against Tale** — Mode B.
  Export the **Claude Code** variables SET-F65 copies (the key as
  `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY` unset) and run `claude` in a
  scratch folder → Claude Code answers on the model you named; a prompt that
  makes it read and edit a file with its own tools completes, the calls
  travelling as `tool_use` and back as tool results; asking it to search the
  web fails with `MODEL_API_VENDOR_TOOL_UNSUPPORTED` while the session keeps
  working. The Anthropic Python SDK with `auth_token`, the organization header
  and `ANTHROPIC_API_KEY` unset prints a message, and with `stream=True` its
  events end in `message_stop`.
- [ ] `SET-F68` · **opencode against Tale** — Mode B. Put the **opencode**
  setup SET-F65 copies into `opencode.json`, export `TALE_API_KEY` and start
  opencode → The **Tale** provider and its model are offered, and a prompt is
  answered by that model; with the MCP block of
  `/dashboard/{org}/settings/api/mcp` in the same file, a `tale_get_knowledge`
  call works in the same session.
- [ ] `SET-F69` · **An unused workspace shows when it goes** —
  `/dashboard/{org}/settings/sandboxes` as an owner, with a project agent
  whose last task has finished (its row **Stopped**, **Quota released**) →
  The row's **Status** cell adds **Deleted on {date} unless used again**
  (`sandboxes.status.deletesOn`), 30 days after that task — or later, a full
  30 days after **Workspace cleanup** was turned on or shortened. **Pin** the
  row → the date goes (a pinned workspace is kept); **Unpin** → it returns.
  A running workspace and a workflow run's row carry no date.
- [ ] `SET-F70` · **Workspace cleanup follows its setting** — Same page as
  an owner → **Workspace cleanup** (`sandboxes.cleanup.title`) shows **Delete
  unused workspaces** (`sandboxes.cleanup.deleteUnused`) on and **Days
  without use** (`sandboxes.cleanup.unusedDays`) at `30` → set `60`, Save →
  the rows' dates move 30 days later; switch **Delete unused workspaces**
  off → **Days without use** is disabled; Save → no row shows a date; reload
  → both settings stand. As a Developer the section is absent.
- [ ] `SET-F71` · **A removed member's workspaces go** — With a Member who
  started a project agent's run on their own task (`TASK-F50`), Sandboxes
  lists a second workspace for that agent (the member's own) → **Members** →
  that member's **Delete** → back on Sandboxes → within a minute the
  member's workspace is gone and the agent's own stays;
  `/dashboard/{org}/settings/governance/logs` lists **Sandbox workspace
  deleted** for it.
- [ ] `SET-F72` · **A deleted organization leaves no sandbox behind** —
  Mode B on a Docker host. In a throwaway organization run a project agent's
  task with Docker-in-Docker on (its build helpers start); note the
  organization id → delete the organization (`SET-F13`) → within a few
  minutes `docker ps -a --filter label=tale.org=<id>` and
  `docker volume ls --filter label=tale.org=<id>` list nothing, no
  `tale-sandbox-*-cache-<id>` volume remains, and the host session root
  holds none of its `ses-pa-…` directories.
- [ ] `SET-F73` · **Destroy answers at once** — As owner on
  `/dashboard/{org}/settings/sandboxes` with a live workspace (env-gated; a
  project agent's after a task that installed dependencies shows it best) →
  row menu → **Destroy** → confirm → The dialog closes within a second with
  the toast **Destroying sandbox** (`sandboxes.toast.destroying`); the row
  reads **Destroying** (`sandboxes.status.destroying`) and its row menu
  holds **Pin** and **Destroy** (**Stop task**, shown while a task runs,
  stays available); another row can be pinned meanwhile; the row
  leaves the list within a few seconds of the spawner finishing, without a
  reload.
- [ ] `SET-F74` · **Subscription scope where a subscription is set up** —
  `/dashboard/{org}/settings/providers` → **Add credential** → Anthropic →
  **Authentication method** **Subscription broker**
  (`settings.providers.authMethod.subscriptionBroker`) → An info notice
  **Tasks and automations only** (`settings.providers.subscriptionScope.title`)
  with its reason (`settings.providers.subscriptionScope.description`) sits
  above the broker fields and is not announced as an alert; with **API key**
  chosen it is gone. In the table a subscription row carries
  `settings.providers.credential.tasksOnly` under its name. In `en`, `de`,
  `de-CH` (which spells *ausser*) and `fr`, both texts wrap without clipping
  at desktop and narrow widths.
- [ ] `SET-F75` · **Paste a Claude OAuth token, then replace it** —
  `/dashboard/{org}/settings/providers` → **Add credential** → Anthropic →
  **Authentication method** **Subscription key**
  (`settings.providers.authMethod.subscriptionKey`) → paste a Claude OAuth
  token and save → the row appears with **Subscription key** and the tasks-only
  note. Open the row menu, choose the replacement action
  (`settings.providers.replace.subscriptionKeyTitle`), paste a second token and
  save → the dialog closes with the saved toast and neither token is shown
  again. Run a task on a Claude Code project agent whose model this credential
  serves → the run starts and its session carries the newest token in
  `CLAUDE_CODE_OAUTH_TOKEN` with `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_API_KEY`
  empty. Chat lists no model that only this credential serves
  ([CHAT-F59](chat.md)).
- [ ] `SET-F80` · **Workers and their tasks in Workspaces** — With an agent
  working two tasks ([tasks](tasks.md) `TASK-F81`), open
  `/dashboard/{org}/settings/sandboxes` as owner → the agent has one row per
  worker, its name over **Worker 1** and **Worker 2**
  (`sandboxes.worker.agent`); **Current tasks** (`sandboxes.columns.task`)
  names each task by its key and title (`WEB-12 Release notes`), cut short
  with the whole name on hover, and selecting it opens
  `/dashboard/{org}/tasks/{taskId}`; no task id prefix shows.
- [ ] `SET-F81` · **The Agent workers limit** — **Organization limits**
  (`sandboxes.limits.title`) → the first field reads **Agent workers**
  (`sandboxes.quota.budgets.project`) with the hint that each task an agent
  works on at the same time runs in a sandbox of its own
  (`sandboxes.quota.budgetHints.project`). With a run waiting for a worker
  ([tasks](tasks.md) `TASK-F82`), a line under the field reads **1 agent run
  is waiting for a free worker.** (`sandboxes.limits.waitingForWorkers`); a
  Developer sees no such line. Raise the limit to 3 and **Save** → the
  waiting run starts on its own within about two minutes, as a third worker,
  and the line goes away.
- [ ] `SET-F82` · **Stop task stops one worker's task** — With an agent on
  two tasks, choose **Stop task** (`sandboxes.actions.stop`) on its
  **Worker 1** row → that task's run is cancelled, while the task on
  **Worker 2** keeps **Working…** (`tasks.agentRun.status.running`) and its
  row stays busy.
- [ ] `SET-F83` · **The Light sandboxes limit** — **Organization limits**
  (`sandboxes.limits.title`) → the fourth field reads **Light sandboxes**
  (`sandboxes.quota.budgets.light`) with the hint that chats run code in a
  small throwaway sandbox (`sandboxes.quota.budgetHints.light`), 2 in a fresh
  organization;
  **Total organization sessions** (`sandboxes.limits.total`) counts it with the
  other three.
- [ ] `SET-F84` · **A chat's light sandbox** — After a chat ran code
  (CHAT-F68), its row reads your name with **Light sandbox**
  (`sandboxes.lightSandbox`) beneath it; the row menu offers **Destroy**
  (`sandboxes.actions.destroy`) but no **Pin**. **Destroy** it → the row goes;
  the chat's next code run starts a fresh sandbox and still succeeds.

- [ ] `SET-F85` · **Connected agents: your own agents** — With two coding
  agents connected as AUTH-F34–AUTH-F36 describe, one that proved its own
  domain and one that registered itself, open `/dashboard/{org}/settings/api/agents`
  from the rail's **API** row, where **Connected agents** sits between **MCP**
  and **WebDAV** → The page (`navigation.connectedAgents`) shows its
  description (`agentConnections.list.description`) and a table named
  **Connected coding agents** (`agentConnections.list.caption`): each agent's
  name over its domain, or over the **Unverified** badge
  (`agentConnections.list.unverified`) for the app that registered itself;
  **Access** shows the level chosen on the consent page — **Read and test**,
  **Edit automations** or **Edit and deploy** — and each extra beside it in a
  warmer tint where it acts live or changes something, a long word wrapping in
  its badge rather than cut short; **Connected** shows the day; **Last used**
  reads **Never** (`agentConnections.list.never`) until the agent calls the MCP
  endpoint and a relative time after a `tools/list` call and a reload; at a
  phone width (below 768 px) those columns are left out, and each agent's cell
  carries the access badges and a line **Last used 3 hours ago**
  (`agentConnections.list.lastUsedAt`) or **Never used**
  (`agentConnections.list.neverUsed`) under its name — and, in the view of
  everyone's agents below 640 px, whose agent it is;
  **Connect a coding agent** (`agentConnections.list.connectAction`) leads to
  the MCP page. As a person who connected nothing the page shows **No coding
  agents connected** with the same button inside it.
- [ ] `SET-F86` · **Disconnecting an agent** — From a row's menu (**Actions
  for {agent}**, `agentConnections.list.actionsLabel`) choose **Disconnect**
  (`agentConnections.list.actions.disconnect`) → The dialog asks **Disconnect
  {agent}?** and says it loses access to this organization at once and can be
  connected again; **Cancel** (or Escape) changes nothing; **Disconnect**
  shows **{agent} disconnected** (`agentConnections.disconnect.success`) and the
  row leaves the list; a `tools/list` call with the agent's token now answers
  401, its refresh token is refused, and Governance › Logs holds **Coding agent
  disconnected** (`settings.logs.audit.actionLabels.agent_connection.revoked`)
  with your name. With the backend stopped, **Disconnect** keeps the dialog
  open and the toast says it could not be disconnected
  (`agentConnections.disconnect.failed`); with the backend back, the same
  button disconnects it.
- [ ] `SET-F87` · **An owner or admin sees everyone's agents** — As the owner,
  with agents of two other people connected, choose **Everyone**
  (`agentConnections.list.everyone`) → **Person** joins the table, each
  name over their address with your own reading **You**
  (`agentConnections.list.you`), and the description reads
  `agentConnections.list.adminDescription`; **Show disconnected**
  (`agentConnections.list.showDisconnected`) adds the ended ones, each saying
  **Disconnected {date} · {reason}** whole, wrapping instead of cutting the
  reason, and none with a menu; **Mine** goes back to yours. Disconnect
  another person's agent → the dialog names whose it is
  (`agentConnections.disconnect.adminBody`), and that person's bell then says
  you disconnected it (`inbox.agentConnectionEndedAdminBody`) and opens
  **Connected agents** from the notice.
- [ ] `SET-F88` · **The list follows changes made elsewhere** — With the page
  open as one person and a second session as the owner, the owner disconnects
  that person's only agent → on the open page, with no reload, the row goes,
  the empty state shows and the bell gains the notice; an agent connected on
  the consent page in another tab appears in the open list on its own.
- [ ] `SET-F89` · **Connect a coding agent from the list** — As an owner with
  the agent sign-in on, open `/dashboard/{org}/settings/api/agents` and select
  **Connect a coding agent** (`agentConnections.list.connectAction`) → the
  dialog **Connect a coding agent** (`codingAgent.dialog.title`) opens over
  the page, on the **Claude Code** tab of **Claude Code**, **Codex** and
  **Other**: step 1 is `claude mcp add --transport http tale` followed by this
  deployment's MCP address, step 2 `claude mcp login tale`, each in its own
  block with a copy button; **Codex** shows the one command `codex mcp add
  tale --url` and the address, which adds Tale and starts the sign-in (a
  second `codex mcp login tale` would only start another); **Other** shows
  the address alone and says to choose browser sign-in. Under the steps a line reads **Waiting
  for your agent to sign in…** (`codingAgent.status.waiting`), under **Then ask
  your agent** a prompt that names `get_docs` and `list_automations`. Copy
  each command and run it in a terminal as AUTH-F34 describes, finishing the
  browser sign-in → without a reload the line reads **Connected: Claude Code**
  (`codingAgent.status.connected`), the prompt's heading becomes **Try this
  first**, and the list behind the dialog gains the row. An agent that was
  connected before counts too: open the dialog again, run `claude mcp logout
  tale` and the login again → the line reads **Connected: Claude Code** and
  the list still shows its one row (allowing an app again changes its
  connection), also while the page sits behind the terminal. **Done** closes the
  dialog and gives focus back to the button. A member whose right lets
  them create a key, with no developer role, sees the same button and dialog
  (SET-B38); a member who holds an agent but may not connect one does not.
- [ ] `SET-F90` · **A gateway's models carry what Tale knows about them** —
  Add a **Custom provider** whose endpoint lists its models by id alone, such
  as **Base URL** `https://api.openai.com/v1` with an OpenAI key and
  **Discover from the endpoint** → On **Governance › Models** the details
  (`chat.modelSelector.viewInfo`) of a GPT model Tale's OpenAI catalog lists,
  under the custom provider, show **Tools** and **Vision** as
  `chat.modelSelector.info.supported` and **Reasoning** as
  `chat.modelSelector.info.reasoningEffort`; in a new chat the model menu
  offers it with **Effort** (`chat.effort.label`), and neither **Text
  Embedding 3 Small** nor **Whisper 1** is offered there. A listed model no
  Tale catalog knows shows **Tools** supported and **Vision** not supported.
- [ ] `SET-F91` · **A custom provider without a model list says what its
  models take** — **Add credential** (`settings.credentials.addCredential`) →
  **Custom provider** (`settings.providers.custom.pickerTitle`) → **Enter
  model IDs** (`settings.providers.custom.modelsManual`) with
  `claude-sonnet-gw, claude-haiku-gw` in **Model allowlist**
  (`settings.providers.dialog.allowlist`) → **Model details**
  (`settings.providers.custom.modelFacts.title`) shows one group per id, in
  that order, each with **Context window**
  (`settings.providers.custom.modelFacts.contextWindow`, placeholder
  `128000`, unit `settings.providers.custom.modelFacts.tokens`) and **Reads
  images** (`settings.providers.custom.modelFacts.readsImages`), reachable by
  Tab in that order; `0` in a window shows
  `settings.providers.custom.modelFacts.contextWindowInvalid` under it and
  holds **Add credential** (`settings.credentials.create`) → `1000000` and
  **Reads images** for the first id, the second left blank → submit →
  the `catalog` of `TALE_CONFIG_DIR/<org>/providers/<slug>.yml` lists the
  first id alone under `models`; **Edit credential** (`settings.credentials.edit`)
  opens on the same values; in a new chat the details
  (`chat.modelSelector.viewInfo`) of the first model show **Context**
  (`chat.modelSelector.info.contextWindow`) 1,000,000 and **Vision**
  `chat.modelSelector.info.supported`, those of the second 128,000 and
  `chat.modelSelector.info.notSupported`.
- [ ] `SET-F92` · **The deployment's sandbox memory stands beside its
  capacity** — With the sandbox service on Docker and `SANDBOX_MAX_SESSIONS`
  times `SANDBOX_AGENT_MEMORY` within its host's memory less the reserve
  (e.g. `SANDBOX_MAX_SESSIONS=2` with `SANDBOX_AGENT_MEMORY=4g` on a 16 GiB
  host), open **Organization limits** (`sandboxes.limits.title`) → under
  **Total organization sessions** (`sandboxes.limits.total`) a muted line
  names the memory one sandbox may use (`sandboxes.limits.sessionMemory`,
  4 GiB); restart the sandbox service with `SANDBOX_MAX_SESSIONS=64` → its
  log carries one `[sandbox] 64 sessions (SANDBOX_MAX_SESSIONS) …` warning
  with the needed, available, host and reserve figures, and after a reload
  the line gives way to a warning banner with the same figures and both
  settings (`sandboxes.limits.sessionMemoryExceedsHost`), which a screen
  reader does not announce as an alert; **Save** still saves a change.
- [ ] `SET-F93` · **A member's rights, from the row menu** — As the owner on
  `/dashboard/{org}/settings/members`, open the row menu (**Open menu**,
  `common.actions.openMenu`) of a Member, then of your own row; as an Admin,
  that of a Member, of your own row and of the owner → A Member's menu reads
  **Edit** (`common.actions.edit`), **Rights**
  (`settings.organization.memberRights.action`), **Transfer ownership**
  (`settings.organization.transferOwnership`, shown to the owner only) and
  **Delete** (`common.actions.delete`); your own row, and the owner's for an
  Admin, offer **Rights** alone. **Rights** opens **Rights of {name}**
  (`settings.organization.memberRights.title`) with
  `settings.organization.memberRights.description`, listing **Call models
  over the API**, **Export notifications**, **Act for another member** and
  **Publish skills to the organization**
  (`governance.competences.capabilities.*`) in that order, each with a badge
  reading **Allowed** or **Not allowed**
  (`settings.organization.memberRights.held` / `…memberRights.notHeld`), its
  reasons in muted lines under it and a switch at its end. Each opening
  reads the rights afresh: DevTools → Network shows a new
  `/api/app/governance/members/…/rights?orgId=…` request every time.
- [ ] `SET-F94` · **What each role carries, and why** — With the model
  endpoints on (governance.md GOV-F41) and **Share skills with the
  organization** at **Every member** (the default), open **Rights** for a
  Member, an Editor, a Developer, an Admin, yourself as the owner and a
  member whose role is **Disabled** (`roles.disabled`, set with **Edit**),
  none holding a grant → Every switch is off. **Call models over the API**
  opens its reasons with the endpoints line
  (`settings.organization.memberRights.reasons.modelApiOn`) and **Publish
  skills to the organization** with the sharing mode
  (`…reasons.skillSharing`, naming **Every member**); the role comes next,
  then the grant. Member and Editor: **Not allowed** for the first three,
  each with `…reasons.roleGrant` naming the role and **Not granted.**
  (`…reasons.noGrant`), and **Allowed** to publish with
  `…reasons.roleAdmits`. Developer: the same, but **Call models over the
  API** is **Allowed** with `…reasons.roleAdmits`. Admin and owner: all four
  **Allowed** with `…reasons.roleAdmits`. Disabled: all four **Not allowed**
  with `…reasons.roleRefuses` and no **Not granted.** line; grant this
  member **Act for another member** from its switch (SET-F95) → the switch
  turns on and the grant's line appears, but the badge stays **Not
  allowed**. Revoke it afterwards.
- [ ] `SET-F95` · **Grant a right from its switch** — In a Member's
  **Rights**, turn on **Act for another member** → **Grant a right or
  qualification** (`governance.competences.grantDialog.title`) opens over it
  with `governance.competences.grantDialog.fixedDescription` naming the
  member and the right, the right's description in a muted line, no
  **Member** or **Right or qualification** picker, **Expires**
  (`governance.competences.grantDialog.expiryLabel`) on **Never** and an
  empty **Evidence** (`governance.competences.grantDialog.evidenceLabel`);
  **Cancel** (`common.actions.cancel`) and Escape each close it with the
  switch still off. Turn it on again, choose **In 30 days**
  (`…expiryOptions.30days`) and note a line of evidence → **Grant**
  (`governance.competences.grantDialog.submit`) → The toast **Grant added**
  (`governance.competences.toasts.granted`) shows, focus is back on
  the switch, now on, the badge reads **Allowed** and **Not granted.** gives
  way to `settings.organization.memberRights.reasons.grantActiveUntil` with
  your name, today and the date 30 days out. On
  `/dashboard/{org}/settings/governance/competences` the grant is **Active**
  with **Until** that date (`governance.competences.statusDetail.until`),
  **by** your name and the evidence; **Logs** lists `competence_granted`.
  Grant **Export notifications** with **Never** the same way → its line
  reads `…reasons.grantActive`.
- [ ] `SET-F96` · **Revoke a right from its switch** — In the same
  **Rights**, turn off **Act for another member** → **Revoke grant?**
  (`governance.competences.revokeDialog.title`) asks first, naming the
  member and the right (`governance.competences.revokeDialog.description`);
  **Cancel** and Escape keep the grant and its switch on. Turn it off again
  → **Revoke** (`governance.competences.revokeDialog.confirm`) → The
  question closes only once the switch reads off, focus is back on it, the
  toast **Grant revoked** (`governance.competences.toasts.revoked`)
  shows, the badge reads **Not allowed** and **Not granted.** is back. The
  register's **Filter** → **Status** → **Revoked** shows the grant revoked
  today, and pointing at the date reads **Revoked by** your name
  (`governance.competences.revokedBy`); **Logs** lists `competence_revoked`.
- [ ] `SET-F97` · **The model endpoints switch answers for every role** —
  Grant a Member **Call models over the API** from its switch, then turn off
  **Model endpoints for API keys**
  (`governance.modelAccess.modelApi.enabled`) on
  `/dashboard/{org}/settings/governance/content-models` → Reopened, the
  **Rights** of that Member, of a Developer and of an Admin read **Not
  allowed** for it, opening with
  `settings.organization.memberRights.reasons.modelApiOff`; their role lines
  stay as they were, and the Member's switch stays on with its grant line.
  Turn on an Editor's switch for it → **Grant a right or qualification**
  warns with `governance.competences.grantDialog.modelApiOff.description`
  and **Open model access** (`…modelApiOff.link`, pointing at
  `content-models`), and **Grant** still grants. Turn the endpoints back on
  → reopened, all four read **Allowed** with `…reasons.modelApiOn`. Revoke
  both grants.
- [ ] `SET-F98` · **Skill sharing decides who publishes** — On
  `/dashboard/{org}/settings/governance/policies-limits` set **Share skills
  with the organization** (`governance.skillSharing.label`) to **Editors and
  above** (`governance.skillSharing.modes.editors`) and save → Reopened,
  **Publish skills to the organization** names that mode in
  `…reasons.skillSharing`; an Editor and a Developer read **Allowed** with
  `…reasons.roleAdmits`, a Member **Not allowed** with `…reasons.roleGrant`
  and **Not granted.** Save **Owners and admins only**
  (`governance.skillSharing.modes.admins`) → the Editor and the Developer
  need a grant too, and an Admin stays **Allowed**; granting the Member from
  its switch makes it **Allowed** with its grant line. Revoke that grant and
  save **Every member** (`governance.skillSharing.modes.everyone`) again.
- [ ] `SET-F99` · **A grant that ran out** — Open a Member's **Rights**, copy
  the member's user id and the `orgId` from its
  `/api/app/governance/members/…/rights?orgId=…` request in DevTools →
  Network, and grant **Act for another member** for one minute from the
  console: `fetch('/api/app/governance/competences?orgId={orgId}', {method:
  'POST', headers: {'content-type': 'application/json'}, body:
  JSON.stringify({userId: '{userId}', competence: 'tale:rest.act-as',
  expiresAt: Date.now() + 60000})})` → A minute later, reopened, it reads
  **Not allowed** with its switch off, `…reasons.roleGrant` and
  `settings.organization.memberRights.reasons.grantExpired` with your name
  and today's date, and no **Not granted.** line; the register lists the
  grant under **Filter** → **Status** → **Expired**. Turn the switch on and
  grant with **Never** → the switch is on with `…reasons.grantActive`; the
  expired grant now reads **Revoked**, and pointing at its date reads
  **Replaced by a new grant after it expired**
  (`governance.competences.revokedBySystem`).
- [ ] `SET-F100` · **A grant whose granter has left** — As a second Admin,
  grant a Member **Export notifications** from its switch; then, as the
  owner, **Delete** that Admin → The Member's **Rights**, reopened, reads
  `…reasons.grantActive` with **Former member** (`common.formerMember`) as
  the granter; the badge stays **Allowed**, and the switch, still on,
  revokes the grant as SET-F96 does.
- [ ] `SET-F101` · **A right through a team** — On
  `/dashboard/{org}/settings/teams` add a Member to a team, then on
  `/dashboard/{org}/settings/governance/competences` grant that team **Act
  for another member** (**Grant to** → **A team**) with **In 30 days** →
  The Member's **Rights** reads **Allowed** for it with its switch off, and
  `settings.organization.memberRights.reasons.teamGrantActiveUntil` names
  the team, your name, today and the date 30 days out; there is no **Not
  granted.** line. Turn the switch on and grant with **Never** → the switch
  is on, `…reasons.grantActive` comes first and the team's line stays below
  it. Remove the Member from the team and reopen **Rights** → only their own
  grant is named; revoke it from the switch → **Not allowed**, with **Not
  granted.**

## Boundary & error tests

- [ ] `SET-B1` · **Legacy API redirects** — Open
  `/dashboard/{org}/settings/api-keys`,
  `/dashboard/{org}/settings/api/runtimes`,
  `/dashboard/{org}/settings/webdav`, and `/dashboard/{org}/settings/api` →
  The first two land on `…/settings/api/rest` (API keys table), the third on
  `…/settings/api/webdav`, the fourth on `…/settings/api/rest` — each renders
  the live page, never a 404.
- [ ] `SET-B2` · **Legacy page redirects** — Open
  `/dashboard/{org}/settings/mcp`, `/dashboard/{org}/settings/mcp-servers`,
  `/dashboard/{org}/settings/people`, `/dashboard/{org}/settings/logs`,
  `/dashboard/{org}/settings/deployment` → The MCP pair lands on
  `…/settings/connectors`; people on `…/settings/members`; logs on
  `…/settings/governance/logs`; deployment on `…/settings/data-residency` —
  each renders the live page.
- [ ] `SET-B3` · **Provider deep-link redirect** — Open
  `/dashboard/{org}/settings/providers/openrouter` → Redirects to the
  providers index with `?provider=openrouter` — the vendor filter
  (`settings.providers.vendorFilterLabel`) arrives pre-applied to that vendor;
  clearing the filter clears the URL param. Repeat with only one other provider
  holding credentials, and after deleting the selected provider's last
  credential → The shared no-results state appears (never the first-provider
  invitation); search and Filter stay enabled, the selected provider stays
  visible in the facet, and clearing it restores the remaining rows. A link
  matching the only provider also keeps its filter clearable. Check EN/DE/FR
  and keyboard access to the facet and clear action.
- [ ] `SET-B4` · **Role gating — member** — Sign in as a **member** role
  account → The rail shows only the Personal section plus **Skills**; direct
  URLs are refused with the full access-denied message —
  `/dashboard/{org}/settings/organization` → `accessDenied.organization`,
  `…/settings/providers` → `accessDenied.providers`,
  `…/settings/enterprise-sso` → `accessDenied.enterpriseSso`,
  `…/settings/sandboxes` → `sandboxes.accessDenied` — never a partial/blank
  render.
- [ ] `SET-B5` · **Role gating — developer** — Sign in as a **developer** role
  account → The rail additionally shows Providers, Connectors, Sandboxes, and
  API (all usable), but none of the `orgSettings` pages (Organization, Teams,
  Members, Branding, Governance, Metrics, Enterprise SSO, Data residency); a
  direct hit on `…/settings/branding` shows `accessDenied.branding`
- [ ] `SET-B6` · **Required-name validation** — Clear the account **Name** and
  Save; clear the **Organization name** and Save; create a team with a blank
  **Team name** → Each is blocked inline —
  `settings.account.profile.nameRequired`,
  `settings.organization.nameRequired`, `settings.teams.teamNameRequired`;
  after a reload the original values are unchanged and no team row was added.
- [ ] `SET-B34` · **Keys of others, seen from a member** — sign in as the
  Member SET-F77 made a key for (no Owner, Admin or Developer role, no
  right used with a key) and open `/dashboard/{org}/settings/api/rest`
  → The page lists that key alone — never a team's, a project's, the
  organization's or another member's key — and offers no **Create API key**
  (`settings.apiKeys.createKey`). As a Developer member, **Create API key**
  shows no **Belongs to** (`settings.apiKeys.form.owner`), only the
  personal-key hint (`settings.apiKeys.form.scopeHint`). `DELETE
  /api/app/api-keys/{id}` of a team's key from either session answers 404
  `API_KEY_NOT_FOUND`, and the key keeps working.
- [ ] `SET-B48` · **Who may block a member's own key** — as an Admin, open an
  Owner's row actions → **Personal API keys** → The Owner's keys are listed
  with no **Block**, under a note that only an Owner can block them
  (`settings.apiKeys.memberKeys.cannotBlock`); `PUT
  /api/app/api-keys/{id}/block` for one of them from the Admin's session
  answers 403 `API_KEY_BLOCK_FORBIDDEN` and nothing is logged. Your own row
  offers no **Personal API keys**, and signed in as a Member or a Developer
  no row does. A key an Admin made for a member (SET-F77), or one that
  belongs to a team, a project or the organization (SET-F78), is not listed,
  and its `PUT …/block` answers 404 `API_KEY_NOT_FOUND`: it is ended, not
  blocked. A holder whose key is blocked can still make a new key of their
  own, which works here.
- [ ] `SET-B7` · **API key edge cases** — Create with a blank **Key name**;
  after SET-F32's revoke, call a REST endpoint with the revoked key (e.g.
  `curl -H "Authorization: Bearer <key>"` against the API) → The blank name is
  blocked inline (`settings.apiKeys.form.nameRequired`), no row appears after
  reload; the revoked key is rejected (401/403) — it no longer authenticates
  the REST or MCP endpoint.
- [ ] `SET-B47` · **Who turns members' personal keys off, and a setting
  that cannot be read** — Signed in as a Member and as a Developer in turn,
  run in the console, with the `orgId` of any `…?orgId=` request in DevTools
  → Network, `fetch('/api/app/governance/policies/personal_keys?orgId={orgId}',
  {method: 'POST', headers: {'content-type': 'application/json'}, body:
  JSON.stringify({config: {enabled: false}})}).then((r) => r.json())` →
  status 403 with `{"error": "FORBIDDEN"}`; the switch on the Owner's REST
  page is still on and the audit log gains no row. Then, on a disposable
  organization that SET-F104's Developer belongs to, with their own key and
  a key an Admin made there for them (SET-F77), copy aside
  `governance/personal-keys.yml` under `TALE_CONFIG_DIR/<org>/`, if there is
  one, and write `enabled: perhaps` as its content → `GET /api/v1/me` with
  the Developer's own key and that organization's slug answers 503
  `PERSONAL_KEYS_POLICY_UNAVAILABLE` with `Retry-After: 30` and no `data`,
  the key made there answers 200, and the own key of someone who is no
  member there still answers 403 `ORG_FORBIDDEN`, never the 503. The
  Developer's REST page opens with **Your own keys are paused here**
  (`settings.apiKeys.personalKeys.unavailableTitle`) and
  `settings.apiKeys.personalKeys.unavailableBody`; an Admin's shows, in
  place of **Members' personal keys**, `governance.policyReadFailed` with
  **Retry** (`governance.policyReadRetry`) and no switch, and the backend
  logs that the personal keys policy cannot be read. Restore the file, or
  delete it if there was none → **Retry** brings the switch back, and the
  own key answers 200 again.
- [ ] `SET-B9` · **WebDAV label bounds** — **Generate a new app-password**
  with an empty/whitespace label; then type past 64 characters → An empty
  label leaves the dialog unsubmittable (Generate does nothing); the input
  caps typing at 64 chars (`maxLength`) — the server guard is unreachable from
  the UI; no app-password is created. (Optional, heavy: creating at the cap →
  `webdav.create.errorLimit`)
- [ ] `SET-B41` · **App-passwords when the list read fails** — With an
  app-password from `SET-F34`, block `*/api/app/webdav/app-passwords?orgId=*`
  in DevTools (Network → request blocking) and reload
  `/dashboard/{org}/settings/api/webdav` → once the read's retries give up (a
  few seconds; a blocked request reads as a lost connection, so the offline
  notice may cover the page meanwhile) the **App-passwords** section
  (`webdav.list.title`) shows the table's error state
  (`common.errors.somethingWentWrong`) with **Try again**
  (`common.errors.tryAgain`) instead of skeleton rows that never end, and
  never `webdav.list.empty`. Unblock, Tab to **Try again** and press Enter →
  the passwords appear without a reload, and the focus is on the
  **App-passwords** section, not lost to the page. Block the list again and
  **Revoke** a password (the pattern leaves the revoke through) → the rows
  stay, each active one with its **Revoke**, and above them
  `webdav.list.refreshFailed` shows with **Try again**
  (`common.actions.tryAgain`). Unblock → **Try again** → the notice leaves,
  the row reads `webdav.list.revoked`, and the focus is on the section. At a
  375 px viewport the error state and the notice wrap inside the page with
  **Try again** fully visible.
- [ ] `SET-B10` · **SSO form guards** — On
  `/dashboard/{org}/settings/enterprise-sso`: **Test connection** with
  required fields empty; enter a malformed issuer (no scheme) → The empty test
  is refused with `settings.enterpriseSso.testMissingFields`; the malformed
  URL shows the inline validation (`settings.enterpriseSso.validation.url`);
  with `SITE_URL` / `BETTER_AUTH_SECRET` unset on the server the warning
  banner renders (`settings.enterpriseSso.deploymentWarning.title`) —
  env-dependent, note rather than force it.

- [ ] `SET-B11` · **REST model discovery** → With a SET-F32 key, call `GET /api/v1/models`; only this organization's configured chat models allowed by the key holder's model policy appear. Without available models the response is `200 {"models":[]}`; use an entry's `id` and `providerSlug` to send a thread message and verify the selected provider answers.
- [ ] `SET-B12` · **Sandbox reader and unavailable state** — `/dashboard/{org}/settings/sandboxes` as a developer → saved limits, the calculated total, allocations and capacity remain readable; **Save**, **Discard**, and the entire **Workspaces** section are absent. In a disconnected sandbox-service test environment, **Refresh** (`sandboxes.capacity.refresh`) shows `sandboxes.capacity.unreachable`, and metrics never substitute zero for a failed observation. As an admin in that environment, workspace runtime state is **Unknown** (`sandboxes.status.runtime.unknown`); a limit cannot be RAISED while the deployment capacity is unavailable (`sandboxes.limits.capacityUnavailable` explains how to retry), while lowering one still saves.
- [ ] `SET-B13` · **Usage page without limits** — Turn Budget rules off and,
  as the member, reload `/dashboard/{org}/settings/usage` (allow the policy
  cache a few seconds) → **Usage limits** (`settings.usage.limits.title`) shows
  **No usage limits apply to you** (`settings.usage.empty.title`) and no
  meters; with the upload policy's per-user volume unset, **Storage** reads
  `settings.usage.storage.unlimited`. Reload once more under DevTools → Slow
  4G → the same **Usage limits** section is there from the first paint with
  its card masked (never the words before the read answers), and the card
  fills in without the heading or the page moving. Restore both policies
  afterwards.
- [ ] `SET-B14` · **Reached cap** — Lower the member's daily request cap to
  their booked requests → The row reads **Limit reached**
  (`settings.usage.reached`) over a full destructive bar; the chat banner
  switches to `chat.budgetLimitReached` and still links **View usage**
  (`chat.budgetViewUsage`).
- [ ] `SET-B15` · **Long team names** — `/dashboard/{org}/settings/teams` with a
  team whose name runs past 60 characters (a synced IdP group name will do) →
  The name truncates with an ellipsis and never pushes the **Synced** badge
  (`settings.teams.syncedBadge`) or the member count out of place; hovering the
  name shows it in full; the name column is wider than the member-count column.
- [ ] `SET-B32` · **Your teams when the read fails** — As a member of a team,
  block `*/api/app/teams/mine*` in DevTools (Network → request blocking) and
  reload `/dashboard/{org}/settings/account#teams` → once the read's retries
  give up (a few seconds; a blocked request reads as a lost connection, so the
  offline notice may cover the page meanwhile) **Your teams**
  (`settings.account.teams.title`) shows `settings.account.teams.loadFailed`
  with **Try again** (`common.actions.tryAgain`), never
  `settings.account.teams.none`. Unblock, Tab to **Try again** and press
  Enter → the team badges appear without a reload, and the focus is on the
  section, not lost to the page.
- [ ] `SET-B33` · **Agent runtimes when the health read fails** — With a
  credential that gives a runtime its models (`SET-F21`), block
  `*/api/app/sandbox/harness-health*` in DevTools (Network → request
  blocking) and reload `/dashboard/{org}/settings/providers` → once the
  read's retries give up (a few seconds; a blocked request reads as a lost
  connection, so the offline notice may cover the page meanwhile) the
  **Agent runtimes** rows (`settings.providers.harnesses.title`) stay, and
  above them `settings.providers.harnesses.healthLoadFailed` shows with
  **Try again** (`common.actions.tryAgain`), never the rows alone as if no
  runtime were failing. Unblock, Tab to **Try again** and press Enter → the
  notice leaves without a reload, a runtime that is failing shows
  `settings.providers.harnesses.degraded` again, and the focus is on the
  runtime list, not lost to the page.
- [ ] `SET-B18` · **A used or expired connect command** — Run SET-F56's
  command again on another machine (or any copied command after an hour) →
  `tale sandbox connect` fails saying the command expired or was already used,
  writes nothing to `~/.tale/sandbox` and starts no container; **Add device**
  again yields a new command that works.
- [ ] `SET-B19` · **Developers see devices, admins manage them** —
  `/dashboard/{org}/settings/sandboxes` as a developer → The **Devices** list
  and its statuses are readable; **Add device** and the row menus are absent.
- [ ] `SET-B20` · **A deployment without the device hub** — On a stack whose
  spawner runs with `SANDBOX_HUB_PORT=0` → The **Devices** section explains
  `sandboxes.devices.hub.notConfigured` and **Add device** is disabled; with
  the spawner stopped entirely the section reads
  `sandboxes.devices.hub.unavailable` and still lists the registered devices.
- [ ] `SET-B22` · **A save refused on Enter says why, once** — Hold the
  session as in AUTH-B12 (block `*/api/auth/get-session*` in this tab's
  DevTools, **Log out** in a second tab); within five minutes, back on
  `/dashboard/{org}/settings/account`, change **Name**
  (`settings.account.profile.name`) and press **Enter** in the field, not
  **Save** → one destructive toast titled **Save** (`common.actions.save`)
  whose line reads `toast.error.profileUpdateFailed.withReason` with
  **Your session has ended. Sign in again.** (`common.errors.sessionEnded`),
  in the page's language — never `{"code":…}`, and no second toast takes its
  place a moment later (the toaster shows one at a time, so watch for the
  swap); the new name stays in the field.

- [ ] `SET-B16` · **The embedding model's credential cannot be deleted** —
  With Settings › Data residency › **Embedding model** saved on provider P
  and credential C (or **Provider default** with C as P's active default —
  even while P has another active credential), go to
  `/dashboard/{org}/settings/providers` → C's **Actions**
  → **Delete** → the dialog carries the warning
  `settings.providers.credential.deleteEmbeddingWarning` ("The knowledge
  embedding model uses this credential…") above the usual lines; **Delete**
  → toast **Could not delete the credential:** … (`settings.credentials.deleteFailed`
  with `settings.providers.credential.inUseByEmbedding`), C stays in the
  list, Data residency still says **Configured**, a document upload still
  indexes. Make another active credential of P the default (with
  **Provider default** selected) or pick another credential under Data
  residency → **Delete** C → succeeds. A credential of another provider, or
  a non-default sibling, shows no such warning and deletes.
- [ ] `SET-B17` · **…nor disabled** — Same setup as `SET-B16` with
  **Provider default** and C as P's active default → C's **Actions** →
  **Disable** (`settings.credentials.disable`) → toast **Could not update
  the credential:** … (`settings.credentials.updateFailed` with
  `settings.providers.credential.inUseByEmbedding`), C still reads active
  and stays **Default**. A sibling's **Actions** → **Make default**
  (`settings.credentials.makeDefault`) succeeds — the model now resolves
  the sibling — and C then disables and deletes.
- [ ] `SET-B23` · **A key in x-api-key on the Anthropic path** — Call
  `POST /api/v1/anthropic/v1/messages` with the key in `x-api-key` instead of
  `Authorization: Bearer` (or run Claude Code with `ANTHROPIC_API_KEY` set) →
  401 in the Anthropic shape (`type` `authentication_error`, code
  `UNAUTHORIZED`) with `WWW-Authenticate: Bearer`, whose message says to set
  the key as `ANTHROPIC_AUTH_TOKEN` (Claude Code) or `authToken` /
  `auth_token` (Anthropic SDKs) and leave `ANTHROPIC_API_KEY` unset; the same
  header on `POST /api/v1/openai/chat/completions` answers 401 in the OpenAI
  shape without that hint.
- [ ] `SET-B24` · **Revoking the key ends model access** — Mode B. Start a long
  streamed answer with a key (`stream=True` and a prompt asking for a long
  text), then revoke that key under `/dashboard/{org}/settings/api/rest` while
  it streams → The running stream finishes normally; the key's next call
  answers 401 in the interface's shape, and a new key works at once.
- [ ] `SET-B25` · **Requests the model endpoints refuse** — With a listed
  model, send each request below and read the interface's error shape → An
  image to a model without vision (`capabilities.vision: false` in
  `GET /api/v1/models`) answers 400 `MODEL_API_VISION_UNSUPPORTED`; tools to a
  model without tool support 400 `MODEL_API_TOOLS_UNSUPPORTED`;
  `web_search_options` on the OpenAI path, or a `web_search_20250305` tool, an
  `mcp_servers` or a `container` field on the Anthropic path, 400
  `MODEL_API_VENDOR_TOOL_UNSUPPORTED` naming the field; an `input_audio` part
  400 `INVALID_BODY` naming the part; an Anthropic message without
  `max_tokens` 400 `INVALID_BODY`; a body over 32 MiB 413 `BODY_TOO_LARGE`;
  `?beta=true` on the Anthropic path is accepted;
  `POST /api/v1/anthropic/v1/messages/count_tokens` answers 404 in the
  Anthropic shape; the retired `POST /api/v1/chat/completions` answers 404
  `NOT_FOUND` in the flat envelope.
- [ ] `SET-B26` · **A granted member sees REST and Models only** — Sign in as
  governance.md GOV-F43's **Member** while it holds **Call models over the
  API** → The settings rail shows **API** with only **REST** and **Models**;
  the member creates an API key on `/dashboard/{org}/settings/api/rest` and
  reads the setup on `/dashboard/{org}/settings/api/models` (or its
  not-enabled state while the endpoints are off);
  `/dashboard/{org}/settings/api/mcp` and `/dashboard/{org}/settings/api/webdav`
  by URL show **This page is for Owners, Admins and Developers.**
  (`accessDenied.apiTab`). Revoke the grant → **API** keeps **REST** alone
  while the member holds the key, listing it with **Revoke key** but without
  **Create API key**, and `/dashboard/{org}/settings/api/models` names the
  right it takes (`accessDenied.apiModels`); once the key is revoked too
  the API row disappears.
- [ ] `SET-B21` · **A custom provider's edit saves whole or not at all** —
  With a custom provider holding two credentials A and B (`SET-F43`), open
  A's **Edit credential** (`settings.credentials.edit`), change **Base URL**
  (`settings.providers.custom.baseUrl`) and set **Provider name**
  (`settings.providers.custom.nameLabel`) to B's name → **Save** → the dialog
  keeps the form and shows the server's sentence (a credential named B
  already exists), no toast; **Cancel**, reload → A's **Edit credential**
  still shows the old **Base URL** and name. Then open A's **Edit credential**
  in two tabs; in the second change **Base URL** and save; in the first
  change only the name and save → the first dialog stays open and shows
  `settings.providers.custom.errors.versionConflict`; reload the second
  tab → its **Base URL** stands; reopen the first dialog → it shows that
  **Base URL**, and the rename now saves.
- [ ] `SET-B27` · **Only a role or right that uses a key creates one** —
  As a Member holding no right, the settings rail shows no **API** row;
  in DevTools run
  `fetch('/api/auth/api-key/create', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({name: 'probe'})}).then((r) => r.json())`
  → 403 with code `API_KEY_CREATE_FORBIDDEN`, and no key named `probe` exists.
  Have an Admin grant **Export notifications** → after a reload **API** shows
  **REST** alone, without **Models**, and **Create API key** there makes a key.
  Revoke the grant → the key keeps working with the Member's role, and a
  second create is refused again; **REST** stays, listing the key without
  **Create API key**, until the Member revokes it.
- [ ] `SET-B28` · **Workspace cleanup's bounds** — `/dashboard/{org}/settings/sandboxes`
  → **Days without use** (`sandboxes.cleanup.unusedDays`) → `0`, `3651` or
  `2.5` → Save is blocked with **Must be a whole number between 1 and 3650.**
  (`sandboxes.cleanup.invalidDays`); `1` and `3650` save.
- [ ] `SET-B29` · **A Destroy the spawner cannot finish** — Mode B. Stop
  the sandbox service (`docker stop tale-sandbox`) → **Destroy** a
  workspace on `/dashboard/{org}/settings/sandboxes` → The dialog still
  closes at once and the row reads **Destroying** while the job retries;
  start the service again within a few minutes (`docker start
  tale-sandbox`) → the row leaves on its own. Repeat, leaving the service
  stopped for half an hour → the row stays, unpinned, reading **Destroy
  failed** (`sandboxes.status.destroyFailed`), and its menu offers
  **Destroy** again, which finishes once the service is back.
- [ ] `SET-B30` · **Nothing starts in a workspace being destroyed** — Mode
  B. Stop the sandbox service (`docker stop tale-sandbox`) → **Destroy** a
  project agent's **Stopped** workspace → while its row reads
  **Destroying**, start a task with that agent, and mention the agent in a
  chat → each run reads **Waiting for a workspace**
  (`tasks.agentRun.waiting.destroy_pending`), in the task and in the chat's
  task tray, and nothing runs in the workspace; start the service again
  (`docker start tale-sandbox`) → the row leaves, then the runs start on
  their own in fresh workspaces, whose file lists hold nothing the old one
  did.

- [ ] `SET-B31` · **Concurrent device commands stay separate** — Two admins
  open **Add device** (`sandboxes.devices.add`) in the same organization;
  leave A's command unused and connect a machine with B's command → A still
  reads **Waiting for the device to connect…**
  (`sandboxes.devices.addDialog.waiting`), while only B reads **{name} is
  connected.** (`sandboxes.devices.addDialog.connected`). Existing online
  devices and newly enrolled offline devices do not finish either flow.
  Run A's command and wait for its own device to connect → A names only its
  own device. Repeat with two commands from the same admin. If command
  generation fails, **Try again** (`sandboxes.devices.addDialog.retry`)
  remains available inside the dialog.
- [ ] `SET-B35` · **Destroy one worker while another is free** — Mode B.
  With an agent whose **Worker 1** and **Worker 2** are both **Stopped**,
  stop the sandbox service (`docker stop tale-sandbox`) and **Destroy**
  Worker 1 → while its row reads **Destroying**, start the agent on a task →
  its Run row never reads **Waiting for a workspace**
  (`tasks.agentRun.waiting.destroy_pending`): the run is headed for Worker 2,
  which can only start once the service is back. Start the service again →
  the run works in Worker 2 (its task under **Current tasks** on the Worker 2
  row), no fresh workspace opens, and the Worker 1 row leaves. With a
  one-worker agent, `SET-B30` still holds.
- [ ] `SET-B36` · **A worker gives its quota back when its own run ends** —
  With an agent on two tasks, let the task on **Worker 1** finish while
  **Worker 2** still works → within a minute the Worker 1 row reads **Quota
  released** (`sandboxes.status.quotaReleased`) and the **Allocated** count
  of **Agent workers** drops by one, while Worker 2 still reads **Quota
  allocated** (`sandboxes.status.quotaInUse`).
- [ ] `SET-B37` · **A stale branding Save never overwrites another window**
  — On a throwaway organization with a saved accent color, open
  `/dashboard/{org}/settings/branding` in two windows, A and B. In A change
  **Accent color** (`settings.branding.accentColor`) without saving; in B save
  another color, then upload a light favicon. In A → **Save** → One toast says
  the branding changed in another session
  (`toast.error.brandingUpdateFailed.changedElsewhere`); A's color stays in the
  field and **Save** stays enabled; reloading B still shows B's color and
  favicon, and **Audit logs** gains no **Branding updated** row for A. **Discard**
  (`common.actions.discard`) in A loads B's color; changing it again and saving
  goes through. Repeat with B's **Reset** (`common.actions.reset`) confirmed
  while A holds an unsaved color → A's **Save** is refused the same way and the
  reset stays after a reload.
- [ ] `SET-B39` · **A roster draft survives another session's change** — On a
  throwaway organization with a team of one member and two more people, open
  `/dashboard/{org}/settings/teams` in two windows, A and B, and **Edit team**
  (`settings.teams.editTeam`) in both. In A tick a second person under
  **Members** (`settings.teams.manageMembers`) without saving; in B tick a
  third person → **Save changes** (`settings.teams.saveChanges`). Back in A →
  One alert says the membership changed in another session
  (`settings.teams.membershipRefreshConflict`); A's ticked person stays ticked
  and **Save changes** stays disabled. Close A's dialog and open it again → it lists the team as B saved it, no
  alert shows and **Save changes** is disabled until the next edit. Then
  tick a person in A and save → the dialog closes with the toast
  (`settings.teams.teamUpdated`); opening it right after shows the saved roster
  with no alert.

- [ ] `SET-B38` · **Who opens Connected agents** — With the agent sign-in on,
  sign in as a member who holds a right that is used with a key, with no
  developer role (SET-B26's setup) → the rail's **API** row lists **REST** and **Connected agents** and
  no other; the page lists their own agents, with no **Mine** / **Everyone**
  and no **Show disconnected** but with **Connect a coding agent** (it opens
  the same dialog as SET-F89); `…/api/mcp` and
  `…/api/webdav` by URL show **This page is for Owners, Admins and
  Developers.** (`accessDenied.apiTab`). Revoke the right and the API key
  → **API** keeps **Connected agents** alone while they hold a live agent;
  disconnect it → the row disappears and `…/api/agents` by URL shows **Access
  denied** with `accessDenied.apiKeys`. A plain member who never had either
  never sees the row. With the agent sign-in switched off
  (`TALE_MCP_DYNAMIC_CLIENT_REGISTRATION` and `TALE_MCP_CLIENT_METADATA_DOCUMENTS`
  both `false`) the owner's rail has no **Connected agents** while they hold no agent,
  and a person who still holds one keeps the page, without **Connect a coding
  agent**.

- [ ] `SET-B40` · **A base URL that is not the API root says so** — **Add
  credential** → **Custom provider** with **Base URL** `https://openrouter.ai`
  (it answers the model listing with a web page), **Discover from the
  endpoint** and any **API key** → submit → The row reads
  `settings.providers.card.catalogUnavailable` with
  `settings.providers.custom.errors.catalogNotJson`, never page markup or a
  parser message; **Check models** (`settings.providers.custom.check`) toasts
  `settings.providers.custom.checkFailed` with the same sentence at once,
  without a retry pause; **Refresh catalogs**
  (`settings.providers.catalogs.refresh`) reports it with that sentence.
  **Edit credential** → **Base URL** `https://api.openai.com` (without /v1) →
  **Save** → the row and **Check models** show
  `settings.providers.custom.errors.catalogNotFound`; with
  `https://openrouter.ai/api/v1` **Check models** toasts
  `settings.providers.custom.checkOk`.
- [ ] `SET-B46` · **AI providers when its reads fail** — With the language set
  to Deutsch, block `*/api/app/providers/catalogs*` in DevTools (Network →
  request blocking) and reload **AI providers** → once the read's retries give
  up (a few seconds; the offline notice may cover the page meanwhile) the
  section says `settings.providers.catalogs.listFailed` in German with Try
  again (`common.actions.tryAgain`) — no English and no "Failed to fetch";
  **Add credential** shows the same notice where the providers would be, never
  `settings.providers.catalogs.emptyBody`, and **Custom provider** stays
  pinned under it. Unblock and choose Try again in the picker → the providers
  are listed without a reload and the focus is on the search box. Block
  `*/api/app/provider-credentials*` instead and reload → the table shows its
  error state with Try again, never `emptyStates.providers.title`, and no
  second notice above it; Unblock, Try again → the rows return. With the rows
  shown, block it again and add a credential elsewhere (a second tab) → the
  rows stay under `settings.credentials.refreshFailed`. Rename a credential
  to the name of another credential of its provider → the dialog says
  `settings.credentials.errors.nameTaken` in German.

- [ ] `SET-B42` · **A member's rights are for owners and admins** — Sign in
  as a Developer, an Editor and a Member in turn and open
  `/dashboard/{org}/settings/members` → each sees **Access denied**
  (`accessDenied.title`) with `accessDenied.organization`, so no row menu
  offers **Rights**. In each one's console, with the `orgId` of any
  `…?orgId=` request in DevTools → Network and a member's user id copied in
  the owner's session (SET-F99), run
  `fetch('/api/app/governance/members/{userId}/rights?orgId={orgId}').then((r) => r.json())`
  → status 403 with `{"error": "FORBIDDEN"}`. As the owner, the same call
  answers the member's rights, and with the user id of a removed member, or
  a made-up one, status 404 with `{"error": "MEMBER_NOT_FOUND"}`.

- [ ] `SET-B43` · **Rights that cannot be read** — In DevTools block the
  request URL `*/api/app/governance/members/*/rights*` (Network → request
  blocking) and open a member's **Rights** → After the retries, a few
  seconds in which the offline notice may show, the dialog says **Couldn't
  load the rights.** (`settings.organization.memberRights.loadFailed`) with
  **Try again** (`common.actions.tryAgain`) and shows no right and no
  switch. Unblock it → **Try again** → the four rights appear in the same
  dialog and focus moves to their list. Block it again with the rights
  shown and grant a right from its switch → the rights stay, under
  `settings.organization.memberRights.refreshFailed` with **Try again**;
  unblock it and **Try again** → the notice leaves, focus moves to the
  list and the switch reads on.
  At 375 px both notices wrap inside the dialog.

- [ ] `SET-B44` · **A switch behind another session's change** — With a
  Member holding **Export notifications**, open their **Rights** in window
  A and revoke the grant in window B on
  `/dashboard/{org}/settings/governance/competences`. In A turn its switch
  off → **Revoke** → The toast **Couldn't revoke the grant**
  (`governance.competences.toasts.revokeFailed`) says
  `governance.competences.errors.alreadyRevoked`, the question closes and
  the switch reads off. Grant it again in B while A still shows it off; in
  A turn it on → **Grant** → the dialog stays open with
  `governance.competences.errors.alreadyGranted` and grants nothing; close
  it and reopen **Rights** → the switch is on with B's grant.

- [ ] `SET-B45` · **Policies that cannot be read** — On a disposable
  organization with the model endpoints on, copy aside
  `governance/model-access.yml` under `TALE_CONFIG_DIR/<org>/` and replace
  its content with `modelApi: perhaps` → Reopened, **Call models over the
  API** reads **Not allowed** for every member, an Admin too, with
  `settings.organization.memberRights.reasons.modelApiUnreadable`, and the
  backend logs that the model access policy cannot be read. Put the copy
  back → `…reasons.modelApiOn` again. Write `orgWide: sometimes` as the
  content of `governance/skill-sharing.yml` there → **Publish skills to the
  organization** reads `…reasons.skillSharing` naming **Owners and admins
  only**, an Editor and a Member read **Not allowed** with
  `…reasons.roleGrant` and **Not granted.**, and an Admin stays
  **Allowed**. Restore the file, or delete it if there was none → **Every
  member** again.

## Accessibility (WCAG 2.1 AA)

- [ ] `SET-A1` · **Settings rail** → The rail is a labelled `nav`
  (`navigation.userSettings`); the active row is visually marked; the
  Governance/Metrics/API disclosure rows are buttons exposing `aria-expanded`
  and toggle via keyboard with visible focus.
- [ ] `SET-A2` · **Save cluster** → The header **Save** / **Discard** controls
  are keyboard reachable and operable; the Saved state is conveyed as text,
  not color alone.
- [ ] `SET-A3` · **Toggle rows** → Every preference/notification toggle is a
  labelled switch (accessible name matches its visible label); the locked
  review-requests toggle conveys its disabled state to assistive tech.
- [ ] `SET-A4` · **Secret reveal & copy** → The one-time reveal/copy controls
  have accessible names — API key (`settings.apiKeys.keyCopied` flow), WebDAV
  app-password (`webdav.create.copy`), SCIM token, org ID
  (`settings.organization.copyOrganizationId`)
- [ ] `SET-A5` · **Color picker & menus** → The branding color controls are
  keyboard-operable, not pointer-only (`settings.branding.pickColorAria`,
  `settings.branding.hexValueAria`); credential row-action menus are labelled
  per row (`settings.credentials.actionsLabel`)
- [ ] `SET-A6` · **Sandbox total feedback** — `/dashboard/{org}/settings/sandboxes` → edit a workload limit by keyboard until **Total organization sessions** (`sandboxes.limits.total`) exceeds the deployment capacity → a screen reader announces the updated total and explains `sandboxes.limits.totalExceedsDeployment` when a workload field receives focus. The total, validation text and capacity-card hints remain readable without clipping or horizontal scrolling in `en`, `de` and `fr`; return to valid values and use **Discard** to leave saved limits unchanged.

- [ ] `SET-A7` · **WebDAV status labels** — on `/dashboard/{org}/settings/api/webdav`, generate an app-password with a descriptive multiword device label, then revoke it → at desktop and narrow widths in `en`, `de` and `fr`, the full revoked status (`webdav.list.revoked`) remains readable beside or below the device label; active rows keep a labelled Revoke control and revoked rows have none.

- [ ] `SET-A8` · **Usage meters** — On `/dashboard/{org}/settings/usage`, Tab
  through the rail and the page → **Usage** and (as owner) **Manage limits**
  take visible focus; each meter is a `progressbar` named by its row
  (`settings.usage.meterLabel`, e.g. "Monthly cost: $12.40 of $50.00"); at
  desktop and narrow widths in `en`, `de` and `fr` the labels, reset lines and
  amounts stay readable without clipping or horizontal scrolling.
- [ ] `SET-A9` · **Add device by keyboard** — On
  `/dashboard/{org}/settings/sandboxes`, Tab to **Add device** and press Enter
  → Focus moves into the dialog and stays there; **Copy command**
  (`sandboxes.devices.addDialog.copyCommand`) and the connect-only field
  (named by its label, `…addDialog.cliInstalled`) take visible focus, copy on
  Enter and announce **Copied**; the command text wraps without horizontal
  scrolling at narrow widths in `en`, `de` and `fr`; a screen reader announces
  **{name} is connected.** when the device arrives; Escape returns focus to
  **Add device**.
- [ ] `SET-A10` · **Models tab by keyboard** → On
  `/dashboard/{org}/settings/api/models` with the model endpoints on, Tab
  through the page: every copy button takes visible focus and is named for
  what it copies (`settings.modelEndpoints.openaiUrl.copy`,
  `settings.modelEndpoints.anthropicUrl.copy`,
  `settings.modelEndpoints.orgSlug.copy`, `settings.modelEndpoints.models.copy`
  with the model's id, `settings.modelEndpoints.opencode.copy`,
  `settings.modelEndpoints.claudeCode.copy`,
  `settings.modelEndpoints.openaiSdk.copy`), copies on Enter and confirms the
  copy in text, not colour alone; each value is announced with its label; the
  **REST API keys** link (`settings.modelEndpoints.apiKey.link`) is reachable;
  at narrow widths in `en`, `de` and `fr` the setups wrap or scroll inside
  their own block and the page never scrolls sideways; in the not-enabled
  state, **Open model access** is reachable the same way.

- [ ] `SET-A11` · **Connected agents by keyboard and screen reader** — On
  `/dashboard/{org}/settings/api/agents` as the owner, Tab through the page →
  **Mine** and **Everyone** are one group named **Agents to show**
  (`agentConnections.list.viewLabel`) and the arrow keys move between them;
  **Show disconnected**, **Connect a coding agent** and each row's menu take
  visible focus, each menu named for its agent; **Disconnect** opens a dialog
  that holds focus, announces its question and gives focus back on Escape; the
  table has a caption and a header for the menu column
  (`agentConnections.list.columns.actions`); no state is colour alone — the
  access reads in words and **Unverified** and **Disconnected** are text. At
  320, 390, 768, 1024 and 1280 px in `en`, `de` and `fr` the table never
  scrolls sideways: a phone shows each agent with its menu in reach, a
  tablet adds **Access** and **Last used**, a wide screen **Connected**; a
  very long app name ends in an ellipsis with its full name on hover.

- [ ] `SET-A12` · **The connect dialog by keyboard and screen reader** — Open
  **Connect a coding agent** on `/dashboard/{org}/settings/api/agents` →
  focus lands on the selected agent's tab; the tabs form one group named
  **Coding agent** (`codingAgent.clients.label`) and ← and → move between
  them and show that agent's own commands; Tab goes on to the steps, each
  **Copy command** button, **Copy prompt**, **Setup guide** and **Done**, and
  last to **Close**, each with visible focus; copying announces **Copied**
  (`codingAgent.copy.copied`) once, and the status line is read when an agent
  connects, not on every poll; no state is colour alone. At 320, 390, 768 and
  1280 px in `en`, `de` and `fr` the dialog (a bottom sheet on a phone) never
  scrolls sideways and a long command wraps at its spaces; in the dark theme
  the blocks, the line and the prompt keep their contrast.

- [ ] `SET-A13` · **Rights by keyboard and screen reader** — On
  `/dashboard/{org}/settings/members`, Tab to a row's **Open menu**, press
  Enter, arrow to **Rights** and press Enter → Focus moves into **Rights of
  {name}** and stays there; the list is named by the title; Tab reaches each
  switch with visible focus, and a screen reader names it by its right and
  describes it with its badge and reasons. Space opens **Grant a right or
  qualification** or **Revoke grant?**, and **Cancel**, Escape, **Grant**
  and **Revoke** each give focus back to that switch. With the rights
  blocked (SET-B43) the failure is announced as an alert and **Try again**
  is reachable by Tab. Escape closes **Rights** and gives focus back to the
  row's **Open menu**. The badges say **Allowed** and **Not allowed** in
  words, never by colour alone, and keep AA contrast in both themes.

- [ ] `SET-A14` · **Rights at every width, in three languages** — Open
  **Rights** for a member with a long display name who holds a grant with
  an end date, at 320, 390, 768 and 1280 px in `en`, `de` and `fr` → The
  dialog never scrolls sideways; the title, the right names, the badges and
  the reasons wrap rather than clip, each switch stays beside its right and
  within reach, and the row menu shows **Rights** (**Rechte**, **Droits**)
  without clipping; in the dark theme the muted reasons and both badges keep
  their contrast.

## Performance

- [ ] `SET-P1` · **Rail navigation** → < 1 s to switch between two
  already-loaded settings pages (mock stack, local backend)
- [ ] `SET-P2` · **Save → persisted** → < 2 s from clicking **Save** to the
  value being read back after reload (mock stack, local backend)
- [ ] `SET-P3` · **Providers first load** → The Credentials and Harnesses
  sections render (content or empty state) in < 3 s on the mock stack — no
  unbounded spinner.
