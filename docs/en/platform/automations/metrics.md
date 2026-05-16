---
title: Automation metrics
description: A cross-automation dashboard of total runs, success rate, average duration, and top movers.
---

The **Automation metrics** dashboard rolls every automation in the organisation into one view: four headline numbers across the top, a runs-over-time trend, a status breakdown, and a top-automations table you can drill into. Open it when the question crosses automations rather than sits inside one — "did we break something with the deploy yesterday", "which automation grew ten times in volume after the process change", "what is on the long tail nobody actually uses". The audience is Admin and Developer, the same roles that can edit automations.

The dashboard lives at **Automations > Metrics**. It is empty until at least one automation has run; once runs land, the surface refreshes in near real time.

## The four headline numbers

The top of the page carries four cards.

| Card             | Reads                                                                           |
| ---------------- | ------------------------------------------------------------------------------- |
| **Total runs**   | Count of runs in the selected period.                                           |
| **Success rate** | Successful runs divided by total. Runs still in flight and cancelled ones drop. |
| **Avg duration** | Mean wall-clock duration of completed runs.                                     |
| **Failed runs**  | Count of runs that ended in failure.                                            |

The four together answer "is the system healthy this period". A success rate that slips while total runs hold steady points at a specific automation regressing; a success rate that holds while total runs collapse points at the trigger source going quiet.

## Trend and status

Below the cards, two charts split the period.

**Runs over time** is a daily series of completed, failed, and running runs across the selected window. The shape of the series — slow climb, weekly cycle, sudden spike — is the cue for which automation to open next.

**Status breakdown** is a donut of the share each terminal status takes across the period. A healthy mix is heavy on completed with a thin sliver of failed; a donut where failed is more than a few percent is the signal to drill in.

## Top automations

The table at the bottom ranks automations by run count and surfaces, for each, the success rate, average duration, failed-run count, and the timestamp of the most recent run. Click any row to jump straight to that automation's [Execution logs](/platform/automations/execution-logs) — the rank table is the cross-automation lens, the execution log is the per-run truth.

## Period and the cap

Switch between **Last 7 days**, **Last 30 days**, and **Last 90 days** from the period picker at the top right. The choice is reflected in the URL so a linked dashboard is reproducible.

Each query reads the most recent 5,000 runs in the window. When the cap is hit, a banner above the cards reads _"Showing the most recent 5,000 runs in this window. Older runs in this period are not included in these totals."_ — switch to a shorter window for a complete picture, or jump into the top-automations table and open each automation's execution log, which is not capped.

## Empty period

A period with no runs renders the empty state — a single line that reads **No workflow runs**, not zero-valued cards. The empty state is the cue to either widen the window or check that the triggers are firing at all; the natural next step from there is [Triggers](/platform/automations/triggers).

## Where this fits

Automation metrics is the cross-automation lens: the answer to "is anything broken" and "what changed since last week" without opening every automation individually. When a number changes, [Execution logs](/platform/automations/execution-logs) is the per-run truth — open the offending automation, find the failing run, read its journal. For LLM-cost trends that span both automations and chat together, [Usage analytics](/platform/admin/usage-analytics) is one tab over.
