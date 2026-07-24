---
title: Project concepts
description: A project bundles chats, files, instructions, and tasks into one shared workspace. This page hands you the mental model for when to reach for a project over a stand-alone chat.
---

A project is the unit Tale reaches for when a body of work needs the same files, the same instructions, and the same working surfaces across many chats and many people. This page hands you the mental model — read it before you create your first project, and come back when you are deciding whether a growing chat should be promoted into one.

<Frame caption="The General tab — identity, sharing, and the stats strip are the project's front door.">

![The General tab of the Website relaunch project showing the name and description fields, the sharing section with an Org-wide owning team, and a stats strip reading two files, no chats, and Org-wide.](/images/platform/project-general-tab.webp)

</Frame>

## What a project owns

**Chats** started inside the project carry its context automatically. They stay yours until you flip **Share with project** on a chat — the Chats tab splits into **Your chats** and **Shared with project** accordingly. Sharing a chat hides your personal memories and instructions from the responses other members see.

**Instructions** are context that applies to every chat in the project — the framing, constraints, and vocabulary of the work — so nobody re-pastes them per chat.

**Files** on the **Knowledge** tab are reference material every chat in the project can draw on, held in a folder tree you upload into once rather than re-attaching per chat. They stay scoped to this project — they never surface in the org-wide library or in `@` pickers outside it — see [Manage files](/platform/projects/manage-files).

**Tasks** make the project a place to run work, not just talk about it: a board with statuses and [automation](/platform/projects/task-automation), with comment threads on every task for the decisions around it.

**Agents & models** is a curation surface: which agents and models members see first — or see at all — inside this project ([Agents and models](/platform/projects/project-agents)).

## Creating and identity

**Create project** asks for a name and a **Project key** — the prefix for task IDs like `WR-1`. The key is fixed; it cannot be changed after the project is created. Description, owning team, icon, and color are editable later on the **General** tab, where the unified **Save** and **Discard** buttons sit in the tab strip.

## Sharing model

Sharing is by team, not by individual invitation. A project defaults to **Org-wide**; picking an owning team scopes it to that team, and additional teams can be added on the General tab. Org admins always have access. Renaming, archiving, and deleting live in the row menu on the projects list — deleting asks what happens to the content: detach the files and chats (they become library documents and personal chats) or delete them too.

## When to reach for it

| Use … when                                    | Project | Stand-alone chat |
| --------------------------------------------- | ------- | ---------------- |
| The same files apply across many chats        | ✓       |                  |
| The same instructions apply across many chats | ✓       |                  |
| Multiple people work the same body of work    | ✓       |                  |
| The work has tasks, owners, and decisions     | ✓       |                  |
| The question is one-shot                      |         | ✓                |

A stand-alone chat is the right shape for exploring an answer once. The moment the context should outlive the chat, move it — the chat's **Move to project…** action carries an existing chat into a project.

## Where this fits

Projects are the seam where chats, knowledge, and task automation meet. The natural next read is [Use projects](/tutorials/member/use-projects), which walks a fresh project end to end; the per-tab pages in this section go deeper on [files](/platform/projects/manage-files) and [agents and models](/platform/projects/project-agents).
