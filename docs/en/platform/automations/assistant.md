---
title: Automation assistant
description: The chat agent scoped to one automation — what it edits directly, what it drafts for you to apply, and how it finds existing automations before building a new one.
---

The **Automation assistant** is the chat agent pinned to whichever automation you opened — click **Assistant** on an automation's page and it answers with that automation's agents, workflow, skills, integrations, and configuration already in context. Admins and Developers use it to understand an unfamiliar automation, extend one instead of duplicating it, or get help authoring the pieces the automation page doesn't edit directly. It's the same assistant agent the [workflow editor](/platform/workflows/workflows) embeds, so a conversation started from one surface reads familiar from the other.

## What it edits directly

Workflows are the one piece the assistant has full tool access to: it reads the current definition, edits steps, saves a new version, and runs it, the same as if you'd clicked through the editor yourself. Agents are one step behind — it reads the roster and can install, enable, or disable one, but instructions, model, and the rest of an agent's configuration stay yours to edit in the agent editor; the assistant drafts the exact JSON and you paste it in.

## What it drafts instead

Skills, integrations, builtin views, and automation configuration have no editing tool at all: the assistant writes the definition per the matching write-skill or write-integration authoring skill and tells you exactly where to apply it — Settings > Integrations for a credential, the automation's own page for a view or its configuration. Install and setup work the same way: it walks the readiness checklist — connect what's required, fill in configuration, enable the agents and workflow — rather than doing the connecting itself.

## Finding what already exists

Before building anything, the assistant searches for an automation or bundle to extend rather than duplicate — the same reuse-first rule every write-\* skill enforces. Its search reaches automations the catalog itself hides: a bundle's hidden members (see [Automation concepts](/platform/automations/concepts)) are still visible to the assistant, so it can point you at, say, the PR Creator agent buried inside Resolve GitHub issues instead of proposing a new one.

## Where this fits

The Automation assistant is the fastest way into an automation you didn't build — ask it what something does before you touch it by hand. [Automation concepts](/platform/automations/concepts) is the vocabulary it assumes; [Browse and install](/platform/automations/catalog) is where you'd act on what it tells you if the automation isn't installed yet.
