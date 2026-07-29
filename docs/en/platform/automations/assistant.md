---
title: Automation assistant
description: The chat agent scoped to one automation — what it edits directly, what it drafts for you to apply, and how it finds existing automations before building a new one.
---

The **Automation assistant** is the chat agent scoped to one automation, answering with that automation's document, its agents, its skills and its connectors already in context. Admins and Developers use it to understand an automation they did not build, extend one instead of duplicating it, or get help authoring the pieces the automation's own page does not edit. Ask it what something does before you touch it by hand, because it reads the whole document at once rather than one node at a time.

## What it edits directly

The automation's own document is the one piece the assistant has full tool access to: it reads the current version, edits nodes, validates the result, saves a new version, and runs it against mocks — the same acts you would perform by hand, in the same order. It works within the same rules you do, so a save appends a version rather than editing one, and the version that is live stays live until somebody deploys. Agents are one step behind: it reads the roster and can install, enable, or disable one, but instructions, model, and the rest of an agent's configuration stay yours to edit in the agent editor, with the assistant drafting the exact JSON for you to paste in.

## What it drafts instead

Skills, connectors, and builtin views have no editing tool at all: the assistant writes the definition per the matching authoring skill and tells you exactly where to apply it — Settings > Connectors for a credential, the automation's own page for a view. Install and setup work the same way: it walks the readiness checklist, naming what still needs connecting and what still needs enabling, rather than doing the connecting itself.

The same boundary applies to triggers. The assistant can tell you which schedule, webhook, or event trigger an automation carries and what each one would send into a run, and it can spell out the trigger you want — but the decision to expose an automation to the outside world stays a human one. [Automation triggers](/platform/automations/triggers) covers what each kind does.

## Finding what already exists

Before building anything, the assistant searches for an automation or bundle to extend rather than duplicate — the same reuse-first rule every write-\* skill enforces. Its search reaches automations the catalog itself hides: a bundle's hidden members (see [Automation concepts](/platform/automations/concepts)) are still visible to the assistant, so it can point you at, say, the PR Creator agent buried inside Resolve GitHub issues instead of proposing a new one.

## Where this fits

The Automation assistant is the fastest way into an automation you didn't build — ask it what something does before you touch it by hand. [Automation concepts](/platform/automations/concepts) is the vocabulary it assumes; [Browse and install](/platform/automations/catalog) is where you'd act on what it tells you if the automation isn't installed yet.
