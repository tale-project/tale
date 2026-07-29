---
title: Hand work to a worker
description: Ask the assistant for open-ended research, watch it spawn a focused worker, and follow the job card — live progress, the result, and the full transcript.
---

When a request deserves its own focused context — cited research, bulk extraction, a long draft — the assistant spawns a **worker**: an ephemeral agent composed for exactly that task, with exactly the capabilities the assistant grants it from its own set. There is nothing to configure; this walk runs one research job end to end and shows you how to read the job card.

The conceptual side (capability subsets, budgets, methodologies) lives in [Agent workers](/platform/agents/delegation).

## Before you begin

You need a chat-capable agent (the built-in Assistant works as-is) on a model with tool-calling support. For live web sources, connect a search connector such as Tavily under **Settings > Connectors** — without it the worker falls back to plain web fetching and says so in its result.

## Step 1 — Ask for something worth a worker

Open a chat with `Assistant` and ask for open-ended, citable work, for example: `Research the current state of solid-state batteries — market, key players, cited sources.` A quick factual question won't (and shouldn't) spawn anything; workers are for tasks that benefit from isolation.

## Step 2 — Watch the job card

The assistant calls `spawn_agent` and a **job card** appears under its turn: the worker's name, a live status, and the worker's own progress checklist filling in as it plans and works through sub-questions. The card never blocks the chat — you can keep typing while the worker runs.

If the card shows a "skipped" note, the assistant requested something outside its own grants (say, an unconnected connector); the run continues with what remains, and the note tells you what to connect for next time.

## Step 3 — Read the result and the transcript

When the job finishes, the assistant folds the worker's deliverable into its reply — for research, a conclusion, key points with inline citations, and sources. On the card, expand **worker activity** to see the full transcript: every search, every tool call, and the worker's reasoning. That transcript is the audit trail you point at when someone asks what the agent actually did.

## Step 4 — When something goes wrong

A worker that runs out of time or hits an error ends with a visible status on the card — `timed out` or `failed` — with its partial progress intact. The assistant reports what it got and continues itself where it can. Nothing fails silently: if the worker needed input only you can give, the assistant asks you directly.

## Where this fits

One request, one worker, one card is the smallest useful shape. The same mechanics scale to several workers in a turn — each gets its own card, its own progress, and its own transcript. For fixed stages with approvals or scheduling between them, reach for a [workflow](/platform/automations/concepts) instead.
