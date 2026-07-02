# Integrations — Manual Test Plan

> **Purpose**: Exercise the third-party **integration catalog** under Settings —
> browsing the catalog, connecting an API-key/token integration (and watching its
> `testConnection` succeed offline against the mock gateway), the connected/active
> details view, disconnect, delete, the legacy `?section=mcp-servers` redirect, and
> the OAuth callback toasts. Custom-connector upload is touched lightly; MCP
> servers are a separate page ([settings.md](settings.md) F10) and so is Enterprise
> SSO ([settings.md](settings.md) F21).

## Scope & routes

| Surface                           | Route                                                        |
| --------------------------------- | ------------------------------------------------------------ |
| Integrations — Connected tab      | `/dashboard/{org}/settings/integrations`                     |
| Integrations — All catalog        | `/dashboard/{org}/settings/integrations?tab=all`             |
| Deep-link to one integration      | `/dashboard/{org}/settings/integrations?tab=all&slug=<slug>` |
| Legacy MCP deep link (→ redirect) | `/dashboard/{org}/settings/integrations?section=mcp-servers` |

Notes verified against the route file (`app/routes/dashboard/$id/settings/integrations.tsx`):

- The page heading renders the **navigation** label `navigation.integrations`
  ("Integrations"), **not** `settings.integrations.title`. (`settings.integrations.title`
  also exists and resolves to the same string, but it is _not_ what the page uses.)
- The route defaults to the **Connected** tab (`tab ?? 'connected'`), which is
  empty for a fresh org — so the connector cards only render under `?tab=all`.
- `?section=mcp-servers` `beforeLoad`-redirects to the MCP settings page; the
  observed final URL is `/dashboard/{org}/settings/api/mcp`.
- `?tab=all&slug=<slug>` opens that integration's detail panel once, then strips
  the `slug` param from the URL (the observed final URL drops `&slug=…`).

## Prerequisites

Bring the stack up and sign in per [SETUP.md](SETUP.md), **mode A (deterministic,
offline)** — this is the mode that makes integration `testConnection` succeed
without real API keys. The mock gateway (`:4141`) stands in for every third-party
API and `TALE_MOCK_INTEGRATIONS_BASE` redirects connector outbound HTTP to it.
The integration catalog in the fixtures symlinks the real
`builtin-configs/integrations` (11 connectors: confluence, discord, github, gmail,
google_drive, outlook, shopify, slack, tavily, teams, twilio). Sign in as an
owner/admin — the catalog requires the `developerSettings` ability (read), else
the page renders `AccessDenied` (`accessDenied.integrations`).

> **Agent note**: connecting an API-key/token integration (e.g. **Tavily**,
> **GitHub**) runs the connector's _real_ `testConnection`, whose outbound HTTP is
> redirected to the gateway, so it succeeds offline. The test result is **inline
> aria-live feedback** (a green `Connection successful` `<output>` region inside
> the panel), **not** a toast — wait on that text, not a toast. The integration
> becomes "connected" only after a successful connect; verify by reloading and
> checking the **Connected** tab. Connect/Disconnect are **idempotent** — re-running
> against an already-connected integration is safe.

## Automated coverage

| Case(s)        | Status         | e2e spec                                                                                                       |
| -------------- | -------------- | -------------------------------------------------------------------------------------------------------------- |
| F2, F3, F5     | ✅ automated   | `integrations.spec.ts` (GitHub + Tavily connect; disconnect helper)                                            |
| F1             | 🔶 partial     | `integrations.spec.ts` (loads `?tab=all` to find cards; no catalog-card-count / tab-toggle / search assertion) |
| F4, F6, F7, F8 | ⛔ manual-only | —                                                                                                              |
| B1, B2, B3     | ⛔ manual-only | —                                                                                                              |
| B4             | ⛔ manual-only | — (needs a minted non-admin member; see [auth.md](auth.md) RBAC)                                               |

Legend: ✅ fully automated · 🔶 partially automated · ⛔ manual-only (no spec).
(`integrations.spec.ts` is the only spec that touches this area — `settings.spec.ts`,
`settings-depth.spec.ts`, `navigation.spec.ts`, and `page-loads.spec.ts` do **not**
reference integrations.)

## Functional tests

