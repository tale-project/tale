# Metrics — Manual Test Plan

> **Purpose**: Exercise the org metrics section under Settings — six tabs
> (Usage, Feedback, Chat health, Harness turns, Automations, Projects), each
> with the shared period filter, KPI cards, charts, tables, and fresh-org
> empty states. Admin/owner-only (`orgSettings` read). Replaces settings.md
> F31's smoke case with depth.

## Scope & routes

The tabs come from one nav registry (labels `metrics.groups.*` — Usage /
Feedback / Chat health / Harness turns / Automations / Projects); on desktop
they render as the rail's **Metrics** disclosure group, on mobile as a tab
strip on the section route.

| Surface       | Route                                                        |
| ------------- | ------------------------------------------------------------ |
| Metrics index | `/dashboard/{org}/settings/metrics` (redirects to `…/usage`) |
| Usage         | `/dashboard/{org}/settings/metrics/usage`                    |
| Feedback      | `/dashboard/{org}/settings/metrics/feedback`                 |
| Chat health   | `/dashboard/{org}/settings/metrics/chat-health`              |
| Harness turns | `/dashboard/{org}/settings/metrics/external-turns`           |
| Automations   | `/dashboard/{org}/settings/metrics/automations`              |
| Projects      | `/dashboard/{org}/settings/metrics/projects`                 |

**Legacy redirects** (B2 asserts them): `/dashboard/{org}/automations/metrics`
→ `…/settings/metrics/automations`, `/dashboard/{org}/settings/governance/usage`
→ `…/settings/metrics/usage`, `/dashboard/{org}/settings/governance/feedback`
→ `…/settings/metrics/feedback` — each preserves the query string.

## Prerequisites

Bring the stack up and sign in per [SETUP.md](SETUP.md) as an **owner** (or
admin — developers and members are refused, B1). A brand-new org legitimately
shows every empty state; to populate the tabs in **mode A**, first send a few
chat turns (usage + chat health), rate a reply thumbs up/down and run an arena
comparison with a verdict (feedback — see [chat.md](chat.md)), and start an
automation **Test run** (see [automations.md](automations.md)). Harness-turn
data needs a sandboxed agent run (env-gated — mark F7's populated branch
**ENVIRONMENT** if unavailable). The Projects tab needs a project with tasks
and reads **daily rollups**, so figures may legitimately lag same-day
activity.

> **Agent note**: every tab is read-only — nothing to save. The period picker
> is not a standalone select: it lives inside the toolbar **Filter** button
> (`common.labels.filter`) as a **Period** section (`metrics.period.label`);
> open the popover to change it. The chosen period lands in the URL
> (`?period=…`) — assert state by URL + re-rendered figures, never by timing.
> Expected columns/cards below assert _labels_; the values depend on your seed
> traffic, so assert presence and plausibility (counts ≥ what you generated),
> not exact numbers.

## Automated coverage

`metrics.spec.ts` renders four of the six tabs (usage, feedback, automations,
projects) and asserts translated headers, toolbar, key tables, and no raw
i18n-key leaks — it never populates data, follows a redirect, or checks role
gating. Each analytics page has a component test with an axe audit
(`app/features/analytics/*/…-page.test.tsx`); the legacy redirects and period
schema are unit-tested
(`app/routes/dashboard/$id/settings/metrics/legacy-redirects.test.tsx`,
`app/components/metrics/metrics-period.test.ts`).

| Case(s)                  | Status         | e2e spec                                                                                |
| ------------------------ | -------------- | --------------------------------------------------------------------------------------- |
| F2 (usage renders)       | 🔶 partial     | `metrics.spec.ts` (header, filter button, Top Assistants, period section — empty data)  |
| F4 (feedback empty)      | 🔶 partial     | `metrics.spec.ts` (header + empty teaching panel only)                                  |
| F8 (automations renders) | 🔶 partial     | `metrics.spec.ts` (KPI labels, trend chart, table headers — empty data)                 |
| F9 (projects picker)     | 🔶 partial     | `metrics.spec.ts` (header + picker + no-project empty state)                            |
| F6, F7                   | 🔶 component   | — (no e2e; `chat-health-metrics-page.test.tsx`, `external-turns-metrics-page.test.tsx`) |
| B2                       | 🔶 component   | — (no e2e; `legacy-redirects.test.tsx` route unit tests)                                |
| F1, F3, F5, F10–F11      | ⛔ manual-only | —                                                                                       |
| B1, A1–A2, P1–P2         | ⛔ manual-only | —                                                                                       |

