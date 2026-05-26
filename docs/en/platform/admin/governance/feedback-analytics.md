---
title: Feedback analytics
description: Aggregated thumbs-up and thumbs-down on agent messages plus chat ratings, broken down per agent and per model. Admins and Owners read this when an agent regression needs a number behind it.
---

Feedback analytics is the dashboard that turns the per-message thumbs and the per-chat ratings into trend lines. Members leave the feedback inline in chat; this page aggregates it by agent, by model, and over time so the regression in last week's voice change is visible as a number, not a hunch. Admins and Owners read this page when a model swap looks like a downgrade, when one agent is underperforming the others, or when leadership wants the rough quality posture of every agent in the org.

## A worked drill-down

Open **Settings > Governance > Feedback** and the default view is the org-wide ratio across the last 30 days. Switch the breakdown to **By agent** to see the ratio per agent — sort by feedback volume to find the agents members are actually using, then click into one to see its model history alongside the same ratio over time. The split-by-model view is the same data sliced on the model that produced each rated reply.

## The two signals

**Thumbs feedback** is the per-message signal — a thumb up or thumb down on any agent reply. The thumb carries an optional free-text comment; the comment is per row and never aggregated into the ratio. Members can leave both, edit either, or withdraw entirely; the timeline reflects the latest state.

**Chat ratings** is the per-conversation signal — the one-to-five star rating that surfaces at the end of a conversation. Ratings carry an optional comment too. Chat ratings are coarser than thumbs and useful for tracking the agent-level vibe over many turns where individual thumbs would be noisy.

## Breakdowns

The dashboard slices by three dimensions:

- **Agent** — every agent in the org gets its own row with ratio, volume, and trend.
- **Model** — every model that produced a rated reply contributes; useful when you compare a primary against its fallback.
- **Time** — the trend is daily for the last 30 days and weekly for longer windows.

## Free-text comments

Comments are surfaced under the aggregated numbers as a list. Sort by recency or by sentiment; click through to the conversation in context to see what the rated reply was responding to. Comments are subject to the same retention policy as the conversations they belong to; if a thread is purged or trashed, its comments go with it.

## Where this fits

Feedback analytics is the pulse on every agent in the org — the place a regression in voice or model behaviour shows up before someone reports it. The companion is [usage analytics](/platform/admin/governance/usage-analytics) — the same agents and models, sliced by spend and token volume instead of quality.
