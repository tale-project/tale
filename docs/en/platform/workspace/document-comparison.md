---
title: Document comparison
description: The side-by-side diff dialog that takes two documents — uploaded or pulled from the library — and walks the differences paragraph by paragraph with a RAG-assisted summary.
---

Document comparison is the dialog that answers the question "what changed between these two versions". You point it at a base document and a comparison document; Tale runs both through the same extraction pipeline that feeds the knowledge base, hands them to a deterministic diff endpoint on the RAG service, and renders the result as a structured walk-through of added, deleted, and modified paragraphs. It is the right tool for contracts before-and-after, policy revisions, two drafts of the same proposal — anything where the words matter and the words moved.

The dialog lives next to the documents you compare: open it from **Knowledge > Documents** with the **Compare documents** action. The base and comparison files can each be either an already-indexed document from the library or a one-off upload, so there is no need to load both sides into the knowledge base if you only want to look at one diff.

## Picking the two sides

Two pickers sit side by side: **Base document** on the left, **Comparison document** on the right. Each picker has two tabs — **Upload** and **Existing** — and either tab fills the same slot.

The Upload tab takes any of the formats the knowledge-base pipeline already handles: PDF, DOCX, DOC, XLSX, PPTX, plain text, Markdown, CSV. The file uploads to Tale's object store, the same place chat attachments and library documents live; it is not indexed and not bound to an agent, so the upload is a one-shot input to this diff and nothing else. The Existing tab lists every document in the library that has a downloadable file — pick one with the searchable selector and the slot fills with that document's name.

Mix the tabs freely. Compare two uploads against each other when neither version is in the library, compare an upload against an existing library document when you want to see what an incoming draft changes, or compare two library documents when you have versioned them in Knowledge.

## Running the diff

Click **Compare**. The dialog shows a spinner while the RAG service downloads both files, extracts the text, normalises paragraph boundaries, and runs a paragraph-level deterministic diff. The endpoint is the comparison feature's only model-free path — the diff itself is plain string-matching, so the output is reproducible for the same inputs.

The wait is bounded — the request times out at two minutes if the RAG service has not returned. Large files hit the timeout more often than small ones; if it trips, retry once and consider trimming the file to the part that matters.

## Reading the result

Four stat badges sit above the diff: **Added**, **Deleted**, **Modified**, **Unchanged**, each carrying the paragraph count for that bucket. The badges are also the legend for the colour scheme below — green for added, red for deleted, yellow for modified, neutral for unchanged context.

Below the badges sits the change list. Each entry is one **change block** — a stretch of contiguous changes plus a paragraph of context before and after — rendered as a single card. Inside the card, each paragraph carries a leading sign (`+` added, `-` deleted, `~` modified, blank for context) and a colour fill. Modified paragraphs render the inline diff when the endpoint provides one — deleted text crossed out, added text highlighted — and fall back to the full before-and-after pair when it does not.

When the base and comparison have so little in common that the diff is essentially "delete everything, add everything", a **high divergence** warning sits above the change list. That is the diff telling you the two files are not actually two versions of the same document — they may have started from the same template but the bodies have drifted past the point where a paragraph-level diff is the right shape.

## The truncation banner

The endpoint caps the change-block count to keep the dialog usable. When the cap trips, a **Results truncated** banner sits below the stats: the displayed blocks are the most significant ones, the totals in the badges still reflect the full file pair. The cap is on display only — the underlying diff sees every paragraph.

## When to reach for it

Reach for document comparison when the question is "what changed", not "what does this say". For "what does this say", upload the file as a chat attachment or load it into the knowledge base and ask an agent — the model is better at reading prose than the diff is. The diff is better at reading two files in parallel and reporting which paragraphs are different, which is what every line-numbered diff tool does but extended to extracted text from any format the pipeline supports. The next read worth queuing is [Documents](/platform/knowledge/documents) — it covers the indexing pipeline the comparison shares with the rest of the knowledge base, and where versioned documents live once you have compared them.
