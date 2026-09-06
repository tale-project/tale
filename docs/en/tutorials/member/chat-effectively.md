---
title: Chat effectively
description: Five habits that turn a chat from "thanks for the wall of text" into "exactly what I needed".
---

Chatting effectively in Tale is not about clever prompts; it is about giving the assistant enough to read your intent the first time — and knowing which work does not belong in a chat at all. Five small habits — asking instead of commissioning, picking the right model, feeding Knowledge instead of pasting, reading the thought timeline, and checking the sources — turn the average reply from "thanks for the wall of text" into "exactly what I needed". This page walks the habits in order on a fresh chat.

You need a Member role — the floor for chat. The conceptual side lives in [Chat basics](/platform/chat/basics); this walk is the daily-driver mechanic.

## Habit 1 — Ask; don't commission

Chat answers questions and retrieves material. It deliberately does not produce deliverables — ask for a presentation, a translated document, or a report, and the assistant sketches the short version and tells you to create a task instead. Work with that boundary rather than against it: when you catch yourself writing "create", "generate the file", or "translate this document", head for a task and assign it to an agent — you get an owner, a reviewable result, and a Done that a person controls. Translating a sentence you pasted is chat work; translating a file is task work.

## Habit 2 — Let Auto work; pin when you know better

The picker opens on **Auto**, which reads each message and matches a model to it — a quick lookup lands on a fast model, a long reasoning question on a strong one, and the reply's details name which one answered. That is the right default for most days. Pin a model from the list when you know something Auto cannot: the same model must answer a whole series, a specific model is the one being evaluated, or you want the reasoning-effort knob — the picker's second section, which appears for a pinned model that has one. Raise the effort for gnarly questions, and expect slower, costlier replies at the top level; hand the picker back to Auto when the series is done.

## Habit 3 — Feed Knowledge; don't paste walls

The assistant searches the organisation's knowledge — documents, knowledge entries, crawled websites, products, contacts — and its work, tasks and projects, and loads the full detail of what it finds. Work needs no feeding: it is already there because people run it here. That only works for material that is actually there: upload the price list or the policy document once under [Knowledge](/platform/knowledge/documents), and every future chat can find and cite it. Pasting a 200-page document into the message field fills the context budget and dilutes the answer; a specific question against uploaded material ("what does the refund policy say about opened boxes?") outperforms "tell me everything about refunds" every time.

## Habit 4 — Read the timeline, not just the answer

Above each reply, the thought timeline records what the assistant did: a collapsible thinking line, and one step row per search or page fetch — _Searching the workspace for "…"_, _Reading example.com_. Glance at it before trusting the answer. A reply with no search step behind a factual claim came from the model's own knowledge; a search step that reports nothing found tells you what is missing — including when a whole source is unavailable, such as documents not being searchable until an admin configures an embedding model. The timeline is also where a failed fetch says why, instead of the answer quietly working around it.

## Habit 5 — Check the sources before you forward the summary

Below an answer that read something, **Sources** lists exactly the pages and documents the assistant loaded — derived from what actually ran, so an empty list means nothing was read. Open one before you act on the reply: the two-minute habit of confirming a source per reply catches the small subset where the summary overreached. A web source opens the live page in a new tab; a document source names the file to find under Knowledge.

## Where this fits

Five habits, one chat, the same loop every time you open the Chat tab. The habits compound — asking inside chat's boundary keeps the answers crisp; fed Knowledge makes the searches land; the timeline and sources close the trust loop.

For the surface these habits live on, see [Chat basics](/platform/chat/basics). For the file side — what the assistant can search and cite — see [Knowledge](/platform/knowledge/overview).
