-- 0.5 app migration 0023: the chat thread SURFACE columns — the 0.4 thread
-- fields the list/lifecycle/share/branch mutations read and write. They ride
-- the `thread_metadata` sidecar (the chat-domain row `0012` established);
-- `app.threads` itself stays the lean shared store row. `status` remains the
-- lifecycle column ('active' | 'trashed' | 'expired' — 0.4's absent
-- lifecycleStatus maps to 'active').

ALTER TABLE app.thread_metadata ADD COLUMN archived boolean NOT NULL DEFAULT false;
ALTER TABLE app.thread_metadata ADD COLUMN pinned_at_ms bigint;
-- Unread tracking: newest assistant activity vs. the owner's watermark.
ALTER TABLE app.thread_metadata ADD COLUMN last_reply_at_ms bigint;
ALTER TABLE app.thread_metadata ADD COLUMN last_read_at_ms bigint;
-- Org-internal share links: the token IS the URL credential; sharedAt is the
-- snapshot boundary; the token survives unshare so the URL stays stable.
ALTER TABLE app.thread_metadata ADD COLUMN is_shared boolean;
ALTER TABLE app.thread_metadata ADD COLUMN share_token text;
ALTER TABLE app.thread_metadata ADD COLUMN shared_at_ms bigint;
ALTER TABLE app.thread_metadata ADD COLUMN shared_by text;
-- The owner's opt-in to make the conversation readable by project members.
ALTER TABLE app.thread_metadata ADD COLUMN shared_with_project boolean;
-- The composer's Skills / Connectors picks: {skills: [], connectors: []}.
ALTER TABLE app.thread_metadata ADD COLUMN capabilities jsonb;
ALTER TABLE app.thread_metadata ADD COLUMN reasoning_effort text;
ALTER TABLE app.thread_metadata ADD COLUMN harness text;
ALTER TABLE app.thread_metadata ADD COLUMN external_resume text;
-- Branch lineage: a fork records its source message; hidden edit/regenerate
-- siblings hang off the root so the sidebar shows one row per lineage.
ALTER TABLE app.thread_metadata ADD COLUMN branched_from_message_id text;
ALTER TABLE app.thread_metadata ADD COLUMN branch_root_id text;
ALTER TABLE app.thread_metadata ADD COLUMN hidden boolean;

CREATE UNIQUE INDEX thread_metadata_share_token
  ON app.thread_metadata (share_token) WHERE share_token IS NOT NULL;
CREATE INDEX thread_metadata_branch_root
  ON app.thread_metadata (branch_root_id) WHERE branch_root_id IS NOT NULL;
