---
title: Agent categories
description: A short tag on an agent that groups it in the chat picker and the org's agents list — defined per org, optional per agent.
---

A **category** is a short tag on an agent — `Sales`, `Support`, `Marketing`, `Engineering` — that groups it in the chat picker and the org's agents list. Categories are an organisational sorting tool, not a permission boundary; an agent's role-based access is unchanged by the category it carries.

This page is short on purpose — categories are a small mechanic. The richer machinery sits one tab over on the org's settings.

## Setting a category

Open the agent and look on the **Instructions & model** tab; the category field is a single-select dropdown. Pick a category and save; the agent appears under that category in the picker the next time someone opens it. An agent without a category sits in a default bucket at the bottom of the list.

## Where categories are defined

The list of categories is org-wide and lives under the org's settings. Admins can add or rename categories; renaming a category cascades to every agent that used it. Removing a category leaves agents that used it in the default bucket — no agents are deleted.

## Where this fits

Categories are the lightest available grouping for agents — they sort the picker, nothing more. Larger separations (Project agents versus org agents, per-team allowlists) live on [Project agents](/platform/projects/project-agents) and [Policies and limits](/platform/admin/governance/policies-and-limits) respectively.
