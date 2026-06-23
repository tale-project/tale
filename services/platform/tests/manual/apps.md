# Apps — Manual Test Plan

> **Purpose**: Exercise the Apps marketplace (shipped #1911) — the Apps hub
> grid, an app's detail page (org-scoped views vs. the project-scoped
> membership hub vs. an Install prompt), the install/setup wizard, the
> lifecycle ⋯ menu (Reinstall / Uninstall / Remove from project), the
> readiness checklist, and the in-app run-detail (workflow DAG) page —
> including its project-nested twin.

## Scope & routes

Every route below is backed by a real route file under
`app/routes/dashboard/$id/**` (verified). `{org}` is the 16+ char org id in
the dashboard URL; `{slug}` is an app's directory slug (e.g. `issue-desk`);
`{projectId}` / `{executionId}` are ids.

| Surface                | Route                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| Apps hub (grid)        | `/dashboard/{org}/apps`                                                                  |
| App detail             | `/dashboard/{org}/apps/{slug}`                                                           |
| App run detail (DAG)   | `/dashboard/{org}/apps/{slug}/runs/{executionId}?wf={workflowSlug}`                      |
| Project-scoped app     | `/dashboard/{org}/projects/{projectId}/apps/{slug}`                                      |
| Project-scoped app run | `/dashboard/{org}/projects/{projectId}/apps/{slug}/runs/{executionId}?wf={workflowSlug}` |

