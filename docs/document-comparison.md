---
title: Document comparison
description: Compare two documents side by side to see additions, deletions, and modifications.
---

Document Comparison lets you upload or select two documents and view a detailed diff of their content. Use it to review contract revisions, track policy changes, or verify document updates.

## Starting a comparison

1. Navigate to **Knowledge > Documents**.
2. Open the comparison dialog from the action menu.
3. Select two documents:

| Side | Label | Options |
| --- | --- | --- |
| Left | Base document | Upload a file or select an existing document |
| Right | Comparison document | Upload a file or select an existing document |

Each side has two tabs:

- **Upload** — drag and drop or browse to upload a file from your device.
- **Existing** — search and select from documents already in your knowledge base.

4. Click **Compare**. The platform sends both documents to the RAG service for analysis.

### Supported file types

PDF, DOCX, XLSX, CSV, TXT, PPTX, and common image formats.

## Reading the results

The comparison results show a summary bar and a list of change blocks.

### Summary statistics

| Stat | Description |
| --- | --- |
| **Added** | Paragraphs present in the comparison document but not in the base |
| **Deleted** | Paragraphs present in the base document but not in the comparison |
| **Modified** | Paragraphs that changed between documents |
| **Unchanged** | Paragraphs with no differences |

A **high divergence** warning appears when the documents differ significantly. A **truncation notice** appears if the number of changes exceeds the display limit.

### Change types

Each change block is color-coded:

| Type | Color | Prefix | Description |
| --- | --- | --- | --- |
| Added | Green | `+` | New content in the comparison document |
| Deleted | Red | `−` | Content removed from the base document (shown with strikethrough) |
| Modified | Yellow | `~` | Content that changed, with inline diffs highlighting specific words |
| Context | Gray | (space) | Unchanged surrounding text for reference |

Modified blocks show inline diffs when available: deleted portions appear as `[-text-]` and added portions as `{+text+}`. When inline diffs are not available, the old and new versions are shown on separate lines.
