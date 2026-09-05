---
title: Feedback analytics
description: Aggregated thumbs-up and thumbs-down on assistant replies plus arena verdicts, broken down per assistant and per model.
---

Feedback analytics is the dashboard that turns the per-message thumbs and the arena verdicts into trend lines. Members leave the feedback inline in chat; this page aggregates it by assistant, by model, and over time so the regression in last week's voice change is visible as a number, not a hunch. Admins and Owners read this page when a model swap looks like a downgrade, when one assistant is underperforming the others, or when leadership wants the rough quality posture of every assistant in the org.

## A worked drill-down

Open **Settings > Metrics > Feedback** and the default view is the org-wide sentiment across the last 7 days — widen the period when the window is quiet. **Top Assistants by feedback** shows the helpful ratio per assistant with its volume, so the assistants members actually use stand out; filter to one and the sentiment trend and recent comments narrow with it. **Top Models by feedback** is the same data sliced on the model that produced each rated reply.

## The two signals

**Thumbs feedback** is the per-message signal — a thumb up or thumb down on any assistant reply. The thumb carries an optional free-text comment; the comment is per row and never aggregated into the ratio. Members can change their thumb or withdraw it entirely; the numbers reflect the latest state.

**Arena verdicts** is the per-comparison signal — when a member runs two models side by side in [arena mode](/platform/chat/arena-mode), the verdict lands here. The summary counts decisive votes, ties, and both-bad calls; **Top model matchups** keeps the per-pair head-to-head score, because an "A wins" only means something against the model it beat.

## Breakdowns

The dashboard slices by three dimensions:

- **Assistant** — every assistant with rated replies gets its own row with helpful and not-helpful counts and the resulting sentiment.
- **Model** — every model that produced a rated reply contributes; arena pairs stay head-to-head in the matchups table.
- **Time** — the sentiment-over-time chart follows the selected window, from a day to 90 days. Past 50,000 entries in a window the page shows partial results and asks you to narrow.

## Free-text comments

Comments are surfaced in the **Recent feedback** list under the aggregated numbers. Filter with **Comments only** to hide bare thumbs, and by type to separate chat thumbs from arena verdicts. Comments are subject to the same retention policy as the conversations they belong to; if a thread is purged or trashed, its comments go with it.

## Where this fits

Feedback analytics is the pulse on every agent in the org — the place a regression in voice or model behaviour shows up before someone reports it. The companion is [usage analytics](/platform/admin/governance/usage-analytics) — the same agents and models, sliced by spend and token volume instead of quality.
