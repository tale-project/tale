---
title: Document comparison
description: Compare two documents side by side and read a detailed diff that highlights additions, deletions, and modifications paragraph by paragraph.
---

Document comparison lets you upload or pick two documents and read a paragraph-level diff between them. Use it to review a contract revision against the previous version, track policy updates between annual refreshes, or verify that a refreshed template matches the spec. The audience is Editors and Admins who handle document review; Members with read access to the knowledge base can also run a comparison if their role permits.

The diff is computed and rendered in the browser; nothing reaches the AI unless an agent is explicitly asked to summarise the result afterwards.

## Start a comparison

To open the comparison dialog, navigate to **Knowledge > Documents** and pick the comparison entry from the action menu. The dialog asks for two documents — the base on the left, the comparison on the right:

| Side  | Label               | Options                                        |
| ----- | ------------------- | ---------------------------------------------- |
| Left  | Base document       | Upload a file, or select an existing document. |
| Right | Comparison document | Upload a file, or select an existing document. |

Each side has two tabs. **Upload** lets you drop a file from the device or browse the file picker. **Existing** searches and selects from documents already in the knowledge base. Click **Compare** once both sides are filled in; Tale sends both documents to the RAG service for analysis and the result renders inline.

The accepted formats: PDF, DOCX, XLSX, CSV, TXT, PPTX, and common image formats. Anything outside this set is rejected on upload.

## Read the results

The result view has two parts: a summary bar of statistics across the whole diff, then a scrollable list of change blocks. The summary names how many paragraphs landed in each bucket:

| Stat          | What it counts                                                     |
| ------------- | ------------------------------------------------------------------ |
| **Added**     | Paragraphs present in the comparison document but not in the base. |
| **Deleted**   | Paragraphs present in the base document but not in the comparison. |
| **Modified**  | Paragraphs that changed between documents.                         |
| **Unchanged** | Paragraphs with no differences.                                    |

A **high divergence** warning appears at the top of the result when the documents differ significantly — useful for catching a wrong-version mix-up before reading further. A **truncation notice** appears when the number of changes exceeds the display limit; the missing blocks are dropped from the rendered diff but the summary counts the whole document.

## Change-block colour coding

Each block in the scrollable list is colour-coded by the kind of change:

| Type     | Colour | Prefix  | What it shows                                                        |
| -------- | ------ | ------- | -------------------------------------------------------------------- |
| Added    | Green  | `+`     | New content in the comparison document.                              |
| Deleted  | Red    | `−`     | Content removed from the base document (shown with strikethrough).   |
| Modified | Yellow | `~`     | Content that changed, with inline diffs highlighting specific words. |
| Context  | Gray   | (space) | Unchanged surrounding text for reference.                            |

Modified blocks show inline diffs when the change is small enough to display word-level: deleted portions appear as `[-text-]` and added portions as `{+text+}`. When inline diffs aren't available — typically because the modification rewrote most of the paragraph — the old and new versions render on separate lines.

## Where this fits

Document comparison is the targeted diff surface for the knowledge base. It exists because reviewing a contract revision, a policy update, or a refreshed template doesn't fit inside chat — the eye needs both versions visible at once, with the changes highlighted. To compare two versions of the same document over time, upload each version as a separate file in the [knowledge base](/platform/workspace/knowledge-base) and run a comparison between them.

For an AI summary of the diff, copy the comparison link into a chat and ask the assistant to walk the changes; the chat agent can read the same RAG output the comparison dialog renders.
