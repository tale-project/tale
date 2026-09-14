---
title: Documents
description: Upload shared reference files, check whether they can be searched, and keep imports and approved revisions current.
---

Use **Knowledge > Documents** for files that belong in the shared library: policies, guides, reports, and supporting evidence. Members read documents within their access; Editors and higher roles can upload and manage them. For material that belongs to one project, use that project's [Knowledge tab](/platform/projects/manage-files).

<Frame caption="The document list brings together the original file, its source, indexing status, and team access.">

![The Documents tab displays shared files with size, source, RAG status, and team columns.](/images/get-started/documents-list.webp)

</Frame>

## Upload from your device

1. Open **Knowledge > Documents** and the folder where the files should go. Use **New folder** if you need one.
2. Choose **Upload documents > From your device** and select the files.
3. Wait for the upload to finish, then find each row in the table.
4. Open a document to check its preview and details. Check the **RAG status** before asking the assistant about its content.

Use a descriptive filename and include a date or revision when it helps distinguish sources. Uploading another file with the same name creates a separate document; it does not replace the existing one.

## Understand upload and search support

A stored file and a searchable file are different states. Tale needs to extract text before it can index a document for knowledge search.

| Format | What to expect |
| --- | --- |
| PDF with embedded text, `.docx`, `.xlsx`, `.pptx`, `.odt`, CSV, plain text | Supported for text extraction and indexing. Check the result for the particular file. |
| Legacy Office `.doc`, `.xls`, `.ppt` | Can be stored and downloaded; convert to a modern format for indexing. |
| Images such as JPG, PNG, GIF, WEBP | Can be stored and downloaded; the knowledge index does not extract text from them. |
| Scanned PDF without readable text | Supply an OCR-processed or text version if search needs its content. |

Unsupported formats are not made searchable by repeatedly reindexing. For a question about an image, see [Chat attachments](/platform/chat/attachments), where an available vision model may read it directly.

## Read the indexing status

| Status | What it means and what to do |
| --- | --- |
| **Queued** | Waiting for an indexing slot. A busy library processes files in batches. |
| **Indexing** | Text is being prepared for search. Wait before testing the source. |
| **Indexed** | Indexing completed. Test a specific question and open its citation. |
| **Needs reindex** | The index is stale. Choose **Reindex** in the row menu. |
| **Failed** | Inspect the error, resolve its cause, then retry. |
| **Unsupported** | This format has no supported text extractor. Convert the source. |
| **Not indexed** | No completed index is available. Check the file and start indexing where offered. |

Interrupted jobs recover in the background or report a failure with a retry option. If a status does not progress, give an administrator the document name and error. They can check indexing services and the embedding configuration. Failed and unsupported files still use storage until removed.

## Choose who can read it

Library documents default to **Organization-wide**. Use **Assign team** in the row menu to restrict a document to the chosen teams. These restrictions also apply to knowledge retrieval; an agent cannot make an inaccessible document visible through search.

Folders organize the library. Check the **Teams** cell for access and the **Source** column for where a file came from. Project files are a separate scope and do not appear in this library. See [Knowledge](/platform/knowledge/overview) when deciding where to keep a source.

## Import from Microsoft 365 or Google Drive

Choose **From Microsoft 365** or **From Google Drive** under **Upload documents**. On first use, connect your account and authorize the import. If Tale reports that import is not configured, an administrator must set up the service under [Connectors](/platform/admin/connectors) before you can continue.

Select files or folders, then choose the import mode:

| Mode | Result |
| --- | --- |
| **One-time import** | Copies the selection once and preserves its folder structure. Later source changes do not update the copy. |
| **Sync import** | Keeps the supported selection current. New files arrive on a later sync; changed files reindex; deleted source files are removed from the mirror. |

For Microsoft 365, choose **My OneDrive** or **SharePoint Sites**. Sync is available for personal OneDrive folders; SharePoint selections import once. For Google Drive, select from My Drive. Native Google Docs, Sheets, and Slides are skipped: export them to PDF or Office formats first.

If a folder is too large to list completely, Tale refuses that import. Select smaller subfolders or use sync where supported. If the selected source folder or file is deleted, its mirror is removed and the sync ends.

To keep the imported files without further updates, use **Stop syncing** on the file or folder row. Deleting the imported item also stops its sync. These actions leave the originals in OneDrive or Google Drive untouched. **Disconnect Google Drive** in the import dialog revokes that connection; reconnect when you need to import again.

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

## Delete with the contents in mind

**Delete** removes the document and its indexed content. The confirmation explains the impact; keep a copy if you will need the file later. Re-uploading creates a new document.

<Warning>

Deleting a folder permanently deletes its files and subfolders. For a synced folder, it also removes the sync configuration and history. The originals in Microsoft 365 or Google Drive remain untouched.

</Warning>

A controlled document with an approved version is protected from deletion, including while a later draft is being prepared. Its menu shows **Protected controlled record**. A folder containing such a record cannot be deleted either. Legal holds can also block changes or deletion; ask an administrator to check the specific restriction rather than uploading duplicates to work around it.
