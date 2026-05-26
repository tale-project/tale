---
title: Project concepts
description: A project is a shared workspace that bundles files, instructions, threads, and project-scoped agents. This page hands you the mental model for when to reach for a project over a stand-alone conversation.
---

A project is the unit Tale reaches for when a body of work needs the same files, the same instructions, and the same agents across many conversations. It is a shared workspace that bundles files, instructions, threads, and project-scoped agents — four things that follow you between conversations so you do not re-paste context every time.

This page hands you the mental model for when to reach for a project. Read it before you start one; come back when you are deciding whether to keep adding to a stand-alone conversation or promote the context to a project.

## The four pieces

**Files** are the project's working set — the documents, spreadsheets, and images you keep coming back to. Files are attached at the project level and visible to every conversation inside it, without the cost of re-uploading or re-retrieving.

**Instructions** are the project-level system prompt — the voice and constraints that apply to every conversation in the project. They compose with the agent's own instructions: project instructions frame the work, the agent's instructions frame the reply.

**Threads** are the conversations. Every conversation inside the project sees the project's files and instructions. Threads stay private to the project; they do not appear in the org-wide chat history.

**Project agents** are agents scoped to the project. They shadow the org-wide agents of the same name — when both exist, the project version wins inside the project. Use project agents for behaviour that would surprise readers outside the project.

## Sharing model

A project belongs to its creator by default; the creator can add members. Members see the project's files and threads but not threads that pre-date their membership unless explicitly shared. Removing a member removes their access on the next request; existing conversation transcripts they downloaded stay on their device.

## Putting it together — a sales-account project

A sales-account project bundles the artifacts a salesperson keeps coming back to for one customer:

- Files: the customer's contract, the proposal drafts, the call notes.
- Instructions: "You are working on the Acme account. Reference the call notes by date; cite the contract by section number."
- Threads: one for each deal stage — qualification, demo prep, proposal, negotiation.
- Project agents: a deal-summariser agent that knows the Acme voice, plus the org's default agents.

Every conversation in the project sees the same files and instructions; the salesperson opens a new thread per deal stage and the context follows.

## When to reach for it

| Use … when                                            | Project | Stand-alone conversation |
| ----------------------------------------------------- | ------- | ------------------------ |
| The same files apply across many conversations        | ✓       |                          |
| The same instructions apply across many conversations | ✓       |                          |
| Multiple people work the same body of work            | ✓       |                          |
| The conversation is one-shot                          |         | ✓                        |

Stand-alone conversations are the right shape when you are exploring an answer once. Projects are the right shape when the same set of context follows the work across many sessions.

## Build one

Projects are the seam between agents and conversations: the files, instructions, threads, and agents that travel together. The natural next read is [Use projects](/tutorials/member/use-projects) — it walks the four pieces end to end on a fresh project, from creation to the first reply that cites the project's files.
