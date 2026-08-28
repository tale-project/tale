-- 0.5 app migration 0028: collaboration — per-user content notifications
-- (one row per recipient; the org-wide `notifications` table stays for
-- system/security alerts), task subscriptions, and tri-state per-user
-- notification preferences.

CREATE TABLE app.user_notifications (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  user_id text NOT NULL,
  org_id text NOT NULL,
  type text NOT NULL,
  title_key text NOT NULL,
  body_key text NOT NULL,
  params jsonb,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  task_id text,
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'agent', 'system')),
  actor_id text,
  read boolean NOT NULL DEFAULT false,
  read_at_ms bigint,
  created_at_ms bigint NOT NULL,
  -- Collapse identity: while an UNREAD row with this key exists, a later
  -- event on the same dimension rewrites it in place (see the reused
  -- `collab/coalesce.ts` doctrine). Absent = never collapses.
  coalesce_key text
);

CREATE INDEX user_notifications_user_created
  ON app.user_notifications (user_id, org_id, created_at_ms DESC);
CREATE INDEX user_notifications_user_unread
  ON app.user_notifications (user_id, org_id, read, seq DESC);

CREATE TABLE app.task_subscriptions (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  task_id text NOT NULL REFERENCES app.tasks (id) ON DELETE CASCADE,
  subscriber_type text NOT NULL CHECK (subscriber_type IN ('user', 'agent')),
  subscriber_id text NOT NULL,
  reason text NOT NULL CHECK (reason IN (
    'creator', 'assignee', 'commenter', 'mention', 'reviewer', 'manual'
  )),
  muted boolean,
  created_at_ms bigint NOT NULL,
  UNIQUE (task_id, subscriber_type, subscriber_id)
);

CREATE INDEX task_subscriptions_subscriber
  ON app.task_subscriptions (org_id, subscriber_type, subscriber_id);

-- Tri-state prefs: NULL = follow the system default (ON).
CREATE TABLE app.notification_preferences (
  user_id text NOT NULL,
  org_id text NOT NULL,
  task_assigned boolean,
  task_status_changed boolean,
  task_commented boolean,
  mention boolean,
  task_deadlines boolean,
  task_review boolean,
  escalation boolean,
  automation_alerts boolean,
  conversation_messages boolean,
  actionable_email boolean,
  updated_at_ms bigint NOT NULL,
  PRIMARY KEY (user_id, org_id)
);
