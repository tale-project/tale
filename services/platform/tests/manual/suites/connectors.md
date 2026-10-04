# Connectors

> **Prefix** `CONN-` · **Reset** none · **Cost** 40 boxes

Exercise the **connector credentials** page under Settings — one flat table of
every credential the organization holds for a shipped connector (#2889
replaced the old 16-card catalog grid). The catalog now lives inside the
two-step **Add credential** dialog. Depth here covers: the add flow (vendor
picker → per-method form → per-connector config fields), row actions (default,
enable/disable, replace secret, edit, delete), the OAuth consent hand-off and
its return, the imap-smtp mailbox credential with its split SMTP auth and
port→TLS pairing, plus the MCP endpoint page this feature also owns. >
[settings.md](settings.md) only smoke-tests that this page renders; all
connector depth is here. AI providers reuse the same credential machinery on
their own page and are covered by [settings.md](settings.md).

## Scope & routes

| Surface                       | Route                                                    |
| ----------------------------- | -------------------------------------------------------- |
| Connector credentials (table) | `/dashboard/{org}/settings/connectors`                   |
| Deep link narrowed to one     | `/dashboard/{org}/settings/connectors?connector=<slug>`  |
| MCP endpoint (inbound MCP)    | `/dashboard/{org}/settings/api/mcp`                      |
| Legacy MCP deep link          | `/dashboard/{org}/settings/mcp` → `…/connectors`         |
| Legacy MCP-servers deep link  | `/dashboard/{org}/settings/mcp-servers` → `…/connectors` |

Notes verified against
`app/features/settings/connectors/components/connectors-settings.tsx`:

- Settings pages carry no page title of their own — the section heading is the
  rail's name for the page (`navigation.connectors`, "Connectors").
- `?connector=<slug>` no longer opens a dialog. It **seeds the Connector
facet**
  with that one slug, narrowing the table to that connector's credentials. It is
  seeded FROM the URL, not bound to it: the facet is multi-select, so the moment
  the operator touches the facet (or clears filters) the param is removed from
  the URL and the facet takes over.
- The catalog ships 19 connector definitions
  (`configs/platform/system/connectors/`), but the four **platform-auth**
  connectors (conversation, document, sandbox, task) never reach the client —
  the listing drops them, so the add-dialog picker offers **15** vendors:
  confluence, discord, github, glitchtip, gmail, google-drive, imap-smtp, jev
  (**Jev decisions**), outlook, shopify, slack, tavily, teams, twilio, webdav.
