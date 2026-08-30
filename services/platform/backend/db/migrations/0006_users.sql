-- 0.5 app migration 0006: per-user account metadata (users domain).

-- Password rotation anchor. Separate from Better Auth's account.updatedAt,
-- which is patched by non-password events (e.g. OAuth token refresh).
CREATE TABLE app.user_password_metadata (
  user_id text PRIMARY KEY,
  password_changed_at bigint NOT NULL,
  force_change_on_next_login boolean NOT NULL DEFAULT false
);

-- Changelog acknowledgment state: `last_seen` moves when the user views the
-- release notes (red dot clears); `last_toasted` moves when the toast fires
-- so it never repeats for a version.
CREATE TABLE app.user_notification_state (
  user_id text PRIMARY KEY,
  last_seen_changelog_version text,
  last_toasted_version text,
  updated_at bigint NOT NULL
);
