---
title: Documents
description: The Documents tab is where Editors upload files into the knowledge base, watch them index, and manage their lifecycle — upload sources, RAG status, team scoping, folders, and reindexing.
---

The Documents tab is the knowledge base's file surface. Editors upload files, Tale runs each one through the indexing pipeline — extract the text, chunk it, embed the chunks, store them — and agents whose knowledge scope covers the document retrieve relevant passages at reply time and cite them. This page covers the operator side: uploading, the status column, team scoping, folders, and the document lifecycle.

<Frame caption="The Documents table — size, source, RAG status, and team scope per file.">

![The Knowledge area's Documents tab listing three uploaded text files with size, source, RAG status, and team columns.](/images/get-started/documents-list.webp)

</Frame>

## Uploading

Open **Knowledge > Documents** and click **Upload documents** — the menu offers **From your device** and **From Microsoft 365**. The upload gate accepts the formats that cover the bulk of org knowledge: PDF, Word (`.doc`, `.docx`), OpenDocument text (`.odt`), PowerPoint (`.ppt`, `.pptx`), Excel (`.xls`, `.xlsx`), CSV, plain text, and images (JPG, PNG, GIF, WEBP). Anything else is refused at upload.

Uploading and indexing are separate facts, and the **RAG status** column tracks the second one: **Indexing** while the pipeline runs, **Indexed** when agents can retrieve the content, **Failed** when the pipeline errored, and **Needs reindex** when the stored chunks are stale. Modern formats index; the legacy Office trio (`.doc`, `.xls`, `.ppt`) uploads and stays downloadable but shows **Not indexed** — agents cannot retrieve its content until you re-save it in the modern format.

## Importing from Microsoft 365

**From Microsoft 365** imports from OneDrive or SharePoint instead of disk: pick files or folders, then choose the import mode. **One-time import** brings the files in once — they behave like uploads from disk. **Sync import** keeps the selection synchronized: new files in the OneDrive folder appear on a later sync pass, changed files re-index, and files deleted at the source leave the workspace. Both modes preserve the folder structure of your selection. Sync covers personal OneDrive folders — a SharePoint selection always imports once.

To stop syncing — a whole synced folder or a single synced file — open the row's menu and click **Stop syncing**; the imported documents stay in the workspace and stop updating. Deleting a synced folder or file also stops its sync. In every case the originals in OneDrive are untouched.

## Scoping, folders, sources

Each row carries a **Teams** cell — **Organization-wide** by default, or the teams you pick via **Assign team** in the row menu. A team-scoped document is invisible to members and agents outside the team; this is the knowledge base's access lever. Project files are outside this model entirely: a project's **Knowledge** tab holds files scoped to that one project, and they never appear in this library or in its team scoping — see [Manage files](/platform/projects/manage-files).

**New folder** keeps large libraries navigable, and connectors bring their own structure: documents synced from OneDrive or SharePoint land under sync folders and show their origin in the **Source** column, which keeps citations traceable to the upstream system.

<Warning>

Deleting a folder permanently deletes every file and subfolder inside it. Deleting a OneDrive sync folder also removes its auto-sync configuration and history — though never the files in OneDrive itself.

</Warning>

## Reindex and delete

**Reindex** (row menu) re-runs the pipeline on the stored file — the right move after an indexing failure or when a document shows **Needs reindex**. **Delete** removes the document and its indexed chunks; the confirmation says it plainly — the action cannot be undone. Re-uploading the same file brings the content back as a fresh document.

Each document shows a status: **Queued** (waiting its turn — a busy organization indexes a few files at a time and the rest queue), **Indexing**, **Indexed**, **Failed**, or **Unsupported** (a legacy format such as `.doc`/`.ppt`/`.xls` that stores and downloads fine but has no text extractor, so it is never indexed for search). An indexing job interrupted by a timeout or a backend restart recovers on its own within a few minutes — it is retried or marked **Failed** with a retry option, never left stuck. If your organization enforces a per-user storage quota, failed and unsupported files still count against it until deleted, so freeing space means removing files you no longer need.

Clicking a document opens the preview, with a sidebar showing size, source, RAG status, teams, uploader, and modification date — the fastest way to check what a citation actually points at.

## Documents versus structured data

Documents are the unstructured half of the knowledge base. When the content is a list of things with the same fields — contacts, products, suppliers — a typed record serves agents better than a spreadsheet upload: exact values instead of retrieved passages. The decision rules live in [Structured data](/platform/knowledge/structured-data).

## Where this fits

Documents are the most-used corner of the knowledge base — most citations in most replies point here. The retrieval side — how an agent's knowledge scope decides what it searches — is [Agent knowledge](/platform/agents/knowledge); the fact-sized sibling surface is [Knowledge entries](/platform/knowledge/knowledge-entries), which rides this same pipeline one document at a time.