Legend: ✅ fully automated · 🔶 partially automated / component test only ·
⛔ manual-only (no spec).

## Functional tests

| ID  | Test                        | Steps (route + control)                                                                                                                                                       | Expected (verifiable)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F1  | Rail group & index redirect | Expand the settings rail's **Metrics** group; open `/dashboard/{org}/settings/metrics`                                                                                        | The group lists the six children in registry order — Usage / Feedback / Chat health / Harness turns / Automations / Projects (`metrics.groups.usage` … `metrics.groups.projects`); the bare index replaces the URL with `…/settings/metrics/usage`; on a narrow viewport the same six render as a tab strip on the section route                                                                                                                                                                                               |
| F2  | Usage tab renders           | `/dashboard/{org}/settings/metrics/usage`                                                                                                                                     | Header **Usage metrics** (`analytics.usage.title`); four KPI cards **Total Requests / Total Tokens / Total Cost / Active Users** (`analytics.usage.cards.*`); a trend chart section titled by the active metric; tables **Top Assistants** (`analytics.usage.tables.topAgents.title`), **Top Models**, **Top Voice Models**, **Per-User Usage** (`analytics.usage.tables.users.title`) — each showing rows or its empty state (`analytics.usage.empty.title` / `…emptyModels.title` / `…emptyVoiceModels.title`)               |
| F3  | Usage granularity & metric  | On usage, open **Filter** → **Granularity** (`analytics.usage.granularity.label`: Daily/Weekly/Monthly) and **Metric** (`analytics.usage.metric.label`: Requests/Tokens/Cost) | Switching the metric re-titles the chart section and (for Tokens) splits the chart into **Input** / **Output** (`analytics.usage.chart.inputTokens` / `…outputTokens`); the picks land in the URL search and survive reload; active drill-down filters render as chips (`analytics.usage.filterChips.agent` etc.) with **Clear filters** (`analytics.usage.filterChips.clear`)                                                                                                                                                 |
| F4  | Feedback tab                | `/dashboard/{org}/settings/metrics/feedback` — after rating at least one canned reply thumbs-down with a comment (mode A)                                                     | With zero feedback ever, the whole body is the teaching panel (`analytics.feedback.empty.title`); with data: cards **Sentiment / Helpful / Not helpful** (`analytics.feedback.cards.*`), the **Recent feedback** table (`analytics.feedback.recent.title`, columns Time/User/Type/Rating/Assistant/Model/Comment) filterable by **Type** (`analytics.feedback.kind.label`) and the **Comments only** switch (`analytics.feedback.commentsOnly`); your rating row is present with its comment                                   |
| F5  | Arena verdicts              | Same page, after an arena comparison with a decisive verdict and one tie (mode A, see [chat.md](chat.md))                                                                     | The **Arena verdicts** section (`analytics.feedback.arena.title`) shows **Decisive / Tie / Both bad** (`analytics.feedback.arena.cells.*`) matching what you cast; **Top Model Matchups** (`analytics.feedback.tables.topMatchups.title`) lists the pairing with its score; the recent table shows the verdict rows typed **Arena** (`analytics.feedback.recent.types.arena`)                                                                                                                                                  |
| F6  | Chat health tab             | `/dashboard/{org}/settings/metrics/chat-health` — after a few mode-A turns (include one `e2e:error` turn, see [chat.md](chat.md))                                             | Cards **Assistant turns / Error rate / Blocked rate / Guardrail events** (`analytics.chatHealth.cards.messages` / `…errorRate` / `…blockedRate` / `…guardrailEvents`); the **Turns over time** chart (`analytics.chatHealth.chart.trendTitle`); **Breakdown** (`analytics.chatHealth.breakdown.title`) by agent and model; **Errors** (`analytics.chatHealth.errorBreakdown.title`) listing the induced error; **Guardrails** (`analytics.chatHealth.guardrails.title`); a virgin org shows `analytics.chatHealth.empty.title` |
| F7  | Harness turns tab           | `/dashboard/{org}/settings/metrics/external-turns`                                                                                                                            | Header **Harness turns** (`analytics.externalTurns.title`); six KPI cards **Total turns / Success rate / Timeout rate / p95 duration / Stopped by user / Recovered** (`analytics.externalTurns.cards.*`, rates render `—` with no data); the **By harness** table (`analytics.externalTurns.byHarness.title`) or its empty line (`analytics.externalTurns.byHarness.empty`); populated figures need a sandboxed agent run — mark **ENVIRONMENT** if none is available                                                          |
| F8  | Automations tab             | `/dashboard/{org}/settings/metrics/automations` — after an automation Test run ([automations.md](automations.md))                                                             | Cards **Total runs / Success rate / Avg duration / Failed runs** (`analytics.automations.cards.*`); **Runs over time** (`analytics.automations.chart.trendTitle`) beside the **Status breakdown** donut (`analytics.automations.chart.statusTitle`); the **Top automations** table (`analytics.automations.table.title`) — clicking a row navigates to that automation's detail page; with no runs, `analytics.automations.empty.title`                                                                                        |
| F9  | Projects tab                | `/dashboard/{org}/settings/metrics/projects` → open **Filter** → **Project** (`metrics.projects.selectLabel`) → pick a project                                                | Without a pick the empty state reads **Select a project** (`metrics.projects.emptyTitle`); with one, the header stays **Project metrics** (`tasks.metrics.title`) and KPI cards **Completed / Avg cycle time / Intervention rate / Spend** (`tasks.metrics.completed` / `…cycleTime` / `…intervention` / `…cost`) render with the charts (cumulative flow, throughput, cycle-time trend, agent vs. human, daily spend); pre-rollup data shows `tasks.metrics.noData` — the pick lands in `?project=` and survives reload       |
| F10 | Shared period filter        | On any tab open **Filter** → **Period** (`metrics.period.label`) → switch between e.g. **Last 7 days** and **Last 30 days** (`metrics.period.last7Days` / `…last30Days`)      | The pick updates `?period=` and re-renders the figures; the option set varies by tab — feedback adds **Last 24 hours** and **All time** (`metrics.period.last24Hours` / `…allTime`), chat health caps at 30 days — and the choice does **not** leak across tabs (each tab keeps its own search params)                                                                                                                                                                                                                         |
| F11 | Feedback narrowing states   | On feedback with data: pick a period window that predates all feedback; then apply a filter matching nothing                                                                  | The period-empty alert (`analytics.feedback.periodEmpty.title`) offers **Show all time** (`analytics.feedback.periodEmpty.expand`) which widens the window in place; the filter-empty alert (`analytics.feedback.filterEmpty.title`) offers **Clear filters** — each recovers to the populated view without a reload                                                                                                                                                                                                           |