- Both legacy MCP routes redirect in **one hop** to `…/settings/connectors`.
  The MCP **endpoint** section (the platform's own inbound MCP surface) renders
  on `/dashboard/{org}/settings/api/mcp`.

## Preconditions

Bring the stack up and sign in per [SETUP.md](../setup.md), **mode A
(deterministic, offline)**. `TALE_MOCK_CONNECTORS_BASE` redirects connector
outbound HTTP to the mock gateway (`:4141`), but note this page never probes a
vendor — see the agent note.

Sign in as an owner/admin — the page requires the `developerSettings` ability
(read), else it renders `AccessDenied` (`accessDenied.connectors`).

> **Agent note**: adding a credential is a **write only** — there is no
> test-connection step anywhere in the flow, so mode A proves storage and UI,
> never connectivity. Success is the toast
> (`settings.credentials.createdToast`) plus a new table row. Stored secrets
> are never read back: every secret field starts blank, including in Replace
> secret. The first credential of an (org, connector) pair becomes its
> **default** automatically.  **CONN-F15/CONN-F16, CONN-F19/CONN-F20 and
> CONN-B7/CONN-B9/CONN-B10 need a consent round trip**: mode B plus a
> registered OAuth app (`CONNECTOR_OAUTH_<SLUG>_CLIENT_ID` / `…_CLIENT_SECRET`
> env vars, or the organization's **OAuth apps** card), or a loopback fake
> vendor (below). Consent is a full-page navigation. In mode A without one,
> assert the hand-off instead: **Connect** leaves for
> `…/http_api/api/connectors/oauth2/start?connector=…&organizationId=…` with
> no `credentialId`, a row's **Reconnect** for the same URL plus
> `&credentialId=<that row's id>`. On success the callback lands back on
> `…/settings/connectors?connected=<slug>` — the page does **not** read that
> param (no toast); the rows are the proof. Tell accounts apart by the row's
> masked preview in `GET /api/app/connector-credentials?orgId=…`
> (`maskedPreview`, `updatedAt`).
>
> **A loopback fake vendor** replaces the real one without touching the
> product: copy `configs/platform/system` outside the clone, point only the
> connector's `authorizeUrl`/`tokenUrl` at an `https://127.0.0.1:<port>/…`
> fake that redirects back with a code and answers standard token JSON (a
> throwaway CA trusted through `NODE_EXTRA_CA_CERTS`; the token exchange
> refuses plain `http`), and start the stack with `TALE_CONFIG_SYSTEM_DIR` on
> the copy. Keep every other egress on a dead proxy so no real vendor is
> reachable. A fake that can hold on a consent page is what CONN-B7 and
> CONN-B9 need.

## Functional tests

- [ ] `CONN-F1` · **Table renders** — `/dashboard/{org}/settings/connectors` →
  One section titled **Connectors** (`navigation.connectors`) with its
  description (`settings.connectors.sectionDescription`) and a table: columns
  **Name** / **Connector** / **Authentication**
  (`settings.credentials.columns.*`), an **Add credential** button
  (`settings.credentials.addCredential`), a search field
  (`settings.credentials.searchPlaceholder`). No console error.
- [ ] `CONN-F2` · **Empty state** — Fresh org holding no connector credentials
  → The empty state shows **No connectors connected yet**
  (`emptyStates.connectors.title`) + description, with **Add credential** as
  the way in — never a bare empty grid.
- [ ] `CONN-F3` · **Catalog picker (step 1)** — **Add credential** → A dialog
  titled **Add credential** (`settings.credentials.catalog.title`) with its
  own search (`settings.connectors.searchPlaceholder`). 15 vendors in one list
  (each row: icon, name, tags + action count meta
  `settings.connectors.card.actionCount`); configured vendors carry a
  **Configured** badge (`settings.credentials.catalog.configured`). The
  platform connectors (conversation, document, sandbox, task) are absent.
- [ ] `CONN-F4` · **Add a token credential** — Picker → **GitHub** → step 2 →
  Step 2 titled `settings.credentials.addTitle` with description naming GitHub
  (`settings.credentials.addDescription`), a back control
  (`common.actions.back`), **Name** (+ help `settings.credentials.nameHelp`)
  already filled with **GitHub**, and a masked **Token** field
  (`settings.connectors.dialog.token`). Fill the token → **Add credential**
  (`settings.credentials.create`) → toast `settings.credentials.createdToast`;
  the row appears named **GitHub** with method **Token** and — as the
  connector's first credential — the **Default** badge
  (`settings.credentials.default`). The typed secret appears nowhere
  afterwards.
- [ ] `CONN-F5` · **Configured leads the picker** — With the GitHub credential
  from CONN-F4, reopen **Add credential** → GitHub leads the list with a
  **Configured** badge (`settings.credentials.catalog.configured`); the rest
  follow alphabetically — not one flat A–Z list with no prioritization.
- [ ] `CONN-F5a` · **A second credential is numbered** — From CONN-F5's picker
  → **GitHub** → **Name** arrives as **GitHub 2**, numbered past the
  **GitHub** row rather than repeating it; Escape closes the untouched step
  with no discard prompt.
- [ ] `CONN-F6` · **Per-credential instance URL** — Picker → **Confluence** →
  name + username + password → An extra required **Instance URL** field
  (`settings.connectors.dialog.endpointUrl`) with Atlassian help copy
  (`settings.connectors.dialog.endpointHelpConfluence`) and placeholder
  `https://your-site.atlassian.net`. Submit stays disabled until it is filled.
  Shopify behaves the same with its store origin
  (`settings.connectors.dialog.endpointHelpShopify`), and GlitchTip with its
  instance origin (`settings.connectors.dialog.endpointHelpGlitchtip`,
  placeholder `https://app.glitchtip.com`) beside a masked **Token**.
- [ ] `CONN-F7` · **Mailbox connector config** — Picker → **IMAP / SMTP
  Mailbox** → Beyond username/password, the connector's declared config fields
  render: **IMAP server** (required), **IMAP port** (placeholder `993`),
  **SMTP server** (required), **SMTP port** (placeholder `465`), **Connection
  security** select (`tls` / `starttls`), **Sent folder** (placeholder
  `Sent`). Submit is gated on the two required hosts; ports/security/folder
  may stay blank (server applies the declared defaults).
- [ ] `CONN-F8` · **Split SMTP auth (imap-smtp)** — In CONN-F7's form: toggle
  **Use a separate SMTP provider**
  (`settings.connectors.dialog.smtpSeparateToggle`) → The toggle (hint
  `settings.connectors.dialog.smtpSeparateHint`) reveals **SMTP username** +
  **SMTP password** (`settings.connectors.dialog.smtpUsername` /
  `smtpPassword`, hint `settings.connectors.dialog.smtpHint`); submit stays
  disabled until BOTH are filled. Toggling it off clears them and submit
  re-enables on the mailbox pair alone.
- [ ] `CONN-F9` · **Deep link narrows the table** — With credentials for two
  connectors, open `…/settings/connectors?connector=github` directly → Only
  the GitHub rows show — the param seeded the **Connector** facet
  (`settings.connectors.vendorFilterLabel`). Changing or clearing the facet
  removes `?connector=` from the URL and the facet's own selection takes over.
  Repeat with only GitHub credentials and `?connector=slack`, and after
  deleting the selected connector's last credential → The shared no-results
  state appears (never the first-connector invitation); search and Filter stay
  enabled, the selected connector stays visible in the facet, and clearing it
  removes the param and restores GitHub rows. A matching single-connector link
  also keeps its filter clearable. Check EN/DE/FR and keyboard access to the
  facet and clear action.
- [ ] `CONN-F10` · **Row actions** — Row 3-dot menu
  (`settings.credentials.actionsLabel`) → Offers **Make default** /
  **Disable** / **Replace …** / **Edit credential** / **Delete**
  (`settings.credentials.makeDefault` / `disable` / `edit` / `delete`). Make
  default moves the **Default** badge to this row. Disable adds the
  **Disabled** badge (`settings.connectors.credential.disabled`) and the menu
  now offers **Enable** (`settings.credentials.enable`); on a disabled row,
  **Make default** is visible but inert.
- [ ] `CONN-F11` · **Edit persists** — Row menu → **Edit credential** →
  rename; for Confluence also change the Instance URL; for imap-smtp change a
  config field → save → **reload** → Dialog `settings.credentials.editTitle`
  holds name, endpoint (vendor-decided), and the connector's config fields
  pre-filled from the stored row — never the secret. Toast
  `settings.credentials.savedToast`; after reload the new values read back.
- [ ] `CONN-F12` · **Replace secret** — Row menu → **Replace API key** /
  **Replace token** / **Replace username & password**
  (`settings.connectors.replace.apiKeyTitle` / `tokenTitle` / `basicTitle`) →
  The dialog shows the write-only note (`settings.connectors.replace.note`);
  every field starts **blank** — no current value is ever shown. Submitting
  toasts `settings.credentials.savedToast`. An OAuth row offers **no** replace
  action at all.
- [ ] `CONN-F13` · **Delete with confirm** — Row menu → **Delete** → A confirm
  dialog (`settings.credentials.deleteTitle`, body naming the credential
  `settings.credentials.deleteBody`); deleting the default additionally says
  what happens to the default (CONN-F22). Confirm → toast
  `settings.credentials.deletedToast`; the row is gone after reload.
- [ ] `CONN-F14` · **No-default warning** — Leave a connector holding only
  non-default credentials that are not disabled (disable its default) → A
  warning alert above the table names the vendor(s):
  `settings.credentials.noDefault`. Surfaced, never auto-fixed; it clears once
  a default is picked.
- [ ] `CONN-F15` · **OAuth consent (mode B)** — Picker → **Slack** →
  **Connect** (`settings.connectors.card.connect`) → Step 2 shows a consent
  explainer (`settings.connectors.card.emptyBodyOauth`) instead of a form —
  there is no secret field and no submit footer. **Connect** is a full-page
  navigation to
  `…/http_api/api/connectors/oauth2/start?connector=slack&organizationId=…`;
  after consent the browser lands on `…/settings/connectors?connected=slack`
  and a new row exists: method **OAuth**, named after the connector, default
  if first. No toast — the row is the assertion. Connecting a second
  workspace adds a row named after it (**Slack (‹workspace›)**); consenting
  again for a workspace already connected renews its row instead of adding
  one. In **mode A** (no Slack app
  registered) Step 2 instead explains that the app is set up by the
  deployment operator (`settings.connectors.card.oauthAppMissingDeployment`)
  — it must never point at the OAuth apps card below, which carries no Slack
  row; Gmail/Outlook in the same state keep pointing an admin at that card
  (`settings.connectors.card.oauthAppMissingAdmin`).
- [ ] `CONN-F16` · **Reconnect a stale grant** — On an OAuth row badged
  **Reconnect needed** (`settings.connectors.credential.needsReauth`) → row
  menu → **Reconnect** (`settings.connectors.credential.reconnect`) → The
  row's detail line explains re-consent
  (`settings.connectors.credential.needsReauthHint`, or `…needsReauthDetail`
  when the server recorded a reason). **Reconnect** leads the menu; its
  hand-off names this row (`&credentialId=`), and the refreshed grant clears
  THIS row's badge — same name, same **Default** state, no row added and no
  other row changed.
- [ ] `CONN-F17` · **MCP endpoint page** — `/dashboard/{org}/settings/api/mcp`
  → Section **MCP endpoint** (`settings.mcpEndpoint.title`) with a copyable
  endpoint URL ending `/api/v1/mcp` (`settings.mcpEndpoint.copyEndpoint`),
  auth help linking to **REST API keys** (`settings.mcpEndpoint.authLink`),
  the tool inventory in three groups
  (`settings.mcpEndpoint.tools.authoring.title` / `…tools.management.title` /
  `…tools.capability.title`), and a copyable example curl
  (`settings.mcpEndpoint.exampleTitle`, `settings.mcpEndpoint.copyExample`).
- [ ] `CONN-F18` · **Legacy MCP redirects** — Open
  `/dashboard/{org}/settings/mcp`, then
  `/dashboard/{org}/settings/mcp-servers` → Each redirects in one hop to
  `…/settings/connectors` (URL settles there; the table renders).
- [ ] `CONN-F19` · **A second OAuth account** — With **Gmail** connected
  once (its row holds mailbox A), **Add credential** → **Gmail** →
  **Connect** and consent as mailbox B → A second row **Gmail 2** appears,
  not default; the **Gmail** row keeps mailbox A (its `maskedPreview` and
  `updatedAt` unchanged). The first account is never replaced. Same for
  Outlook, Google Drive and Teams.
- [ ] `CONN-F20` · **Reconnect a non-default row** — With two Gmail rows,
  mark the non-default one stale (see CONN-F16) → its menu → **Reconnect**
  → consent → That row renews (badge cleared, name and non-default state
  kept); the default row is byte-for-byte unchanged. A Reconnect on a
  **Disabled** row renews its grant but leaves it **Disabled** — **Enable**
  is what returns it.
- [ ] `CONN-F21` · **Another session's writes reach an open page** — Two
  signed-in admins, **A** with `/dashboard/{org}/settings/connectors` open.
  **B**, in their own browser, adds a credential, renames one, disables one
  and deletes one → A's table follows each within a few seconds, with no
  reload, focus change or navigation: the new row appears, the renamed and
  disabled rows show B's name and **Disabled** badge, the deleted row is
  gone. An **Edit credential** dialog A holds open on another row stays open
  through B's writes with what A typed; opening **Edit credential** after
  B's rename shows B's name.
- [ ] `CONN-F22` · **Deleting the default hands it on** — GitHub holding
  **Support bot** (default), **Release bot** and a disabled **Paused bot**, all
  created in that order → **Support bot**'s menu → **Delete** → the confirm
  names **Release bot** as the new default
  (`settings.connectors.credential.deleteDefaultHandsOn`); confirm → after a
  reload **Release bot** carries **Default** and no no-default alert shows.
  With only the disabled **Paused bot** left beside the default, the confirm
  says no active credential can take over
  (`settings.connectors.credential.deleteDefaultLeavesNone`), and after the
  delete **Paused bot** stays **Disabled** and not the default. Deleting a
  credential that is not the default says nothing about the default.

## Boundary & error tests

- [ ] `CONN-B1` · **Submit gating + dirty guard** — Step 2: keep the suggested
  name and fill nothing else, then clear the name; type into a field and try
  to close the dialog → **Add credential** stays disabled until the name, the
  method's secret fields and every required config field are supplied
  (whitespace does not count). Closing the untouched step asks nothing;
  closing with typed material — an edited name included — prompts
  `common.discardChangesConfirm` before discarding.
- [ ] `CONN-B2` · **Non-numeric port** — imap-smtp form: type `abc` into
  **IMAP port**, complete the rest, submit → The server refuses and the dialog
  shows its structured message inline (`"IMAP port" must be a number.`) — the
  client keeps number fields as strings and never silently coerces a
  half-typed value.
- [ ] `CONN-B3` · **Endpoint shape refused** — Confluence: enter a non-https
  or path-carrying Instance URL and submit → The create is refused with the
  server's own message shown inline (the endpoint must be an https origin, no
  path); nothing is stored — reloading shows no new row.
- [ ] `CONN-B4` · **Access without permission** — Open the page as a member
  lacking `developerSettings` → **Access denied** (`accessDenied.connectors`)
  — never a partial table. _Mint a non-admin member; see [auth.md](auth.md)
  RBAC._.
- [ ] `CONN-B5` · **Catalog unreadable** — Point the config root at a missing
  directory and reload → The page reports the listing failure with the
  server's message (`settings.connectors.catalog.listFailed`); a failed
  credential list says so too (`settings.credentials.listFailed`). The picker
  distinguishes a vendor-less deployment
  (`settings.connectors.catalog.emptyBody`) from an empty organization.
- [ ] `CONN-B6` · **OAuth callback hardening** — Open
  `…/http_api/api/connectors/oauth2/callback` directly (no/stale `state`) → A
  fixed server-rendered error page — "This connection link has expired" — with
  a way back to connector settings. No vendor text, no request data, and no
  script on the page; nothing was stored.
- [ ] `CONN-B7` · **Reconnect target removed mid-consent** — Start
  **Reconnect** on a row; while the vendor's consent screen is open, delete
  that row from a second tab; then consent → The fixed page "This credential
  cannot be reconnected"; nothing was saved and no other row changed — the
  grant never lands on the default instead.
- [ ] `CONN-B8` · **Tampered reconnect link** — Open
  `…/http_api/api/connectors/oauth2/start?connector=gmail&organizationId=…&credentialId=…`
  with the id of a Slack row, of another organization's credential, an
  unknown id, or `credentialId=` empty → The same fixed page before any
  vendor page; no consent starts. Adding `credentialId=` to a callback URL
  changes nothing: the target rides the server-side state only.
- [ ] `CONN-B9` · **Access lost mid-consent** — A Developer starts
  **Connect**; while the vendor's consent screen is open, an Admin changes
  their role to Member (or removes them); then consent → The fixed page "You
  can no longer connect connectors here"; nothing was saved.
- [ ] `CONN-B10` · **Slack Reconnect in another workspace** — On a Slack row
  → **Reconnect** → consent in a different workspace than the row's → The
  fixed page "That is a different workspace"; nothing was saved. Reconnect
  in the row's own workspace renews it.
- [ ] `CONN-B11` · **Acting on a row another session deleted** — As in
  CONN-F21, but block A's `…/events` request first (DevTools → Network →
  block request URL), so A misses the hint; B deletes a credential A still
  sees → On A, that row's menu → **Disable** answers one toast
  `settings.credentials.updateFailed` naming "Credential not found." and the
  row leaves A's table; on another such row, **Delete** → **Delete** answers
  `settings.credentials.deleteFailed` once and the confirm closes with the
  row. No second click can fail the same way.

