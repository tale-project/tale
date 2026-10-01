-- When each organization's unused-workspace rule began to apply.
--
-- The workspace cleanup (domains/sandbox/workspace-cleanup.ts) deletes a
-- project agent's sandbox workspace that nobody has used for the
-- organization's `sandbox_workspaces` window (30 days by default). A
-- workspace already unused for longer than that when the rule starts to
-- apply — at the upgrade that brings the cleanup, when an admin turns it on,
-- or when the window is shortened — would otherwise go on the very next
-- hourly sweep, before anyone had the window to use or pin it. So the
-- policy's save — and, for the upgrade and a policy written any other way,
-- the sweep — records per organization when the rule in its current form
-- took effect, and nothing is deleted for being unused until a full window
-- has passed since then. The Sandboxes page reads the same row to date each
-- deletion.
--
--   unused_days       the window in force when `applies_since_ms` was
--                     stamped: a shorter one restamps it, a longer one only
--                     updates this (waiting longer never needs a new notice)
--   applies_since_ms  when the rule, at least this strict, took effect
--
-- A row exists only while the organization deletes unused workspaces: turning
-- the rule off removes it, so turning it back on starts a fresh window.
--
-- Rolling-deploy safe: a new table the previous image never reads. Its rows
-- are organization-owned and go with the organization's deletion.

CREATE TABLE IF NOT EXISTS app.sandbox_workspace_retention (
  org_id text PRIMARY KEY,
  unused_days int NOT NULL CHECK (unused_days > 0),
  applies_since_ms bigint NOT NULL
);
