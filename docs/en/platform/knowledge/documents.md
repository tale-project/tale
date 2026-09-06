---
title: Documents
description: The Documents tab is where Editors upload files into the knowledge base, watch them index, and manage their lifecycle.
---

The Documents tab is the knowledge base's file surface. Editors upload files, Tale runs each one through the indexing pipeline — extract the text, chunk it, embed the chunks, store them — and agents whose knowledge scope covers the document retrieve relevant passages at reply time and cite them. This page covers the operator side: uploading, the status column, team scoping, folders, and the document lifecycle.

<Frame caption="The Documents table — size, source, RAG status, and team scope per file.">

![The Knowledge area's Documents tab listing three uploaded text files and the three markdown documents behind the knowledge entries, with size, source, RAG status, and team columns.](/images/get-started/documents-list.webp)

</Frame>

## Uploading

Open **Knowledge > Documents** and click **Upload documents** — the menu offers **From your device**, **From Microsoft 365**, and **From Google Drive**. The upload gate accepts the formats that cover the bulk of org knowledge: PDF, Word (`.doc`, `.docx`), OpenDocument text (`.odt`), PowerPoint (`.ppt`, `.pptx`), Excel (`.xls`, `.xlsx`), CSV, plain text, and images (JPG, PNG, GIF, WEBP). Anything else is refused at upload.

Uploading and indexing are separate facts, and the **RAG status** column tracks the second one: **Indexing** while the pipeline runs, **Indexed** when agents can retrieve the content, **Failed** when the pipeline errored, and **Needs reindex** when the stored chunks are stale. Modern formats index; the legacy Office trio (`.doc`, `.xls`, `.ppt`) uploads and stays downloadable but shows **Not indexed** — agents cannot retrieve its content until you re-save it in the modern format.

## Revising a controlled document

Use a controlled document when approval must stay tied to the exact file that a reviewer saw. Replacing its draft updates the existing record; uploading another file with the same name still creates a separate document.

<Steps>

<Step title="Choose the controlled record">

For a regular upload, open the row menu and click **Mark as controlled**. It becomes `v1 · Draft`. An approved record offers both **Replace file** and **New revision**: use **New revision** only when you need the next draft without replacing its file.

</Step>

<Step title="Replace the current file">

Open the draft or approved record's row menu and click **Replace file**, then choose one file in the same format. A draft keeps its current revision. For an approved record, the dialog preserves approved vN and opens draft vN+1 only after the replacement succeeds; cancelling or a failed upload leaves vN approved. A legal hold blocks either path.

<Frame caption="The replacement dialog accepts one file in the record's existing format.">

![The Replace file dialog for a controlled text document, with a same-format file picker and a note that approved versions remain in history.](/images/platform/controlled-document-replace-file.webp)

</Frame>

</Step>

<Step title="Check and submit the revision">

Open the document preview and confirm that it shows the replacement. Then open the row menu and click **Submit for review**. The picker offers only members who can actually open the document — a project file needs project edit access — and never yourself: only the reviewer you name can approve or request changes, so every review is a second pair of eyes. The draft freezes while the reviewer decides on that exact file; the reviewer is notified in the bell and by email, and the decision comes back to you the same way — a request for changes carries the reviewer's feedback, which the submit dialog also shows before your next attempt. If the reviewer can no longer decide — they left the organization, were disabled, or lost access to the document — open the row menu and click **Change reviewer**: the pending request moves to the member you name, and the record stays frozen on the same file.

</Step>

</Steps>

## Importing from Microsoft 365

**From Microsoft 365** is always on the upload menu. The first time you use it, Tale asks you to authorize OneDrive and SharePoint for importing into Documents. If the dialog reports that import is not set up yet, an org admin first configures the OAuth app under **Settings > Connectors > OAuth apps** (or the operator registers one on the deployment) — an organization that signs in with Microsoft Entra ID can copy its SSO app registration there instead of registering a new one. After you connect, pick files or folders from **My OneDrive** or **SharePoint Sites**, then choose the import mode. **One-time import** brings the files in once — they behave like uploads from disk. **Sync import** keeps the selection synchronized: new files in the OneDrive folder appear on a later sync pass, changed files re-index, and files deleted at the source leave the workspace — when the synced folder or file itself is deleted at the source, Tale removes its mirror and ends the sync. Both modes preserve the folder structure of your selection. Sync covers personal OneDrive folders — a SharePoint selection always imports once. A folder that holds more items than one import can list is refused rather than imported in part — import its subfolders one at a time, or use a sync import.

To stop syncing — a whole synced folder or a single synced file — open the row's menu and click **Stop syncing**; the imported documents stay in the workspace and stop updating. Deleting a synced folder or file also stops its sync. In every case the originals in OneDrive are untouched.

## Importing from Google Drive

**From Google Drive** is always on the upload menu. The first time you use it, Tale asks you to authorize Google Drive for importing into Documents. If the dialog reports that import is not set up yet, an org admin first configures the OAuth app under **Settings > Connectors > OAuth apps** (or the operator registers one on the deployment). After you connect, pick files or folders from My Drive, then choose the import mode. **One-time import** brings the files in once — they behave like uploads from disk. **Sync import** keeps the selection synchronized: new files in the Drive folder appear on a later sync pass, changed files re-index, and files deleted at the source leave the workspace — when the synced folder or file itself is deleted or trashed in Drive, Tale removes its mirror and ends the sync. Both modes preserve the folder structure of your selection. Native Google Docs, Sheets, and Slides are skipped — export them to PDF or Office formats first if you need them in Documents.

To stop syncing — a whole synced folder or a single synced file — open the row's menu and click **Stop syncing**; the imported documents stay in the workspace and stop updating. Deleting a synced folder or file also stops its sync. In every case the originals in Google Drive are untouched.

Use **Disconnect Google Drive** in the import dialog header to revoke the grant; connect again when you want to import more.

## Scoping, folders, sources

Each row carries a **Teams** cell — **Organization-wide** by default, or the teams you pick via **Assign team** in the row menu. A team-scoped document is invisible to members and agents outside the team; this is the knowledge base's access lever. Project files are outside this model entirely: a project's **Knowledge** tab holds files scoped to that one project, and they never appear in this library or in its team scoping — see [Manage files](/platform/projects/manage-files).

**New folder** keeps large libraries navigable, and connectors bring their own structure: documents synced from OneDrive, SharePoint, or Google Drive land under sync folders and show their origin in the **Source** column, which keeps citations traceable to the upstream system.

<Warning>

Deleting a folder permanently deletes every file and subfolder inside it. Deleting a OneDrive or Google Drive sync folder also removes its auto-sync configuration and history — though never the files in OneDrive or Google Drive itself.

</Warning>

## Reindex and delete

**Reindex** (row menu) re-runs the pipeline on the stored file — the right move after an indexing failure or when a document shows **Needs reindex**. **Delete** removes the document and its indexed chunks; the confirmation says it plainly — the action cannot be undone. Re-uploading the same file brings the content back as a fresh document. A controlled record stops being deletable the moment any of its versions is approved — in review, approved, or drafting the next revision, the menu entry reads **Protected controlled record** instead, and a folder holding such a record refuses folder deletion the same way. The approved snapshot is a retained record; that is the point of the lifecycle.

Each document shows a status: **Queued** (waiting its turn — a busy organization indexes a few files at a time and the rest queue), **Indexing**, **Indexed**, **Failed**, or **Unsupported** (a legacy format such as `.doc`/`.ppt`/`.xls`, or an image such as `.png`/`.jpg` — it stores and downloads fine but has no text extractor, so it is never indexed for search). An indexing job interrupted by a timeout or a backend restart recovers on its own within a few minutes — it is retried or marked **Failed** with a retry option, never left stuck. If your organization enforces a per-user storage quota, failed and unsupported files still count against it until deleted, so freeing space means removing files you no longer need.

Clicking a document opens the preview, with a sidebar showing size, source, RAG status, teams, uploader, and modification date — the fastest way to check what a citation actually points at.

## Documents versus structured data

Documents are the unstructured half of the knowledge base. When the content is a list of things with the same fields — contacts, products, suppliers — a typed record serves agents better than a spreadsheet upload: exact values instead of retrieved passages. The decision rules live in [Structured data](/platform/knowledge/structured-data).

## Where this fits

Documents are the most-used corner of the knowledge base — most citations in most replies point here. The retrieval side — how the chat assistant and project agents read what is indexed here — is the [Knowledge overview](/platform/knowledge/overview); the fact-sized sibling surface is [Knowledge entries](/platform/knowledge/knowledge-entries), which rides this same pipeline one document at a time.
