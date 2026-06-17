# Settings — Manual Test Plan

> **Purpose**: Exercise the personal and workspace settings — account profile,
> personalization, organization, teams, branding, integrations, the API surfaces
> (REST keys, MCP, runtimes/daemons, WebDAV), providers, skills, sandboxes, and
> data-residency/deployment. Governance has its own guide
> ([governance.md](governance.md)); security/2FA live in [auth.md](auth.md).

## Scope & routes

| Surface                     | Route                                                         |
| --------------------------- | ------------------------------------------------------------- |
| Account                     | `/dashboard/{org}/settings/account`                           |
| Personalization             | `/dashboard/{org}/settings/personalization`                   |
| Organization                | `/dashboard/{org}/settings/organization`                      |
| Teams                       | `/dashboard/{org}/settings/teams`                             |
| Branding                    | `/dashboard/{org}/settings/branding`                          |
| Integrations                | `/dashboard/{org}/settings/integrations`                      |
| API                         | `/dashboard/{org}/settings/api/{rest\|mcp\|runtimes\|webdav}` |
| Providers                   | `/dashboard/{org}/settings/providers` · `…/providers/{slug}`  |
| Skills                      | `/dashboard/{org}/settings/skills`                            |
| Sandboxes                   | `/dashboard/{org}/settings/sandboxes`                         |
| Data residency / deployment | `/dashboard/{org}/settings/deployment`                        |

## Prerequisites

Stack up + signed in per [SETUP.md](SETUP.md) as an owner/admin (some tabs are
role-gated — see [auth.md](auth.md) RBAC; data residency is restricted to the
operators listed in the deployment `.env`). Restore any toggled setting after the
run.

> **Agent note**: each tab saves via the global Save bar; verify by reload, not
> the toast. The settings index redirects to a permission-appropriate page on
> desktop and shows a list on mobile.

## Automated coverage

| Case(s)              | Status         | e2e spec                 |
| -------------------- | -------------- | ------------------------ |
| F1, F4, F13          | ✅ automated   | `settings.spec.ts`       |
| F3, F6, F7, F9       | ✅ automated   | `settings-depth.spec.ts` |
| F3 (theme/locale)    | ✅ automated   | `preferences.spec.ts`    |
| B1                   | ✅ automated   | `validation.spec.ts`     |
| F8, F10–F12, F14–F19 | ⛔ manual-only | —                        |

## Functional tests

