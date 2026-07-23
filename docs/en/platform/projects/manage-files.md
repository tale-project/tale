---
title: Manage project files
description: The project's Knowledge tab holds the files every chat in the project can draw on — folders, uploading, index status, pinning, and how project files stay scoped to the project.
---

A project's **Knowledge** tab is the shared file area every chat inside the project can reach. Upload a file once and every chat in the project — and every agent that runs inside it — can read it without re-uploading. This page covers the folder tree, the upload mechanic, pinning, and the limits.

The Knowledge tab is not the org-wide knowledge base in the [Documents](/platform/knowledge/documents) sense. Its files are scoped to one project and never appear in the org-wide library, in `@` pickers outside the project, or over WebDAV; deleting the project deletes the files. For org-wide reference material, use [Documents](/platform/knowledge/documents) and bind it to agents.

<Frame caption="The Knowledge tab — the project's file tree, every file scoped to this project and indexed for retrieval.">

![The Knowledge tab of the Website relaunch project showing two indexed files in the file tree, a New folder button, and the Add file dropzone.](/images/platform/project-knowledge-files.webp)

</Frame>

## Folders

Project files live in a folder tree. **New folder** creates a folder at the root; the folder-with-plus icon on a folder row creates a subfolder inside it. Click a folder to select it — the drop area switches to _Add file to "…"_ and uploads land inside. Deleting a folder deletes everything in it, including the files' entries in the retrieval index; the confirmation says so before anything happens. Folders here are project-scoped: a same-named folder in the org-wide library is a different folder.

## A worked upload

Open the project, click **Knowledge**, select the target folder (or none for the root), and drag files onto the drop area. The row appears in the tree and resolves to **Indexed** once retrieval has picked it up. The same upload is now reachable from any chat the project owns: send a message that references the topic and the agent retrieves it, or type `@` in the chat and pin the file — or a whole folder — to the turn.

## Replacing and deleting

Replacing a file uploads a new copy under the same name; the earlier version moves to the project's version history. Citations from earlier chats keep pointing at the version that was active when the chat referenced it. Deleting a file removes it from the picker immediately; existing chats keep their citations, but the underlying file moves to [Trash](/platform/admin/governance/trash) with the rest of the project's retention cohort.

## Size limits

Per-file and per-project limits are set by the org under [Policies and limits](/platform/admin/governance/policies-and-limits). Hitting a per-file limit fails the upload with a toast; hitting a per-project limit fails it with a different toast that names the policy. Members hitting a limit cannot raise it themselves — an Admin adjusts the policy, or the project owner deletes older files.

## Surfacing in chats

A chat started inside a project automatically has access to every file in the project's Knowledge tab. The agent's retrieval tool sees project files alongside any agent-bound Knowledge sources. Citations from project files are scoped to the chat that produced them — sharing that chat outside the project preserves the citations, but the viewer cannot click through to the source unless they are also in the project.

Pinning with `@` narrows a single turn: `@file` pins one file, `@folder` pins a folder and everything under it (the picker offers the project's folders inside project chats, and org-wide folders everywhere). Pinned files are also delivered to the agent's sandbox under `/user/uploads`, so sandbox agents — Claude Code and the other terminal agents included — can open the actual bytes, not just quote retrieval snippets.

## Where this fits

Manage files is the operational page for the Knowledge tab — the conceptual framing is on [Project concepts](/platform/projects/concepts), and the agent-bound equivalent across the whole org is [Documents](/platform/knowledge/documents). If you find yourself re-uploading the same files into many projects, that is the signal to move them to Documents and bind an agent to them instead.
