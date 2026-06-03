---
title: Vector database
description: Settings > Vector database is where Admins choose which vector store holds this organization's document embeddings — the built-in PostgreSQL, an external Qdrant, or an external PostgreSQL. The choice is per organization, so one org's documents can live in its own infrastructure while another stays on the built-in store.
---

Settings > Vector database is where an Admin decides where this organization's document embeddings physically live. Retrieval — the search behind every grounded answer — runs against this store, so the backend you pick here determines both how that org's documents are indexed and which infrastructure holds the vectors. The choice is scoped to the current organization: changing it never touches another org's data, and an org that never opens this page keeps using the built-in store.

This page covers the UI: how to read the active backend, how to point an org at its own Qdrant or PostgreSQL, how to test a connection before you commit it, and what switching a backend does to documents already indexed. It is gated on the organization-settings capability, so only an Owner or Admin reaches it.

## What the page shows

Open **Settings > Vector database** and the page names the org's active backend at the top, then a form for changing it. The two banners above the form are the load-bearing context: the first states that the configuration applies only to the current organization, the second explains that switching a backend automatically mirrors the org's existing vectors into the new store in the background. Read both before you change anything — the second one is why a switch is a safe operation rather than one that leaves search looking empty.

The form starts with **Backend**, a choice between **Built-in** and **External**. Built-in is the default for every org and needs no configuration: embeddings live in Tale's own PostgreSQL alongside the document metadata. Pick External and a second selector appears, **External backend**, where you choose between **Qdrant (external)** and **PostgreSQL (pgvector, external)**.

## Pointing an org at its own backend

For **Qdrant (external)**, fill in the **Qdrant URL** the Tale services can reach (for example `http://qdrant:6333`), the **Collection** name to store vectors in, and an **API key** if your Qdrant instance enforces authentication. Leave **Prefer gRPC** off unless your deployment is set up for it.

For **PostgreSQL (pgvector, external)**, fill in the **Host**, **Port**, **Database**, **User**, **SSL mode**, and the **Table** that holds the vectors — Tale creates the table and the `vector` extension if they are missing. Supply the **Password** the database expects.

The **API key** and **Password** fields are write-only. Once saved, the page shows only a masked preview; leaving the field blank on a later save keeps the stored secret untouched. Secrets are encrypted at rest, never returned to the browser in full.

## Test before you save

Click **Test connection** before committing an external backend. For Qdrant, Tale probes the URL with the supplied (or stored) key; for external PostgreSQL, it opens a real connection through the retrieval service and confirms the `vector` extension is available. A reachable database without pgvector fails the test with an actionable message — install the extension and retry. The test uses the values in the form, so you can verify a candidate backend without saving it first.

When the form is ready, click **Save changes** and confirm the dialog. The change takes effect shortly after saving — the retrieval service picks it up within a short window, with no restart. Other organizations are unaffected.

## Switching a backend mirrors existing vectors

Switching a backend does not require re-indexing. Every backend keeps the document embeddings in Tale's own PostgreSQL as the source of truth, so a switch simply mirrors that org's existing vectors into the new store — automatically, in the background, scoped to this organization. The retrieval service notices the change within a short window and copies the vectors across; for a large document set this can take a few minutes, during which vector search may be briefly incomplete and fall back to full-text search. No re-upload, no manual re-index, no live-cutover planning. The confirmation dialog still names the previous and new backend so the change is explicit at the moment you commit.

Re-indexing is only required when you change the org's embedding _model_, not its backend — a new model produces vectors in a different space, so the old ones must be regenerated. That concern is independent of where the vectors are stored, and it applies to the built-in backend just as much as an external one.

One constraint carries over from the embedding model: orgs that stay on the built-in store share a single embedding dimension, so they must agree on an embedding model that produces vectors of the same width. An org on its own external backend escapes that constraint — its collection or table is pinned to that org's own embedding dimensions and is independent of every other org.

## Where this fits

The vector database is the floor under retrieval: every grounded answer, every document search, every workflow step that reaches into the knowledge base resolves through the store you pick here. The reason to leave an org on Built-in is that it just works with no extra infrastructure; the reason to move an org to its own Qdrant or PostgreSQL is data residency — keeping that tenant's vectors in infrastructure it controls. The natural next read is [AI providers](/platform/admin/providers), since the embedding model that decides a vector's dimensions is configured there, and [Audit logs](/platform/admin/governance/audit-logs), where every backend change for an org is recorded with the actor and the before/after backend.
