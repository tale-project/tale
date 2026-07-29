# Connectors — Manual Test Plan

> **Purpose**: Exercise the **connector catalog** under Settings — browsing the
> shipped connectors as cards, narrowing them (tabs, search, tag facet), and
> managing one connector's credentials in the dialog its card opens: add, rename,
> replace the secret, make default, enable/disable, delete, plus the OAuth
> consent hand-off and its return params.
>
> The MCP **endpoint** is a separate page, `settings/api/mcp`
> ([settings.md](settings.md) F10). Enterprise SSO is separate
> ([settings.md](settings.md) F21). AI providers are their own page with the same
> shape ([settings.md](settings.md) F13).

## Scope & routes

| Surface                      | Route                                                    |
| ---------------------------- | -------------------------------------------------------- |
| Connector catalog            | `/dashboard/{org}/settings/connectors`                   |
| Deep-link to one connector   | `/dashboard/{org}/settings/connectors?connector=<slug>`  |
| Legacy MCP-servers deep link | `/dashboard/{org}/settings/mcp-servers` → `…/connectors` |
| Legacy MCP deep link         | `/dashboard/{org}/settings/mcp` → `…/connectors`         |

Notes verified against `app/features/settings/connectors/components/connectors-settings.tsx`:

- Settings pages carry **no page title** — the rail names the page
  (`navigation.connectors`, "Connectors").
- The tab strip is **component state**, not a search param, and opens on **All**.
  A `?tab=…` param does nothing.
- `?connector=<slug>` is the one URL-held piece of state: it opens that
  connector's dialog. It has to be a search param because OAuth consent leaves
  the page entirely and comes back.
- Both legacy MCP routes redirect in **one hop** to `…/settings/connectors`.

## Prerequisites

Bring the stack up and sign in per [SETUP.md](SETUP.md), **mode A (deterministic,
offline)**. The mock gateway (`:4141`) stands in for every third-party API and
`TALE_MOCK_CONNECTORS_BASE` redirects connector outbound HTTP to it. The catalog
reads `configs/platform/system/connectors/` (16 connectors: confluence, discord,
document, github, gmail, google-drive, imap-smtp, outlook, sandbox, shopify,
slack, task, tavily, teams, twilio, webdav).

Sign in as an owner/admin — the page requires the `developerSettings` ability
(read), else it renders `AccessDenied` (`accessDenied.connectors`).

> **Agent note**: adding a credential is a **write only** — this page runs no
> `testConnection`, so nothing probes the vendor and success is a toast plus a new
> row, not an inline green region. Stored secrets are never read back: every
> secret field starts blank, including in **Replace secret**.
>
> **F9/F10 need mode B**: OAuth consent is a real full-page navigation to the
> vendor. In mode A, assert the hand-off (the browser leaves for
> `/api/connectors/oauth2/start?connector=…`) rather than a completed grant.

## Automated coverage

| Tests                          | Status         | Where                                                                                 |
| ------------------------------ | -------------- | ------------------------------------------------------------------------------------- |
| F1, F3, F4, F6–F8, F11, B1, B4 | ✅ automated   | `app/features/settings/connectors/components/connectors-settings.test.tsx` (20 cases) |
| F1, F4                         | ✅ automated   | `tests/e2e/specs/settings.spec.ts` (catalog renders; a card opens its dialog)         |
| F2, F5                         | 🔶 partial     | the skeleton branch is unit-covered; first paint + deep link are manual               |
| F9, F10, B2, B3                | ⛔ manual-only | — (consent and its return params need a real vendor round trip)                       |
| B5                             | ⛔ manual-only | — (needs a broken config root)                                                        |

## Functional tests

