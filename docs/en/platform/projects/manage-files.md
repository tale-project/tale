---
title: Manage Project files
description: Uploading, replacing, deleting, and the per-Project size limits — and how Project files surface in chats inside the Project.
---

A Project's **Files** tab is the shared file area every chat inside the Project can reach. Upload a file once and every chat in the Project — and every agent that runs inside it — can read it without re-uploading. This page covers the folder tree, the upload mechanic, and the limits.

The Files tab is not a knowledge base in the [Knowledge](/platform/knowledge/documents) sense. Its files are scoped to one Project and never appear in the org-wide library, in `@` pickers outside the Project, or over WebDAV; deleting the Project deletes the files. For org-wide reference material, use Knowledge and bind it to agents.

## Folders

Project files live in a folder tree. **New folder** creates a folder at the root; the folder-with-plus icon on a folder row creates a subfolder inside it. Click a folder to select it — the drop area switches to _Add file to "…"_ and uploads land inside. Deleting a folder deletes everything in it, including the files' entries in the knowledge index; the confirmation says so before anything happens. Folders here are Project-scoped: a same-named folder in the org-wide Knowledge library is a different folder.

## A worked upload

Open the Project, click **Knowledge**, select the target folder (or none for the root), and drag files onto the drop area. The row appears in the tree and resolves to **Indexed** once retrieval has picked it up. The same upload is now reachable from any chat the Project owns: send a message that references the topic and the agent retrieves it, or type `@` in the composer and pin the file — or a whole folder — to the turn.

## Replacing and deleting

Replacing a file uploads a new copy under the same name; the old version moves to the Project's version history. Citations from earlier chats keep pointing at the version that was active when the chat referenced it. Deleting a file removes it from the picker immediately; existing chats keep their citations but the underlying file is moved to [Trash](/platform/admin/governance/trash) with the rest of the Project's retention cohort.

## Size limits

Per-file and per-Project limits are set by the org under [Policies and limits](/platform/admin/governance/policies-and-limits). Hitting a per-file limit fails the upload with a toast; hitting a per-Project limit fails the upload with a different toast that names the policy. Members hitting a limit cannot raise it themselves — an Admin adjusts the policy or the Project owner deletes older files.

## Surfacing in chats

A chat started inside a Project automatically has access to every file in the Project's Files tab. The agent's retrieval tool sees Project files alongside any agent-bound Knowledge sources. Citations from Project files are scoped to the chat that produced them — sharing a chat outside the Project preserves the citations but the viewer cannot click through to the source unless they are also in the Project.

Pinning with `@` narrows a single turn: `@file` pins one file, `@folder` pins a folder and everything under it (the picker offers the Project's folders inside Project chats, and org-wide Knowledge folders everywhere). Pinned files are also delivered to the agent's sandbox under `/user/uploads`, so coding agents — Claude Code and the other terminal agents included — can open the actual bytes, not just quote retrieval snippets.

## Where this fits

Manage files is the operational page for the Files tab — the conceptual framing is on [Project concepts](/platform/projects/concepts), and the agent-bound equivalent across the whole org is [Documents](/platform/knowledge/documents). If you find yourself re-uploading the same files into many Projects, that is the signal to move them to Knowledge and bind an agent to them instead.
