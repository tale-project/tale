-- migrate:up
--
-- Team/project scope on corpus documents.
--
-- A Tale document lives in exactly one scope — a project (`projectId`), a team
-- library (`teamId`), or the org hub (neither) — but until now the corpus row
-- carried only `org_slug`, so retrieval served every document org-wide and a
-- team- or project-scoped file leaked to members outside its scope. Scope now
-- lives ON THE ROW: ingest stamps it from the Convex document, scope changes
-- update it in place (no re-embedding), and both retrieval legs filter on it.
--
-- Both columns are nullable TEXT with no default: NULL/NULL is the org hub,
-- which is also what every pre-existing row reads as until the backfill
-- migration stamps it — i.e. exactly today's org-wide behaviour, tightening as
-- the backfill lands. Metadata-only, idempotent, safe on any vintage.
--
-- Mirrors the folder filter's partial-index style (`idx_pk_docs_org_folder`):
-- scoped rows are the minority, so the indexes stay small.

ALTER TABLE private_knowledge.documents
    ADD COLUMN IF NOT EXISTS team_id    TEXT,
    ADD COLUMN IF NOT EXISTS project_id TEXT;

CREATE INDEX IF NOT EXISTS idx_pk_docs_org_team
    ON private_knowledge.documents (org_slug, team_id)
    WHERE team_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pk_docs_org_project
    ON private_knowledge.documents (org_slug, project_id)
    WHERE project_id IS NOT NULL;

-- migrate:down
-- Deliberately empty, like the other private_knowledge migrations: on a
-- database that received these columns they immediately hold tenancy scope,
-- and dropping them would silently widen every scoped document back to
-- org-wide. Remove them with an explicit, reviewed migration instead.
