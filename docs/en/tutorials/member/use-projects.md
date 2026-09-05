---
title: Use projects to bundle files and chats
description: Turn a one-off chat into a shared workspace that keeps the same files, instructions, and conversations together.
---

A project is what you reach for the second time you find yourself pasting the same context into a chat. It bundles files, instructions, and chats around one body of work — a contact, a launch, a long investigation — so every new conversation starts with the context already loaded. This walk takes a fresh project from "I keep re-uploading the same brief" to "every chat inside this project already knows the brief" on one instance.

You need a Member role (the floor for creating projects) and three or four files you keep referencing. The conceptual side lives in [Project concepts](/platform/projects/concepts); this walk is the end-to-end mechanic.

## Before you begin

Confirm two things. Your role is at least Member — project creation is gated to Member and above. You have three to four files that recur across the chats you have been having — a brief, a transcript, a price list, a policy. Those become the project's working set.

## Step 1 — Create the project

The project is the container the rest of the pieces live in. Open **Projects > New project** and set:

- **Name** — `Acme account` (or whatever names the body of work)
- **Description** — one sentence on what the project is for
- **Members** — leave it private for now; you can add teammates after the first chat works

Save. The project appears in the sidebar; clicking it opens the **Tasks** board, with tabs for General, Chats, Knowledge, and Agents.

## Step 2 — Upload the files once

The project's files are visible to every chat inside the project, so this upload happens once and pays back on every later chat. Open the **Knowledge** tab and drag in the three or four files you confirmed in the prerequisites.

Each file lands in the project's storage and indexes the same way a knowledge-base document does. Once the status is **Ready**, the files are reachable by any chat started inside the project.

## Step 3 — Add project instructions

Project instructions frame every chat in the project. They compose with the agent's own instructions: the project frames the work, the agent frames the reply. Open the **Instructions** tab and set:

`You are working on the Acme account. The contract and the call notes in the Knowledge tab are the source of truth; cite them when you make a claim. The contact's voice is conservative — drafts should not promise dates we have not confirmed.`

Save. Every new chat in the project will now run with this preamble in addition to the agent's own instructions.

## Step 4 — Start a chat and verify the context follows

Open the **Threads** tab and click **New chat**. Leave the model picker on **Auto** — there is no agent to pick in chat — and ask a question one of the project's files answers (`What does the contract say about the renewal clause?`). The reply should cite the contract; the citation opens the file from the project's Knowledge tab, not from the org-wide library.

If the assistant answers without citing, the file was not retrieved — usually because indexing has not finished. Check that its row on the **Knowledge** tab reads **Indexed**, then ask again.

## Where this fits

A project with files, instructions, and threads is the smallest useful unit of shared context in Tale. The same shape scales — add members so a team works the project together, add a project-scoped agent so the voice is locked in, archive the project when the work ships.

For the deeper model of what a project is and when to reach for one, see [Project concepts](/platform/projects/concepts). For project-scoped agents, see [Project agents](/platform/projects/project-agents).