| ID  | Test                      | Steps (route + control)                                                                                                                                                                                                                                                                                                                                                                          | Expected (verifiable)                                                                                                                                                                                                                                                                   |
| --- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Catalog renders           | `/dashboard/{org}/settings/integrations?tab=all` — heading **Integrations** (`navigation.integrations`), subtitle (`settings.integrations.pageSubtitle`), **Add integration** (`settings.integrations.addCustomIntegration`), the **Connected** / **All integrations** tabs (`settings.integrations.tabs.connected` / `…tabs.all`), the search field (`settings.integrations.searchPlaceholder`) | URL stays `…/settings/integrations?tab=all`; heading **Integrations** visible; 11 connector cards render, each with a card status badge **Connect** (`settings.integrations.badge.connect`); no console error                                                                           |
| F2  | Connect API-key (Tavily)  | `?tab=all&slug=tavily` opens the panel (title **Integration details**/**Add integration**, `settings.integrations.panel.addIntegration`) → fill the **Api Key** field (label = start-cased binding `apiKey`) → click **Connect Tavily** (`settings.integrations.panel.connectName`)                                                                                                              | Inline **Connection successful** (`settings.integrations.connectionSuccessful`) green `<output>` appears; panel switches to active view showing **Active** status + **Test connection** (`settings.integrations.manageDialog.testConnection`) + **Disconnect** + **Delete integration** |
| F3  | Connect persists          | After F2: reload `/dashboard/{org}/settings/integrations` (defaults to **Connected** tab)                                                                                                                                                                                                                                                                                                        | **Tavily** card is present on the Connected tab with a **Connected** status badge (`settings.integrations.badge.connected`) — the connection survived reload                                                                                                                            |
| F4  | Test connection (re-run)  | Open the connected Tavily panel → **Test connection** (`settings.integrations.manageDialog.testConnection`)                                                                                                                                                                                                                                                                                      | Button shows **Testing…** (`settings.integrations.manageDialog.testingConnection`) then inline **Connection successful** re-appears                                                                                                                                                     |
| F5  | Disconnect                | Connected Tavily panel → **Disconnect** (`settings.integrations.disconnect`) → confirm dialog (title `settings.integrations.panel.disconnectConfirmTitle`, confirm button **Disconnect**) → reload Connected tab                                                                                                                                                                                 | Toast **Disconnected** (`settings.integrations.toast.disconnected`); after reload Tavily is **gone** from the Connected tab and the empty state **No connected integrations** (`settings.integrations.empty.connectedTitle`) shows                                                      |
| F6  | Search filter             | `?tab=all` → type `tavily` in search (`settings.integrations.searchPlaceholder`); then type `zzzznotreal`                                                                                                                                                                                                                                                                                        | First query narrows to the Tavily card only; the no-match query shows the empty state **No results found** (`settings.integrations.empty.searchTitle`)                                                                                                                                  |
| F7  | Legacy MCP redirect       | Navigate to `/dashboard/{org}/settings/integrations?section=mcp-servers`                                                                                                                                                                                                                                                                                                                         | URL redirects to `/dashboard/{org}/settings/api/mcp`; the MCP servers page renders (title contains **MCP servers**)                                                                                                                                                                     |
| F8  | Delete custom integration | Open a connected integration panel → **Delete integration** (`settings.integrations.panel.deleteIntegration`) → confirm delete dialog (title `settings.integrations.panel.deleteConfirmTitle`)                                                                                                                                                                                                   | Delete toast (`settings.integrations.manageDialog.deleted`); the integration is removed (a built-in connector reverts to the catalog **Connect** state, a custom-uploaded one disappears entirely). _Run on your own minted org — destructive._                                         |

## Boundary & error tests

| ID  | Test                        | Input                                                                                                                                                                             | Expected                                                                                                                                                                                             |
| --- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Connect with no credentials | Open an unconnected integration (e.g. `?tab=all&slug=github`) without entering any credential → inspect the **Connect GitHub** button (`settings.integrations.panel.connectName`) | The **Connect** button is **disabled** (the `!hasChanges` guard) — connect blocked until a credential is entered                                                                                     |
| B2  | OAuth callback error        | Navigate to `/dashboard/{org}/settings/integrations?integration_oauth2_error=access_denied&description=User%20denied`                                                             | Destructive toast **Connection failed** (`settings.integrations.oauthErrorTitle`) with the `description` text; the `integration_oauth2_error` query param is then cleared from the URL (replace nav) |
| B3  | OAuth callback success      | Navigate to `/dashboard/{org}/settings/integrations?integration_oauth2=success`                                                                                                   | Success toast **Integration connected** (`settings.integrations.oauthConnectedTitle`); the `integration_oauth2` param is cleared from the URL                                                        |
| B4  | Access without permission   | Open `/dashboard/{org}/settings/integrations` as a member lacking the `developerSettings` ability                                                                                 | The **Access denied** notice (`accessDenied.integrations`) renders — never a partial catalog. _Mint a non-admin member; see [auth.md](auth.md) RBAC._                                                |

## Accessibility (WCAG 2.1 AA)

| ID  | Check                | Expected                                                                                                                            |
| --- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Catalog tabs         | **Connected** / **All integrations** are reachable + togglable by keyboard; the active tab is marked                                |
| A2  | Connect panel        | The panel is a labelled dialog/sheet; the close control has an accessible name (`common.aria.close`); credential fields have labels |
| A3  | Test-result feedback | The connect/test result region is an `aria-live="polite"` `<output>` so success/failure is announced                                |
| A4  | Secret field         | The credential field for a secret binding is `type=password` (masked); not plain text                                               |

## Performance

| ID  | Metric                  | Target                                                                                                                      |
| --- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| P1  | Catalog first paint     | `?tab=all` catalog grid (11 cards) renders < 2 s on a warm dev stack (mode A)                                               |
| P2  | Connect round-trip      | **Connect Tavily** → inline **Connection successful** < 5 s (offline `testConnection` via the `:4141` mock gateway, mode A) |
| P3  | Connected-state persist | Connect → reload → Tavily on the Connected tab < 2 s (mode A)                                                               |

## Issues Found

| #   | Test ID | Route / URL                                                  | Severity | Description                                                                                                                                                                 | Screenshot                    |
| --- | ------- | ------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 1   | F2      | `/dashboard/{org}/settings/integrations?tab=all&slug=tavily` | low      | The global "Tale is ready to work offline" toast overlaps the panel title ("Integration de…" truncated under it) when the panel opens. Cosmetic; not integrations-specific. | `integrations/D1-connect.png` |

## Test summary

```
Area: Integrations
Functional: ___/8   Boundary: ___/4   A11y: ___/4   Perf: ___/3
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
