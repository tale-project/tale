---
title: Start from a starter
description: Create a working automation from a starter by answering a few questions, start it at once, and see what each starter does.
---

A starter is an automation Tale ships ready to work. You answer a few questions — the project it serves, whom it tells, when it runs — and Tale creates it as your own automation, which you change like any other. Only the Owner, Admin and Developer roles create automations.

## Create one

1. Open **Automations** and select **Create automation** › **From a starter**.
2. Pick a starter. Its page says what it does, what starts it and which steps it runs.
3. Answer its questions. **Name** starts as the starter's name; change it to tell your automations apart.
4. Leave **Start it now** on to deploy version 1 and turn its trigger on at once. Turned off, the automation is created as a draft that you deploy from the [editor](/platform/automations/editor).
5. Select **Create automation**. The new automation opens in the editor.

<Frame caption="Each starter says in one line what it does.">

![The Choose a starter dialog with a search field and six starters: Answer questions from your documents, Create tasks from a webhook, Daily task digest, Summarize the inbox, Tell the reviewer and Triage new tasks, each with a one-line description.](/images/platform/automation-starter-gallery.webp)

</Frame>

<Frame caption="Tell the reviewer, answered for the project Website relaunch and the reviewer Priya Raman.">

![The Tell the reviewer dialog: what the starter does, How it works with its two steps, the Name, the Project Website relaunch, the Reviewer Priya Raman, the Message, Start it now checked and the Create automation button.](/images/platform/automation-starter-setup.webp)

</Frame>

From a project's own **Automations** list, a starter that serves a project starts with that project picked, and the new automation opens in the project.

A starter that a webhook starts shows its address once, right after the automation is created. Copy it before you select **Open the automation**: only a hash of its token is kept, so a lost address can only be replaced with **Rotate token** — see [Receive a webhook](/platform/automations/triggers#receive-a-webhook).

When Tale cannot use an answer — a project you cannot open, or someone who is not a member of the organization — the question says why, and nothing is created. A name another automation already has is refused as well; choose a different one.

## The starters

| Starter | Starts | What it does |
| --- | --- | --- |
| **Answer questions from your documents** | When a task is created in the project | For a task whose title ends with a question mark, it searches the organization's documents and comments an answer drawn only from what it found, naming its sources. Other new tasks are left alone. |
| **Create tasks from a webhook** | On each delivery to its webhook address | Creates a task in the project: the `title` in the delivery's JSON names it, and its `description` adds the text. A delivery without a title is refused and creates nothing. |
| **Daily task digest** | On its schedule — every day at 09:00 in your time zone, unless you change it | Lists the tasks created in the project during the 24 hours before the run and sends them to the member you choose as one message, a line each, with a link to the project's tasks. A day without new tasks sends nothing. |
| **Summarize the inbox** | On its schedule — weekdays at 08:00 in your time zone, unless you change it | Summarizes the conversations of the mailbox you pick that still wait for an answer, one line each, most urgent first, and sends the summary to the member you choose. |
| **Tell the reviewer** | When a task of the project changes status | When the task moves to **In review**, it tells the member you choose, with a link to the task. |
| **Triage new tasks** | When a task is created in the project | Comments a suggested priority and a first step on the task, in the task's language. Nothing else on the task changes. |

Messages from **Daily task digest**, **Summarize the inbox** and **Tell the reviewer** arrive in the member's notifications, and by email when their settings send one; [Notify members](/platform/automations/notify-members) explains who is skipped. A starter names a model for its language model steps: when none of your providers serves it, each such step gets a comparable model they do serve, and the message of version 1 says which.