## Boundary & error tests

| ID  | Test                          | Input                                                                                                                                                                               | Expected                                                                                                                                                                                                                                                               |
| --- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Role gating                   | Sign in as a **developer** or **member** account; hit `/dashboard/{org}/settings/metrics/usage` directly                                                                            | The rail shows no **Metrics** group; the direct URL renders the access-denied message (`accessDenied.organization`) after the ability loads — never a partial page or raw error                                                                                        |
| B2  | Legacy redirects & bad params | Open `/dashboard/{org}/automations/metrics?period=90`, `/dashboard/{org}/settings/governance/usage`, `/dashboard/{org}/settings/governance/feedback`; then a tab with `?period=999` | The first lands on `…/settings/metrics/automations` **keeping** `?period=90`; the governance pair land on `…/metrics/usage` / `…/metrics/feedback`; an out-of-range `period` value falls back to the tab's default (the page renders normally, no crash) — never a 404 |

## Accessibility (WCAG 2.1 AA)

| ID  | Check          | Expected                                                                                                                                                                                                                                       |
| --- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Filter popover | The toolbar **Filter** button is keyboard reachable; the popover's Period/Granularity/Project sections are operable by keyboard and Escape closes returning focus; each tab page titles itself with a real heading (the `h3` the spec asserts) |
| A2  | Charts & cards | KPI trend indicators are conveyed by text/number, not color alone; chart empty states render text (`analytics.automations.chart.noData` etc.); data tables are real tables with column headers (axe-clean per the component tests)             |

## Performance

| ID  | Metric           | Target                                                                                         |
| --- | ---------------- | ---------------------------------------------------------------------------------------------- |
| P1  | Tab first render | Each tab renders content or its empty state in < 3 s on the mock stack — no unbounded skeleton |
| P2  | Period switch    | Re-render after a period change in < 2 s on seeded mock data                                   |

## Issues Found

| #   | Test ID | Route / URL | Severity (crit/high/med/low) | Description | Screenshot |
| --- | ------- | ----------- | ---------------------------- | ----------- | ---------- |
|     |         |             |                              |             |            |

## Test summary

```
Area: Metrics
Functional: ___/11   Boundary: ___/2   A11y: ___/2   Perf: ___/2
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