> **Route note**: there is **no** `/dashboard/{org}/projects/{projectId}/apps`
> index route — a project-scoped app is reached only via its `{slug}` (from the
> hub's membership list or the project nav). The run-detail route takes a
> `?wf=<workflowSlug>` search param; without it the DAG canvas is empty by
> design (`validateSearch` in the route file).

## Prerequisites

Bring the stack up and sign in per [SETUP.md](SETUP.md).

> **⚠️ Environment precondition (mode A / hermetic stack)**: the built-in app
> catalog (`$TALE_CONFIG_BUILTIN_DIR/apps/`) ships **empty** on this stack — its
> only entry is a `.gitkeep`. Consequences, all verified live:
>
> - Every org's **Apps hub renders its empty state** ("No apps yet"); there are
>   no cards to click and no Install button on the hub.
> - An app **detail page for any slug renders "App not found / This pack is not
>   installed"** (`apps.notFound.*`) because `useApps` returns `[]` — there is no
>   in-UI catalog of _installable_ apps, only of _installed_ ones.
> - `installApp` would fail (no template to copy from), so the install wizard,
>   populated views, the membership hub, and a real run DAG are **NOT
>   exercisable here**. Those cases (F4–F12, B2–B4 below) are marked
>   **(env-gated)** and are testable only on a stack whose builtin catalog
>   contains an app bundle (the real product catalog at `builtin-configs/apps/`,
>   e.g. `issue-desk`).
>
> The reference app slug used in URLs below is **`issue-desk`** (the product
> catalog bundle). On the hermetic stack it resolves to the not-found state,
> which is exactly what the render-smoke cases (F1–F3, F13) assert.

> **Agent note**: app routes never 500 — they degrade to an EmptyState. Verify
> by the visible EmptyState title (role/text), not by a toast. For any
> lifecycle write, verify by reload + read-back of the on-page state (badge /
> membership row / readiness item), never the transient success toast.

## Automated coverage

The Apps feature has **no dedicated e2e spec** (verified: `apps.spec.ts` does
not exist, and neither `page-loads.spec.ts` nor `navigation.spec.ts` visits an
`/apps` route). The whole surface is therefore manual-only — a real coverage
gap for a feature shipped in #1911.

| Case(s) | Status         | e2e spec |
| ------- | -------------- | -------- |
| F1–F13  | ⛔ manual-only | —        |
| B1–B4   | ⛔ manual-only | —        |

Legend: ✅ fully automated · 🔶 partially automated · ⛔ manual-only (no spec).

## Functional tests

| ID  | Test                         | Steps (route + control)                                                                                                                                                                                                                                                                         | Expected (verifiable)                                                                                                                                                                                             |
| --- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Hub renders                  | `/dashboard/{org}/apps`                                                                                                                                                                                                                                                                         | Header **Apps** (`apps.title`). With no installed app: EmptyState **No apps yet** (`apps.empty.title`) + **Installed packs appear here as apps.** (`apps.empty.description`)                                      |
| F2  | App detail (not present)     | `/dashboard/{org}/apps/issue-desk`                                                                                                                                                                                                                                                              | Breadcrumb **Apps / App not found**; EmptyState **App not found** (`apps.notFound.title`) + **This pack is not installed.** (`apps.notFound.description`); no console error                                       |
| F3  | Breadcrumb back-link         | On `/dashboard/{org}/apps/{slug}`, click **Apps** in the breadcrumb (the `<Link to /dashboard/$id/apps>`)                                                                                                                                                                                       | URL returns to `/dashboard/{org}/apps`                                                                                                                                                                            |
| F4  | Install (org-scoped)         | (env-gated) Hub → **Install** (`apps.install.install`) on a no-requirements org app                                                                                                                                                                                                             | Card badge flips to **Installed** (`apps.install.installed`); persists on reload                                                                                                                                  |
| F5  | Install wizard (project app) | (env-gated) App detail of a project-scoped app → **Install** → wizard **Set up {name}** (`apps.installWizard.title`) → **Project** step (`apps.installWizard.projectStepLabel`) pick a project → **Next** (`common.actions.next`) → **Install** step → **Finish** (`apps.installWizard.finish`) | Navigates to `/dashboard/{org}/projects/{projectId}/apps/{slug}`; app bound to that project (membership row persists on reload)                                                                                   |
| F6  | Org views (org-scoped app)   | (env-gated) `/dashboard/{org}/apps/{slug}` for an installed org-scoped app                                                                                                                                                                                                                      | The app's views render (tabbed shell or flat); a lifecycle ⋯ menu (`apps.install.menuLabel`) sits on the first view                                                                                               |
| F7  | Membership hub (project app) | (env-gated) `/dashboard/{org}/apps/{slug}` for an installed project-scoped app                                                                                                                                                                                                                  | **Projects** section (`apps.membership.title`); **Add to a project** (`apps.membership.addProject`); each bound project links to `…/projects/{projectId}/apps/{slug}`                                             |
| F8  | Add to a project             | (env-gated) Membership hub → **Add to a project** → wizard project step → **Finish**                                                                                                                                                                                                            | New membership row appears and persists on reload                                                                                                                                                                 |
| F9  | Readiness checklist          | (env-gated) Installed app whose required integration is unconnected                                                                                                                                                                                                                             | Warning Alert **Finish setup** (`apps.readiness.title`) with **Connect** (`apps.readiness.connectButton`) per missing integration                                                                                 |
| F10 | Reinstall                    | (env-gated) ⋯ menu → **Reinstall** (`apps.install.reinstall`) → confirm dialog **Reinstall app** (`apps.install.reinstallTitle`) → **Reinstall**                                                                                                                                                | Toast **App reinstalled** (`apps.install.reinstalled`); app still installed (badge unchanged on reload)                                                                                                           |
| F11 | Remove from project          | (env-gated) Inside a bound project: ⋯ → **Remove from project** (`apps.install.removeFromProject`) → confirm **Remove from this project?** (`apps.install.removeFromProjectTitle`)                                                                                                              | Membership row gone on reload; org-level install + other projects unaffected                                                                                                                                      |
| F12 | Run detail (DAG)             | `/dashboard/{org}/apps/{slug}/runs/{executionId}?wf={workflowSlug}`                                                                                                                                                                                                                             | **← Back to app** link (visible label "Back to app") returns to `/dashboard/{org}/apps/{slug}`; with an installed workflow the DAG renders, else **This workflow has no steps.** (`apps.workflow.none`)           |
| F13 | Project-scoped app route     | `/dashboard/{org}/projects/{projectId}/apps/issue-desk`                                                                                                                                                                                                                                         | Renders **inside the project shell** (project tab strip visible). Bound + installed → app views; not bound → **Not added to this project** (`apps.membership.notInProjectTitle`); unknown app → **App not found** |

## Boundary & error tests

| ID  | Test                      | Input                                                                                                                                                                        | Expected                                                                                                           |
| --- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| B1  | Unknown app slug          | `/dashboard/{org}/apps/does-not-exist`                                                                                                                                       | EmptyState **App not found** (`apps.notFound.title`); HTTP 200, no error boundary, no console error (verified)     |
| B2  | Run detail without `wf`   | `/dashboard/{org}/apps/{slug}/runs/{executionId}` (no `?wf=`)                                                                                                                | Page renders with the **Back to app** link and an empty DAG region — no crash (verified)                           |
| B3  | Uninstall blocked by bind | (env-gated) ⋯ → **Uninstall** while ≥1 project still has the app bound                                                                                                       | Blocked up front with toast **Remove the app from its {count} project(s)…** (`apps.install.uninstallBlockedCount`) |
| B4  | Uninstall confirm         | (env-gated) ⋯ → **Uninstall** (no bindings) → delete dialog **Uninstall app** (`apps.install.uninstallTitle`) with warning (`apps.install.uninstallWarning`) → **Uninstall** | App removed from the org; hub shows the empty state again on reload                                                |

## Accessibility (WCAG 2.1 AA)

| ID  | Check                | Expected                                                                                                                    |
| --- | -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| A1  | Hub cards            | Each card is a link with an accessible name = the app name (`aria-label={app.name}`)                                        |
| A2  | Lifecycle ⋯ menu     | Trigger has an accessible name **Manage {name}** (`apps.install.menuLabel`); keyboard-operable                              |
| A3  | Install wizard steps | Progress is a labelled region **Setup steps** (`apps.installWizard.stepsAriaLabel`); Back/Next/Finish reachable by keyboard |
| A4  | Breadcrumb back-link | The breadcrumb **Apps** segment is a focusable link with a visible focus ring                                               |

## Performance

| ID  | Metric            | Target                                                                                 |
| --- | ----------------- | -------------------------------------------------------------------------------------- |
| P1  | Hub first render  | EmptyState / grid visible < 1.5 s after navigation (mode A, local self-hosted backend) |
| P2  | App detail render | Detail content (views / not-found / hub) visible < 1.5 s (mode A, local backend)       |
| P3  | Run-detail open   | Back-link + DAG region visible < 1.5 s (mode A, local backend)                         |

## Issues Found

| #   | Test ID | Route / URL                                   | Severity | Description                                                                                                                                                                        | Screenshot                                 |
| --- | ------- | --------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 1   | F12     | `/dashboard/{org}/apps/{slug}/runs/{id}?wf=…` | low      | The "Back to app" link has no i18n key — the route uses `t('runs.backToApp', { defaultValue: 'Back to app' })` but `apps.runs.backToApp` is MISSING; it won't localize.            | `apps/S5-run-withWf.png`                   |
| 2   | F1/F2   | `/dashboard/{org}/apps`, `/apps/{slug}`       | med      | No in-UI app catalog/discovery surface: the hub lists only _installed_ apps and the detail page 404s for an absent slug, so a fresh org can't find or install any app from the UI. | `apps/S1-hub.png`, `apps/S2-appdetail.png` |
| 3   | all     | all apps routes                               | low      | Coverage gap: the Apps marketplace (#1911) ships with zero e2e specs.                                                                                                              | —                                          |

## Test summary

```
Area: Apps
Functional: ___/13   Boundary: ___/4   A11y: ___/4   Perf: ___/3
Issues: 3 (crit 0 / high 0 / med 1 / low 2)
Status: PASS / FAIL
```
