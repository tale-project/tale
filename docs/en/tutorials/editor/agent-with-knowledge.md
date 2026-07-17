---
title: Build an agent with knowledge
description: Bind documents from the knowledge base to a fresh agent so its replies cite the documents instead of guessing from the model's parametric memory.
---

An agent with knowledge is the shape you reach for when the model needs to answer from specific documents — your product manual, your policies, last quarter's call notes — not from whatever it learned during training. The agent retrieves chunks from the bound sources at reply time and cites them. This walk takes a fresh agent from "I want it to know my docs" to "the reply cites the right document" on one instance.

You need an Editor role, the ability to upload documents to the knowledge base, and roughly three documents to bind. The conceptual side lives in [Agent knowledge](/platform/agents/knowledge); this walk is the end-to-end mechanic.

## Before you begin

Confirm three things. Your role is at least Editor — agent editing is gated to Editor and above. You have at least three documents on hand to upload (PDFs, DOCX, Markdown — anything the knowledge base accepts). You have a provider configured so the agent can run — without one, the test reply at the end fails on the model call.

## Step 1 — Upload documents to the knowledge base

The first move is putting the documents inside Tale's knowledge base. Documents that are not in the knowledge base cannot be bound; the agent only sees sources it can name.

Open **Knowledge > Documents** and click **Upload**. Drag the three documents in, give them sensible titles, and wait for the status column to show **Ready** for each. The status walks through `uploaded → processing → ready`; processing chunks the document and computes embeddings. A typical PDF reaches **Ready** in a minute or two.

If a document sticks on `processing` for more than five minutes, open its row to see the error — the most common cause is an unsupported format (image-only PDFs, password-protected files) or a file larger than the org's upload limit.

## Step 2 — Create the agent

A bound document goes on an agent, so the agent has to exist first. Open **Agents > New agent** and fill in the four knobs as a baseline:

- **Name** — `Docs Q&A`
- **Instructions** — `You answer questions strictly from the bound documents. If you cannot find the answer in the documents, say so explicitly. Cite the document title for every claim.`
- **Tools** — toggle **RAG** on; everything else off
- **Model** — pick whatever default the org uses

Save and publish. The agent now exists but has no knowledge — it will refuse every question because it cannot find any source.

## Step 3 — Bind the documents

The binding is the seam that gives the agent retrieval access to a subset of the knowledge base. Open the agent's **Knowledge** tab and click **Agent knowledge**. Pick the three documents from Step 1 and save.

The Knowledge tab now lists three bound sources. The agent's RAG tool will retrieve only from those three; nothing else in the knowledge base is reachable from this agent, even other documents in the same library.

## Step 4 — Ask a question and check the citation

Open a chat with `Docs Q&A` and ask a question one of the documents answers. The reply streams in with citations inline — hovering shows the document title, clicking opens the document at the cited chunk. Ask a question none of the documents covers; the agent should refuse explicitly per the instruction, not invent an answer.

If the agent invents an answer anyway, the instructions are not strict enough — add an explicit refusal case ("If you cannot find the answer in the bound documents, respond with exactly: 'I could not find this in the bound documents.'") and republish.

## Where this fits

The four moves above are the canonical "agent that answers from your docs" build: upload, create the agent with RAG on, bind, verify with a citation. The same shape scales — bind ten documents instead of three, add a website or a contact record, swap the model. The bindings, not the model, are what makes the agent yours.

For the conceptual side of how retrieval composes with the agent's other knobs, see [Agent concepts](/platform/agents/concepts). For the wider knowledge-base story — Contacts, Products, Vendors, Websites — see [Knowledge overview](/platform/knowledge/overview).
