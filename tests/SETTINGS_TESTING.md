# Settings Testing Guide (AI-Directed)

> **Purpose**: Exercise the settings area — Account, Organization (People + Teams), Providers, Integrations, API keys, Branding, and Governance — and collect defects in Issues Found. Settings is where admins provision people, wire providers/integrations, and set the governance policies the rest of the product enforces.

## Prerequisites

Bring the stack up per [FULL_SITE_TESTING.md](FULL_SITE_TESTING.md) and sign in as `admin@admin.test` / `Admin@123`. Open `/dashboard/{id}/settings`.

> **AI Instructions**: Run in order; one finding per defect with a screenshot. Changing the admin password (Account) will sign you out by design — do that test last, and re-login with the new password.

## Screenshot Setup

```bash
mkdir -p tests/screenshots/$(date +%Y-%m-%d_%H_%M)/settings
```

## Account

| ID  | Test                      | Steps                                | Expected                                                     |
| --- | ------------------------- | ------------------------------------ | ------------------------------------------------------------ |
| AC1 | Edit display name         | Change name, save                    | Persists; reflected in the user menu                         |
| AC2 | Change password (re-auth) | Change password with a valid new one | Signed out + redirected to login; new password works (#1255) |
| AC3 | Password policy on change | Try a password below policy          | Rejected with the policy hint                                |
| AC4 | Two-factor section        | Toggle 2FA enrollment                | Enroll/disable flow works (see AUTH_TESTING)                 |

## Organization — People & Teams

| ID  | Test                        | Steps                                | Expected                                           |
| --- | --------------------------- | ------------------------------------ | -------------------------------------------------- |
| OR1 | Edit org name               | Change org name, save                | Persists                                           |
| OR2 | Add member                  | Add member (email + password + role) | Created; credentials shown                         |
| OR3 | Add member — empty password | Submit new user with blank password  | Password field error, not a generic toast (#1470)  |
| OR4 | Create team                 | Create a team (name only)            | Created; creator auto-added as a member (#1378)    |
| OR5 | Rename team                 | Edit a team's name, save             | List updates to the new name immediately (#1374)   |
| OR6 | Add/remove team members     | Add then remove a member from a team | Membership updates reactively                      |
| OR7 | Members pagination/scale    | View an org with many members        | List remains usable (note if it truncates — #1463) |

## Providers

| ID  | Test                  | Steps                                            | Expected                                                           |
| --- | --------------------- | ------------------------------------------------ | ------------------------------------------------------------------ |
| PV1 | Add provider          | Add a provider, save                             | Reachable from agents; row turns healthy                           |
| PV2 | Add-provider gating   | Open add-provider, leave required fields empty   | Submit disabled until valid (#1382)                                |
| PV3 | Fetch + search models | Fetch models, use the search field, multi-select | Searchable, checkbox-selectable list after fetch (#1569/#1570)     |
| PV4 | Local/private host    | Add a provider pointing at `localhost`           | Rejected unless `TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1` (#1427 docs) |

## Integrations

| ID  | Test              | Steps                                              | Expected                                                        |
| --- | ----------------- | -------------------------------------------------- | --------------------------------------------------------------- |
| IN1 | Integrations list | Open Integrations                                  | Catalogue renders                                               |
| IN2 | Connect (OAuth2)  | Connect an OAuth2 integration                      | Redirect to provider; callback returns; tokens stored encrypted |
| IN3 | MCP server add    | Settings → MCP Servers → add (None/API key/OAuth2) | Auth options present; test-connection reports handshake result  |

## Governance

| ID  | Test                       | Steps                                                     | Expected                                                 |
| --- | -------------------------- | --------------------------------------------------------- | -------------------------------------------------------- |
| GV1 | Password policy editor     | Set min length + complexity                               | Saved; enforced on add-member + change-password (#1503)  |
| GV2 | Upload policy conflict     | Put the same extension in allowed + blocked               | Rejected with a conflict error (#1479)                   |
| GV3 | Budget rule confirm-delete | Delete a budget rule                                      | Confirmation dialog before removal (#1419)               |
| GV4 | Feature flags              | Toggle web search / code execution / file upload by scope | Enforced server-side in chat (see CHAT_TESTING TL6)      |
| GV5 | Audit logs + export        | Open Audit logs; export CSV/JSON                          | Filtered export downloads with documented columns (#190) |

## Accessibility tests (WCAG 2.1 AA)

| ID  | Check                   | Expected                                                |
| --- | ----------------------- | ------------------------------------------------------- |
| X1  | Settings nav keyboard   | Section tabs reachable + operable; active tab marked    |
| X2  | Form labels + errors    | Every field labelled; validation errors announced       |
| X3  | Dialog focus management | Add-member / create-team / editors trap + restore focus |

## Performance tests

| ID  | Metric          | Target                          |
| --- | --------------- | ------------------------------- |
| P1  | Section switch  | < 1 s between settings sections |
| P2  | Save round-trip | < 1.5 s for a settings save     |

## Issues Found

| #   | Test ID | Page / URL | Severity | Description | Screenshot |
| --- | ------- | ---------- | -------- | ----------- | ---------- |
|     |         |            |          |             |            |

## Test summary

```
Module: Settings
Account: ___/4  People&Teams: ___/7  Providers: ___/4  Integrations: ___/3  Governance: ___/5  A11y: ___/3  Perf: ___/2
Issues found: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