| ID  | Test               | Steps (route + control)                                                                                                                                                                                   | Expected                                                                                                           |
| --- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| F1  | Account profile    | Account → display name (`settings.account.profile.name`) → save                                                                                                                                           | `toast.success.profileUpdated`; persists on reload                                                                 |
| F2  | Account security   | Account → 2FA / passkeys / sessions / delete account                                                                                                                                                      | Covered in [auth.md](auth.md) (F7–F10)                                                                             |
| F3  | Personalization    | Theme (`auth.userButton.themeSystem/themeLight/themeDark`), language (`auth.userButton.language`), custom-instructions toggle (`personalization.page.customInstructionsToggle.label`)                     | `personalization.toasts.preferencesUpdated`; theme/locale persist on reload                                        |
| F4  | Organization       | Org name (`settings.organization.title`) → save                                                                                                                                                           | `toast.success.organizationUpdated`; slug/id read-only                                                             |
| F5  | Members            | Invite / change role / remove a member                                                                                                                                                                    | Covered in [auth.md](auth.md) (F14)                                                                                |
| F6  | Teams              | **Create team** (`settings.teams.createTeam`) → name (`settings.teams.teamName`); edit; **Delete** (`settings.teams.deleteTeam`)                                                                          | CRUD reflects in the list                                                                                          |
| F7  | Branding           | App name (`settings.branding.appName`) + brand color (`settings.branding.brandColor`) → save                                                                                                              | Preview updates live; `toast.success.brandingUpdated`; persists                                                    |
| F8  | Integrations       | Integrations (`settings.integrations.title`) → connect an app (OAuth); then **Disconnect** (`settings.integrations.disconnect`)                                                                           | Catalog renders; on connect `settings.integrations.connectionSuccessful`; state toggles                            |
| F9  | API keys           | **Create key** (`settings.apiKeys.createKey`) → name (`form.name`) → submit (`createKeySubmit`); reveal (`yourApiKey`) → **Done** (`common.actions.done`); then **Revoke** (`settings.apiKeys.revokeKey`) | Key shown once; revoke removes it                                                                                  |
| F10 | MCP                | API → MCP → configure a server                                                                                                                                                                            | Server saved; resources browsable                                                                                  |
| F11 | Runtimes (daemons) | API → Runtimes (`navigation.runtimes`) → **Connect a daemon** (`runtimes.install.title`); **Create an API key** (`runtimes.install.createKey`)                                                            | Setup instructions shown; a connected daemon appears under **Connected daemons** (`runtimes.list.title`)           |
| F12 | WebDAV             | API → WebDAV (`navigation.webdav`) → **Generate a new app-password** (`webdav.create.title`); read connection details (`webdav.connectionDetails.title`)                                                  | App-password shown once; a WebDAV client can mount with it                                                         |
| F13 | Providers          | Providers list (`navigation.providers`) → open a provider → **Edit** (`settings.providers.editGeneral`) → display name (`settings.providers.displayName`) → **Save** (`settings.providers.saveChanges`)   | `settings.providers.saved`; persists                                                                               |
| F14 | Provider models    | In a provider, toggle model availability / set credentials                                                                                                                                                | Enabled models reflect in the chat model picker                                                                    |
| F15 | Skills             | Skills (`metadata.skills.title`) → search (`settings.skills.searchPlaceholder`); **Upload skill** (`settings.skills.uploadSkill`); **Delete skill** (`settings.skills.deleteSkill`)                       | Upload adds it (`settings.skills.skillDeleted` on delete); installed skills bindable on agents                     |
| F16 | Data residency     | `/dashboard/{org}/settings/deployment` (`navigation.dataResidency`) → **External Postgres** (`settings.dataResidency.externalPostgres`), host/port (`settings.dataResidency.field.host`)                  | Editable only for operator emails — otherwise the read-only notice (`settings.dataResidency.readOnly.title`) shows |
| F17 | Org agent defaults | `/dashboard/{org}/settings/agents`                                                                                                                                                                        | Org-wide agent defaults save                                                                                       |
| F18 | Logs               | `/dashboard/{org}/settings/logs`                                                                                                                                                                          | Activity log renders + filters                                                                                     |
| F19 | Sandboxes          | `/dashboard/{org}/settings/sandboxes`                                                                                                                                                                     | Sandbox execution environment config renders + saves                                                               |

## Boundary & error tests

| ID  | Test            | Input                                                       | Expected                                           |
| --- | --------------- | ----------------------------------------------------------- | -------------------------------------------------- |
| B1  | Empty name      | Empty org / team name (`settings.teams.teamNameRequired`)   | Required validation; save blocked                  |
| B2  | Bad brand color | Invalid color value                                         | Validation; not applied                            |
| B3  | Revoked key     | Call the API with a revoked key                             | Rejected (401/403)                                 |
| B4  | Role gating     | Open a role-gated tab (or data residency) as a non-operator | Hidden or read-only notice, never a partial render |

## Accessibility (WCAG 2.1 AA)

| ID  | Check         | Expected                                               |
| --- | ------------- | ------------------------------------------------------ |
| A1  | Settings rail | Labelled `<nav>`; current item marked (`aria-current`) |
| A2  | Save bar      | Reachable + operable by keyboard                       |
| A3  | Color picker  | Keyboard operable; not pointer-only                    |
| A4  | Secret reveal | API key / app-password reveal control labelled         |

## Performance

| ID  | Metric     | Target                      |
| --- | ---------- | --------------------------- |
| P1  | Tab switch | < 1 s between settings tabs |
| P2  | Save       | Save → persisted < 2 s      |

## Issues Found

| #   | Test ID | Route / URL | Severity | Description | Screenshot |
| --- | ------- | ----------- | -------- | ----------- | ---------- |
|     |         |             |          |             |            |

## Test summary

```
Area: Settings
Functional: ___/19   Boundary: ___/4   A11y: ___/4   Perf: ___/2
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
