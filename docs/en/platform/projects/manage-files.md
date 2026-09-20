---
title: Manage project files
description: Upload and organize reference files, check indexing, and understand the difference between deleting a file and moving it to Knowledge.
---

The project’s **Knowledge** tab holds files that its chats can retrieve. Upload a reference once and use it across conversations in that project. You need project edit access to add, organize, or remove files.

<Frame caption="Files belong to the project, and their indexing badges show whether chat can search their text.">

![The Knowledge tab of Website relaunch contains two indexed files, a New folder button, and file and folder upload controls.](/images/platform/project-knowledge-files.webp)

</Frame>

## Upload into the right folder

1. Open the project and select **Knowledge**.
2. Select a folder, or leave the root selected.
3. Click **Add file** or drop files onto the upload area.
4. Check that each file appears in the intended folder and finishes indexing.

**New folder** creates a folder at the root. A folder’s **New folder inside** action creates a subfolder. **Add folder** imports a folder from your device and recreates its structure under the selected location. A folder upload is limited to 200 files and 200 MB; split larger folders and check the report for skipped files.

## Check whether chat can read a file

| Status | Meaning and action |
| --- | --- |
| **Queued** | The file is waiting to be processed. |
| **Indexing…** | Tale is preparing its text for search. |
| **Indexed** | The text is searchable; verify a question against the original file. |
| **Failed** | Open the failure detail when available and use **Retry indexing**. Ask an admin if the failure returns. |
| **Not supported** | These contents cannot be indexed. Supply readable text or a supported format; retrying the same file cannot help. |
| **Not indexed** | The file is stored but not searchable. Use **Index now** when offered, or convert a format without a text extractor. |

An integration can upload a file without indexing it. Such a file is still visible in the tree; a supported plain-text file can be read directly when named, but it will not appear in text search until indexed.

Per-file and storage limits may be restricted further by organization policy. When an upload fails, first try a small supported file. An admin can check [Policies and limits](/platform/admin/governance/policies-and-limits), storage, and the embedding model.

## Ask about the files from a project chat

Open **Chats** in this project, start a chat, and ask about the file by name or topic. The assistant can retrieve this project’s files and the organization’s Knowledge documents that you can access. It cannot retrieve another project’s files from here.

The organization’s general chat does not search project files. Files also stay out of the organization’s document list and WebDAV library while they belong to the project. Project access determines who can read them; project files do not have separate team tags.

## Replace a controlled file without losing its review history

Uploading another file with the same name creates a separate document; a matching filename is not a revision link. For a file whose approval must remain tied to exact bytes, use the row menu’s **Mark as controlled** action.

A controlled record starts as a draft. **Replace file** updates a draft or opens the next draft from an approved version while preserving that approved version. **Submit for review** freezes the draft for the named reviewer. See [Controlled documents](/platform/knowledge/documents#revising-a-controlled-document) for the complete lifecycle and reviewer rules.

## Move to Knowledge or delete

**Remove from project** moves the file to the organization’s Knowledge library. It does not delete the file.

<Warning>

Removing a file from the project makes it visible to everyone in the organization. Use this only when you intend to publish it to that wider audience. Read the confirmation before proceeding.

</Warning>

To remove a file entirely, use **Delete** in its row menu and read the deletion confirmation. Folder deletion removes its contained files and subfolders as well as their search entries. These actions cannot be undone through the file tree. Legal holds and protected controlled records can block deletion.

**Delete** is offered for files uploaded here and for files an agent wrote into the project, such as readings or generated reports. A file synced from a connector offers no Delete in the project, because the next sync would restore it; remove it at its source instead.

If a file serves several unrelated projects, consider keeping an appropriately scoped copy in the [Knowledge library](/platform/knowledge/documents). Avoid maintaining several conflicting copies of the same policy.
