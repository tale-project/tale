---
title: Manage Project files
description: Uploading, replacing, deleting, and the per-Project size limits — and how Project files surface in chats inside the Project.
---

A Project's **Files** tab is the shared file area every chat inside the Project can reach. Upload a file once and every chat in the Project — and every agent that runs inside it — can read it without re-uploading. This page covers the upload mechanic and the limits.

The Files tab is not a knowledge base in the [Knowledge](/platform/knowledge/documents) sense. It is a flat list of files scoped to one Project; deleting the Project deletes the files. For org-wide reference material, use Knowledge and bind it to agents.

## A worked upload

Open the Project, click **Files**, and drag a folder onto the drop area. Tale uploads each file individually; the row shows a per-file progress bar and resolves to **Uploaded** once the file lands. The same upload is now reachable from any chat the Project owns: type `@` in the composer and the file appears in the picker, or send a message that references the topic and the agent retrieves it.

## Replacing and deleting

Replacing a file uploads a new copy under the same name; the old version moves to the Project's version history. Citations from earlier chats keep pointing at the version that was active when the chat referenced it. Deleting a file removes it from the picker immediately; existing chats keep their citations but the underlying file is moved to [Trash](/platform/admin/governance/trash) with the rest of the Project's retention cohort.

## Size limits

Per-file and per-Project limits are set by the org under [Policies and limits](/platform/admin/governance/policies-and-limits). Hitting a per-file limit fails the upload with a toast; hitting a per-Project limit fails the upload with a different toast that names the policy. Members hitting a limit cannot raise it themselves — an Admin adjusts the policy or the Project owner deletes older files.

## Surfacing in chats

A chat started inside a Project automatically has access to every file in the Project's Files tab. The agent's retrieval tool sees Project files alongside any agent-bound Knowledge sources. Citations from Project files are scoped to the chat that produced them — sharing a chat outside the Project preserves the citations but the viewer cannot click through to the source unless they are also in the Project.

## Where this fits

Manage files is the operational page for the Files tab — the conceptual framing is on [Project concepts](/platform/projects/concepts), and the agent-bound equivalent across the whole org is [Documents](/platform/knowledge/documents). If you find yourself re-uploading the same files into many Projects, that is the signal to move them to Knowledge and bind an agent to them instead.
