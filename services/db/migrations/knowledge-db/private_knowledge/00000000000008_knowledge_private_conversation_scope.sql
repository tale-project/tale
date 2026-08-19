-- migrate:up
--
-- Conversation scope on corpus documents.
--
-- An emailed attachment belongs to a conversation, and conversations are scoped
-- more narrowly than anything else the corpus holds: admins see all, an
-- unassigned one is admin-triage only, otherwise the caller must be the
-- assignee or in the assigned team. That rule is also LIVE — a reassignment
-- changes who may read the mail, and therefore who may read its attachment.
--
-- So the column does not carry the answer, only the question. It records which
-- conversation the row belongs to; the Convex-truth re-check
-- (`filterRetrievableRagFileIds`) then applies `conversationAssignmentAllows`
-- against the conversation's CURRENT assignment. Stamping a team here instead
-- would be wrong the moment somebody reassigned, and every missed rewrite would
-- leave a file hidden from its new owner or visible to the person who handed it
-- off.
--
-- Its other job is to keep these rows OUT of the hub clause. A row with every
-- scope column NULL reads as org-hub, so without this an indexed attachment
-- would be org-wide by default — the outcome being avoided.
--
-- Nullable TEXT with no default: NULL means "not a conversation row", which is
-- every pre-existing row and every document. Metadata-only, idempotent, safe on
-- any vintage.
--
-- Partial index in the same style as `idx_pk_docs_org_project`: conversation
-- rows are the minority, so the index stays small.

ALTER TABLE private_knowledge.documents
    ADD COLUMN IF NOT EXISTS conversation_id TEXT;

CREATE INDEX IF NOT EXISTS idx_pk_docs_org_conversation
    ON private_knowledge.documents (org_slug, conversation_id)
    WHERE conversation_id IS NOT NULL;

-- migrate:down
-- Deliberately empty, like the other private_knowledge migrations: on a
-- database that received this column it immediately holds tenancy scope, and
-- dropping it would silently widen every conversation-scoped attachment back to
-- org-wide hub visibility. Remove it with an explicit, reviewed migration.