## Accessibility (WCAG 2.1 AA)

- [ ] `CONN-A1` · **Add-flow dialog** → The dialog is labelled (**Add
  credential**); its close control has an accessible name
  (`common.aria.close`); step 2's back control is named
  (`common.actions.back`). Picker vendor rows are real buttons and
  keyboard-operable; configured rows expose a **Configured** badge
  (`settings.credentials.catalog.configured`).
- [ ] `CONN-A2` · **Secret fields** → Every secret field — API key, token,
  password, SMTP password — is `type=password` (masked), never plain text, in
  both the add and replace dialogs.
- [ ] `CONN-A3` · **Table & row menu** → The actions column header exists for
  screen readers (visually hidden, `settings.credentials.columns.actions`);
  each row's 3-dot menu is named for its credential
  (`settings.credentials.actionsLabel`) and its items are keyboard reachable.
- [ ] `CONN-A4` · **Row-menu dialogs return focus** → Keyboard only: Tab to a
  row's **Actions for …** button (`settings.credentials.actionsLabel`), Enter,
  arrow to **Edit credential**, **Replace …** or **Delete**, Enter → the
  dialog takes focus; Escape, and once Tab to **Cancel** + Enter → focus is
  back on that row's **Actions for …** button, never on the page body.

## Performance

- [ ] `CONN-P1` · **Table first paint** → Section + table (or empty state)
  render < 2 s on a warm dev stack (mode A).
- [ ] `CONN-P2` · **Add round trip** → **Add credential** submit → toast + new
  row < 3 s (mode A; it is a write, no probe).
