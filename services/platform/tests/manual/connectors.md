# Connectors — Manual Test Plan

> **Purpose**: Exercise the **connector credentials** page under Settings — one
> flat table of every credential the organization holds for a shipped connector
> (#2889 replaced the old 16-card catalog grid). The catalog now lives inside
> the two-step **Add credential** dialog. Depth here covers: the add flow
> (vendor picker → per-method form → per-connector config fields), row actions
> (default, enable/disable, replace secret, edit, delete), the OAuth consent
> hand-off and its return, the imap-smtp mailbox credential with its split SMTP
> auth and port→TLS pairing, plus the MCP endpoint page this feature also owns.
>
> [settings.md](settings.md) only smoke-tests that this page renders; all
> connector depth is here. AI providers reuse the same credential machinery on
> their own page and are covered by [settings.md](settings.md).

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
- `?connector=<slug>` no longer opens a dialog. It **seeds the Connector facet**
  with that one slug, narrowing the table to that connector's credentials. It is
  seeded FROM the URL, not bound to it: the facet is multi-select, so the moment
  the operator touches the facet (or clears filters) the param is removed from
  the URL and the facet takes over.
- The catalog ships 17 connector definitions
  (`configs/platform/system/connectors/`), but the four **platform-auth**
  connectors (conversation, document, sandbox, task) never reach the client —
  the listing drops them, so the add-dialog picker offers **13** vendors:
  confluence, discord, github, gmail, google-drive, imap-smtp, outlook,
  shopify, slack, tavily, teams, twilio, webdav.
- Both legacy MCP routes redirect in **one hop** to `…/settings/connectors`.
  The MCP **endpoint** section (the platform's own inbound MCP surface) renders
  on `/dashboard/{org}/settings/api/mcp`.

## Prerequisites

Bring the stack up and sign in per [SETUP.md](SETUP.md), **mode A
(deterministic, offline)**. `TALE_MOCK_CONNECTORS_BASE` redirects connector
outbound HTTP to the mock gateway (`:4141`), but note this page never probes a
vendor — see the agent note.

Sign in as an owner/admin — the page requires the `developerSettings` ability
(read), else it renders `AccessDenied` (`accessDenied.connectors`).

> **Agent note**: adding a credential is a **write only** — there is no
> test-connection step anywhere in the flow, so mode A proves storage and UI,
> never connectivity. Success is the toast (`settings.credentials.createdToast`)
> plus a new table row. Stored secrets are never read back: every secret field
> starts blank, including in Replace secret. The first credential of an
> (org, connector) pair becomes its **default** automatically.
>
> **F15/F16 need mode B** plus a registered OAuth app
> (`CONNECTOR_OAUTH_<SLUG>_CLIENT_ID` / `…_CLIENT_SECRET` env vars): consent is
> a real full-page navigation to the vendor. In mode A, assert the hand-off
> (the browser leaves for `…/http_api/api/connectors/oauth2/start?connector=…`)
> rather than a completed grant. On success the callback lands back on
> `…/settings/connectors?connected=<slug>` — the page does **not** read that
> param (no toast); the new row is the proof.

## Automated coverage

| Case(s)                             | Status         | Where                                                                                                            |
| ----------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------- |
| F1, F3–F10, F13, F14, B1, B4, B5    | 🔶 component   | `app/features/settings/connectors/components/connectors-settings.test.tsx` (rows, add flow, row actions, denial) |
| F1–F3 (empty state, picker, search) | ✅ automated   | `settings.spec.ts` ("connectors: empty credentials surface and the add-catalog picker")                          |
| F7, B1 (required-config gating)     | 🔶 component   | `app/features/settings/connectors/config-fields.test.tsx`                                                        |
| F17                                 | 🔶 component   | `app/features/settings/connectors/components/mcp-endpoint-section.test.tsx`                                      |
| F11, F12, F18, B2, B3, B6           | ⛔ manual-only | — (persistence reloads, live consent round trip, redirects, server refusals)                                     |
| F15, F16 (full round trip)          | ⛔ manual-only | — (need a real vendor consent, mode B)                                                                           |

Legend: ✅ fully automated · 🔶 partially automated (component/unit, not e2e) ·
⛔ manual-only (no spec).

## Functional tests

| ID  | Test                        | Steps (route + control)                                                                                                                                            | Expected (verifiable)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Table renders               | `/dashboard/{org}/settings/connectors`                                                                                                                             | One section titled **Connectors** (`navigation.connectors`) with its description (`settings.connectors.sectionDescription`) and a table: columns **Name** / **Connector** / **Authentication** (`settings.credentials.columns.*`), an **Add credential** button (`settings.credentials.addCredential`), a search field (`settings.credentials.searchPlaceholder`). No console error.                                                                                                                                                                                                  |
| F2  | Empty state                 | Fresh org holding no connector credentials                                                                                                                         | The empty state shows **No connectors connected yet** (`emptyStates.connectors.title`) + description, with **Add credential** as the way in — never a bare empty grid.                                                                                                                                                                                                                                                                                                                                                                                                                |
| F3  | Catalog picker (step 1)     | **Add credential**                                                                                                                                                 | A dialog titled **Add credential** (`settings.credentials.catalog.title`) with its own search (`settings.connectors.searchPlaceholder`). 13 vendors in one list (each row: icon, name, tags + action count meta `settings.connectors.card.actionCount`); configured vendors carry a **Configured** badge (`settings.credentials.catalog.configured`). The platform connectors (conversation, document, sandbox, task) are absent.                                                                                                                                                     |
| F4  | Add a token credential      | Picker → **GitHub** → step 2                                                                                                                                       | Step 2 titled `settings.credentials.addTitle` with description naming GitHub (`settings.credentials.addDescription`), a back control (`common.actions.back`), **Name** (+ help `settings.credentials.nameHelp`) and a masked **Token** field (`settings.connectors.dialog.token`). Fill both → **Add credential** (`settings.credentials.create`) → toast `settings.credentials.createdToast`; the row appears with method **Token** and — as the connector's first credential — the **Default** badge (`settings.credentials.default`). The typed secret appears nowhere afterwards. |
| F5  | Configured leads the picker | With the GitHub credential from F4, reopen **Add credential**                                                                                                      | GitHub leads the list with a **Configured** badge (`settings.credentials.catalog.configured`); the rest follow alphabetically — not one flat A–Z list with no prioritization.                                                                                                                                                                                                                                                                                                                                                                                                         |
| F6  | Per-credential instance URL | Picker → **Confluence** → name + username + password                                                                                                               | An extra required **Instance URL** field (`settings.connectors.dialog.endpointUrl`) with Atlassian help copy (`settings.connectors.dialog.endpointHelpConfluence`) and placeholder `https://your-site.atlassian.net`. Submit stays disabled until it is filled. Shopify behaves the same with its store origin (`settings.connectors.dialog.endpointHelpShopify`).                                                                                                                                                                                                                    |
| F7  | Mailbox connector config    | Picker → **IMAP / SMTP Mailbox**                                                                                                                                   | Beyond username/password, the connector's declared config fields render: **IMAP server** (required), **IMAP port** (placeholder `993`), **SMTP server** (required), **SMTP port** (placeholder `465`), **Connection security** select (`tls` / `starttls`), **Sent folder** (placeholder `Sent`). Submit is gated on the two required hosts; ports/security/folder may stay blank (server applies the declared defaults).                                                                                                                                                             |
| F8  | Split SMTP auth (imap-smtp) | In F7's form: toggle **Use a separate SMTP provider** (`settings.connectors.dialog.smtpSeparateToggle`)                                                            | The toggle (hint `settings.connectors.dialog.smtpSeparateHint`) reveals **SMTP username** + **SMTP password** (`settings.connectors.dialog.smtpUsername` / `smtpPassword`, hint `settings.connectors.dialog.smtpHint`); submit stays disabled until BOTH are filled. Toggling it off clears them and submit re-enables on the mailbox pair alone.                                                                                                                                                                                                                                     |
| F9  | Deep link narrows the table | With credentials for two connectors, open `…/settings/connectors?connector=github` directly                                                                        | Only the GitHub rows show — the param seeded the **Connector** facet (`settings.connectors.vendorFilterLabel`). Changing or clearing the facet removes `?connector=` from the URL and the facet's own selection takes over.                                                                                                                                                                                                                                                                                                                                                           |
| F10 | Row actions                 | Row 3-dot menu (`settings.credentials.actionsLabel`)                                                                                                               | Offers **Make default** / **Disable** / **Replace …** / **Edit credential** / **Delete** (`settings.credentials.makeDefault` / `disable` / `edit` / `delete`). Make default moves the **Default** badge to this row. Disable adds the **Disabled** badge (`settings.connectors.credential.disabled`) and the menu now offers **Enable** (`settings.credentials.enable`); on a disabled row, **Make default** is visible but inert.                                                                                                                                                    |
| F11 | Edit persists               | Row menu → **Edit credential** → rename; for Confluence also change the Instance URL; for imap-smtp change a config field → save → **reload**                      | Dialog `settings.credentials.editTitle` holds name, endpoint (vendor-decided), and the connector's config fields pre-filled from the stored row — never the secret. Toast `settings.credentials.savedToast`; after reload the new values read back.                                                                                                                                                                                                                                                                                                                                   |
| F12 | Replace secret              | Row menu → **Replace API key** / **Replace token** / **Replace username & password** (`settings.connectors.replace.apiKeyTitle` / `tokenTitle` / `basicTitle`)     | The dialog shows the write-only note (`settings.connectors.replace.note`); every field starts **blank** — no current value is ever shown. Submitting toasts `settings.credentials.savedToast`. An OAuth row offers **no** replace action at all.                                                                                                                                                                                                                                                                                                                                      |
| F13 | Delete with confirm         | Row menu → **Delete**                                                                                                                                              | A confirm dialog (`settings.credentials.deleteTitle`, body naming the credential `settings.credentials.deleteBody`); deleting the default additionally warns (`settings.credentials.deleteDefaultWarning`). Confirm → toast `settings.credentials.deletedToast`; the row is gone after reload.                                                                                                                                                                                                                                                                                        |
| F14 | No-default warning          | Leave a connector holding only non-default active credentials (delete its default, or disable it)                                                                  | A warning alert above the table names the vendor(s): `settings.credentials.noDefault`. Surfaced, never auto-fixed; it clears once a default is picked.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| F15 | OAuth consent (mode B)      | Picker → **Slack** → **Connect** (`settings.connectors.card.connect`)                                                                                              | Step 2 shows a consent explainer (`settings.connectors.card.emptyBodyOauth`) instead of a form — there is no secret field and no submit footer. **Connect** is a full-page navigation to `…/http_api/api/connectors/oauth2/start?connector=slack&organizationId=…`; after consent the browser lands on `…/settings/connectors?connected=slack` and a new row exists: method **OAuth**, named after the connector, default if first. No toast — the row is the assertion.                                                                                                              |
| F16 | Reconnect a stale grant     | On an OAuth row badged **Reconnect needed** (`settings.connectors.credential.needsReauth`) → row menu → **Reconnect** (`settings.connectors.credential.reconnect`) | The row's detail line explains re-consent (`settings.connectors.credential.needsReauthHint`, or `…needsReauthDetail` when the server recorded a reason). **Reconnect** leads the menu and triggers the same hand-off as F15; the refreshed grant clears the badge.                                                                                                                                                                                                                                                                                                                    |
| F17 | MCP endpoint page           | `/dashboard/{org}/settings/api/mcp`                                                                                                                                | Section **MCP endpoint** (`settings.mcpEndpoint.title`) with a copyable endpoint URL ending `/api/v1/mcp` (`settings.mcpEndpoint.copyEndpoint`), auth help linking to **REST API keys** (`settings.mcpEndpoint.authLink`), the tool inventory in three groups (`settings.mcpEndpoint.tools.authoring.title` / `…tools.management.title` / `…tools.capability.title`), and a copyable example curl (`settings.mcpEndpoint.exampleTitle`, `settings.mcpEndpoint.copyExample`).                                                                                                          |
| F18 | Legacy MCP redirects        | Open `/dashboard/{org}/settings/mcp`, then `/dashboard/{org}/settings/mcp-servers`                                                                                 | Each redirects in one hop to `…/settings/connectors` (URL settles there; the table renders).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## Boundary & error tests

| ID  | Test                        | Input                                                                        | Expected                                                                                                                                                                                                                                                                                                     |
| --- | --------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1  | Submit gating + dirty guard | Step 2: fill only the name; then try to close the dialog                     | **Add credential** stays disabled until the method's secret fields and every required config field are supplied (whitespace does not count). Closing with typed material prompts `common.discardChangesConfirm` before discarding.                                                                           |
| B2  | Non-numeric port            | imap-smtp form: type `abc` into **IMAP port**, complete the rest, submit     | The server refuses and the dialog shows its structured message inline (`"IMAP port" must be a number.`) — the client keeps number fields as strings and never silently coerces a half-typed value.                                                                                                           |
| B3  | Endpoint shape refused      | Confluence: enter a non-https or path-carrying Instance URL and submit       | The create is refused with the server's own message shown inline (the endpoint must be an https origin, no path); nothing is stored — reloading shows no new row.                                                                                                                                            |
| B4  | Access without permission   | Open the page as a member lacking `developerSettings`                        | **Access denied** (`accessDenied.connectors`) — never a partial table. _Mint a non-admin member; see [auth.md](auth.md) RBAC._                                                                                                                                                                               |
| B5  | Catalog unreadable          | Point the config root at a missing directory and reload                      | The page reports the listing failure with the server's message (`settings.connectors.catalog.listFailed`); a failed credential list says so too (`settings.credentials.listFailed`). The picker distinguishes a vendor-less deployment (`settings.connectors.catalog.emptyBody`) from an empty organization. |
| B6  | OAuth callback hardening    | Open `…/http_api/api/connectors/oauth2/callback` directly (no/stale `state`) | A fixed server-rendered error page — "This connection link has expired" — with a way back to connector settings. No vendor text, no request data, and no script on the page; nothing was stored.                                                                                                             |

## Accessibility (WCAG 2.1 AA)

| ID  | Check            | Expected                                                                                                                                                                                                                                                                                                                   |
| --- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Add-flow dialog  | The dialog is labelled (**Add credential**); its close control has an accessible name (`common.aria.close`); step 2's back control is named (`common.actions.back`). Picker vendor rows are real buttons and keyboard-operable; configured rows expose a **Configured** badge (`settings.credentials.catalog.configured`). |
| A2  | Secret fields    | Every secret field — API key, token, password, SMTP password — is `type=password` (masked), never plain text, in both the add and replace dialogs.                                                                                                                                                                         |
| A3  | Table & row menu | The actions column header exists for screen readers (visually hidden, `settings.credentials.columns.actions`); each row's 3-dot menu is named for its credential (`settings.credentials.actionsLabel`) and its items are keyboard reachable.                                                                               |

## Performance

| ID  | Metric            | Target                                                                               |
| --- | ----------------- | ------------------------------------------------------------------------------------ |
| P1  | Table first paint | Section + table (or empty state) render < 2 s on a warm dev stack (mode A).          |
| P2  | Add round trip    | **Add credential** submit → toast + new row < 3 s (mode A; it is a write, no probe). |

## Issues Found

| #   | Test ID | Route / URL | Severity (crit/high/med/low) | Description | Screenshot |
| --- | ------- | ----------- | ---------------------------- | ----------- | ---------- |
|     |         |             |                              |             |            |

## Test summary

```
Area: Connectors
Functional: ___/18   Boundary: ___/6   A11y: ___/3   Perf: ___/2
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
