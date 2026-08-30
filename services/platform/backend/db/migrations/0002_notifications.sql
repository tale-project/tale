-- 0.5 app migration 0002: per-user hint scoping + the notifications domain.

-- Hints gain an optional user scope: NULL = org-wide, set = only that user's
-- SSE connections receive it (badges and other per-user Tier-2 views).
ALTER TABLE app_realtime.outbox ADD COLUMN user_id text;

-- Domain tables live in the explicit `app` schema (no search_path reliance).
CREATE SCHEMA app;

-- Org-audience notifications (the admin/security bell), the 0.4 shape:
-- one row per org event; `security` rows are visible to admins only; read
-- state is per-user (0.4's readBy array normalized into a join table).
CREATE TABLE app.notifications (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  category text NOT NULL CHECK (category IN ('security', 'system')),
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  -- i18n keys resolved client-side against the `notifications` namespace.
  title_key text NOT NULL,
  body_key text NOT NULL,
  -- ICU params for both keys.
  params jsonb,
  -- Data-subject user this notification is ABOUT (GDPR Art 17 erasure
  -- matches on it) — distinct from the audience reading the bell.
  subject_user_id text,
  -- Route-agnostic deep-link target ({kind: …}), resolved client-side.
  link jsonb,
  -- At-least-once producers pass a durable dedupe key so a redelivery
  -- cannot double-notify (constitution rule 2).
  dedupe_key text,
  -- Epoch ms (the 0.4 `createdAt` contract the client sorts/renders by).
  created_at_ms bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX notifications_dedupe
  ON app.notifications (org_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX notifications_org_created
  ON app.notifications (org_id, created_at_ms DESC, id DESC);

CREATE INDEX notifications_org_subject
  ON app.notifications (org_id, subject_user_id);

CREATE TABLE app.notification_reads (
  notification_id text NOT NULL
    REFERENCES app.notifications (id) ON DELETE CASCADE,
  user_id text NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, user_id)
);

CREATE INDEX notification_reads_user ON app.notification_reads (user_id);
