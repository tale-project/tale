---
title: Documents
description: The Documents area is where Editors upload files into the knowledge base, watch them index, and bind them to agents. This page covers uploading, the indexing pipeline, supported formats, and the per-document lifecycle.
---

The Documents area is the knowledge base's file surface. Editors upload files — PDFs, Word documents, Markdown, plain text, code, spreadsheets, slide decks — and Tale runs each one through an indexing pipeline that extracts text, chunks it, embeds the chunks, and stores them so agents can retrieve relevant pieces at reply time. Once indexed, a document can be bound to one or more agents; bound agents see the document's chunks during RAG retrieval and cite them in replies.

This page covers the operator-facing side of Documents: uploading, what happens during indexing, supported formats, how the per-document lifecycle works, and how documents differ from the structured-data types (customers, products, vendors, websites) that share the knowledge base.

## A worked upload

To upload a document, open **Knowledge > Documents** and drop the file onto the upload area, or click **Upload** and pick the file from disk. The document appears in the list immediately with status `Indexing`; Tale runs the pipeline in the background. When the status flips to `Indexed`, the document is ready to bind to agents. Pipeline failures surface with status `Error` and a one-line reason; the row carries a **Retry** button that re-runs the pipeline from scratch.

Binding the document to an agent is a separate step. Open the agent and add the document under its **Knowledge** tab; the next request the agent serves retrieves over the new document's chunks. A document with no bindings stays indexed but is invisible to every agent — useful when you want the document in the library but not yet in production.

## What the indexing pipeline does

Indexing happens in four stages, in order:

- **Extract** — pull text out of the file. PDFs go through layout-aware extraction; Office documents and Markdown go through structure-aware extraction; images inside a document go through OCR.
- **Chunk** — split the extracted text into retrieval-sized pieces, respecting headings and paragraph boundaries where the file's structure makes them visible.
- **Embed** — call the embedding model from the org's configured provider to produce a vector for each chunk.
- **Store** — write the chunks and their vectors to the search index, with the source file's metadata attached.

The pipeline is idempotent on the source file's hash. Uploading the same file twice produces one indexed copy, not two. Editing the file and re-uploading replaces the old chunks with the new ones; agents see the update on the next retrieval.

## Supported formats

The pipeline handles the file types that cover the bulk of org knowledge:

- **Text and code.** Markdown (`.md`), plain text (`.txt`), source code (every language Tale highlights — see the highlighter list).
- **Documents.** PDF (`.pdf`), Word (`.docx`).
- **Spreadsheets.** Excel (`.xlsx`), CSV (`.csv`), TSV (`.tsv`).
- **Slides.** PowerPoint (`.pptx`).
- **Web pages.** HTML (`.html`) and the rendered output of a page crawl.
- **Images.** PNG, JPG, GIF, BMP, TIFF, WEBP, with OCR applied to extract any text.

A file in a format outside this list — an older Office file (`.doc`, `.xls`, `.ppt`), an archive, an arbitrary binary — still uploads and stays available as a stored file, but Tale skips the indexing pipeline for it: the row shows **Not indexed** instead of an indexing error, and agents cannot retrieve its content. The list of supported formats grows as the pipeline does.

## The per-document lifecycle

Each document carries a small set of fields beyond its content: a **title** (auto-extracted from the file's metadata, editable), a **source** (the file or the integration that brought it in), an **owner** (the member or team that uploaded it), **tags** (free-form labels for filtering), and a **visibility** (org-wide, team-scoped, or per-agent). The visibility lever is the document-level twin of the team-scoping done elsewhere — a team-scoped document is invisible to members outside the team even if their role would otherwise allow it.

Documents synced from an integration carry the integration's source field. A document brought in by the OneDrive sync shows the OneDrive path; a document pulled from Confluence shows the page URL. The source field makes citations clickable back to the upstream system.

## Deleting and re-indexing

Click the document's row, then **Delete** to remove it from the library. Deletion removes the chunks from the search index on the next pass; in-flight retrievals complete, the next one does not see the document. There is no undo — re-uploading the same file restores it, but the document's audit history starts fresh.

Re-indexing without deleting is the right move when the pipeline has improved between uploads. Click **Re-index** on the row; Tale runs the pipeline again on the stored source file and replaces the chunks atomically. The document does not blink out of agents' reach during the re-index.

## Documents versus structured data

The knowledge base has two halves. **Documents** are unstructured — text, prose, slides, anything the pipeline can chunk and embed. **Structured data** (customers, products, vendors, websites) are rows in typed tables — fields with names, validation, and explicit relationships. Reach for documents when the content is prose; reach for structured data when the content is a list of things with the same shape. See [Structured data](/platform/knowledge/structured-data) for the typed-table surface.

## Where this fits

Documents are the most-used corner of the knowledge base — every agent that cites a source most likely cites a document. The natural next read is [Knowledge overview](/platform/knowledge/overview) for the cross-surface map, and [Agent knowledge](/platform/agents/knowledge) for how an agent binds to documents and retrieves over them at reply time.