| ID  | Test                    | Steps                                                                                          | Expected                                                                                                                                                                  |
| --- | ----------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Catalog renders         | `/dashboard/{org}/settings/connectors`                                                         | 16 cards, each an icon + name heading + description + tags + action count. Tab strip **All / Connected / Available**, a search field, a **Tags** facet. No console error. |
| F2  | Loading masks in place  | Hard-reload and watch the grid                                                                 | Placeholder **cards** of the same footprint — not spinners, not naked bars — and no layout shift when the catalog resolves.                                               |
| F3  | Narrowing               | Click **Connected**, then **Available**; type `channels` in search; pick a tag                 | Each narrows the grid. A no-match query shows **No results found** plus the search hint, and **no** create CTA.                                                           |
| F4  | Card opens its dialog   | Click any card                                                                                 | A dialog titled with the connector's name, holding its facts, its credentials (or the empty state), and **Add credential**. URL gains `?connector=<slug>`.                |
| F5  | Deep link               | Open `…/settings/connectors?connector=github` directly                                         | The GitHub dialog is open on arrival — no click needed.                                                                                                                   |
| F6  | Add a credential        | GitHub card → **Add credential** → name + token → submit                                       | Toast **Credential added**; the row appears with its **masked** preview and method badge. The typed secret appears nowhere — not as text, not as a lingering value.       |
| F7  | Per-credential instance | Confluence card → **Add credential** → name + username + password                              | Submit stays **disabled** until the instance URL is filled; its help names what to paste (an Atlassian site origin).                                                      |
| F8  | Row actions             | Row kebab → **Make default**, **Disable**/**Enable**, **Replace secret**, **Edit**, **Delete** | Each acts and toasts. **Make default** is visible but **inert** on a disabled credential. **Delete** needs an explicit confirm and warns when deleting the default.       |
| F9  | OAuth consent (mode B)  | Slack card → **Connect**                                                                       | Full-page navigation to `/api/connectors/oauth2/start?connector=slack&organizationId=…`; after consent the callback returns here with the grant stored.                   |
| F10 | Reconnect a stale grant | On a grant showing **Reconnect needed**: row kebab → **Reconnect**                             | The same consent hand-off as F9. The row offers **no** Replace secret — an OAuth grant has no hand-entered secret to replace.                                             |
| F11 | No-default warning      | Leave a connector holding credentials but none default                                         | The dialog warns that a call naming none cannot pick one. Surfaced, **never auto-fixed**.                                                                                 |

## Boundary & error tests

| ID  | Test                      | Input                                                                                  | Expected                                                                                                                         |
| --- | ------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Submit with no secret     | Open **Add credential**, fill only the name                                            | Submit is **disabled** until the method's required fields are filled.                                                            |
| B2  | OAuth callback error      | `…/settings/connectors?connector_oauth2_error=access_denied&description=User%20denied` | The failure is reported with the vendor's own reason; the param is then cleared from the URL.                                    |
| B3  | OAuth callback success    | `…/settings/connectors?connector_oauth2=success`                                       | Success is reported; the param is cleared from the URL.                                                                          |
| B4  | Access without permission | Open the page as a member lacking `developerSettings`                                  | **Access denied** (`accessDenied.connectors`) — never a partial catalog. _Mint a non-admin member; see [auth.md](auth.md) RBAC._ |
| B5  | Catalog unreadable        | Point the config root at a missing directory and reload                                | The listing failure is reported with the server's own message, not an empty grid claiming there are no connectors.               |

## Accessibility (WCAG 2.1 AA)

| ID  | Check             | Expected                                                                                                                |
| --- | ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| A1  | Tab strip         | **All / Connected / Available** are reachable and switchable by keyboard; the active tab is marked.                     |
| A2  | Cards as headings | Each card's name is a real heading, so a screen-reader user can jump card to card instead of tabbing through every one. |
| A3  | Card activation   | A card is one focusable control with an accessible name ("Open <connector>"), operable by Enter/Space.                  |
| A4  | Dialog            | The dialog is labelled by the connector's name; its close control has an accessible name (`common.aria.close`).         |
| A5  | Secret fields     | Every secret field is `type=password` (masked), never plain text.                                                       |
| A6  | Row action menu   | The kebab is named for its credential ("Actions for <name>"); items are keyboard reachable.                             |

## Performance

| ID  | Metric              | Target                                                                      |
| --- | ------------------- | --------------------------------------------------------------------------- |
| P1  | Catalog first paint | The 16-card grid renders < 2 s on a warm dev stack (mode A).                |
| P2  | Narrowing           | Typing in search re-renders the grid with no perceptible lag (client-side). |
| P3  | Add round-trip      | **Add credential** → toast + new row < 3 s (mode A).                        |

## Issues Found

| #   | Test ID | Route / URL | Severity | Description | Screenshot |
| --- | ------- | ----------- | -------- | ----------- | ---------- |
|     |         |             |          |             |            |

## Test summary

```
Area: Connectors
Functional: ___/11   Boundary: ___/5   A11y: ___/6   Perf: ___/3
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
