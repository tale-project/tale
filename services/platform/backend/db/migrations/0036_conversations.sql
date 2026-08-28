-- 0.5 app migration 0036: conversations — the shared Inbox substrate (the
-- 0.4 `conversations` + `conversationMessages` tables). A conversation links
-- ONE contact, may be owned by a member and/or queued to a team (that
-- assignment IS the visibility rule — an unassigned row is admin-triage
-- only), and is stamped with the connector it syncs through. Messages carry
-- the delivery lifecycle (queued → sent → delivered / failed) and thread
-- content; chronology is sentAt → deliveredAt → createdAt (the shared
-- message-order contract).

CREATE TABLE app.conversations (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  contact_id text,
  assignee_user_id text,
  assignee_team_id text,
  external_message_id text,
  subject text,
  status text CHECK (status IN ('open', 'closed', 'spam', 'archived')),
  priority text,
  type text,
  channel text,
  direction text CHECK (direction IN ('inbound', 'outbound')),
  connector_name text,
  last_message_at_ms bigint,
  metadata jsonb,
  lifecycle_status text,
  status_changed_at_ms bigint,
  created_at_ms bigint NOT NULL
);

CREATE INDEX conversations_org ON app.conversations (org_id);
CREATE INDEX conversations_org_last_message
  ON app.conversations (org_id, last_message_at_ms DESC);
CREATE INDEX conversations_org_status_last_message
  ON app.conversations (org_id, status, last_message_at_ms DESC);
CREATE INDEX conversations_org_connector_status_last_message
  ON app.conversations (org_id, connector_name, status, last_message_at_ms DESC);
CREATE INDEX conversations_org_external
  ON app.conversations (org_id, external_message_id);
CREATE INDEX conversations_org_contact
  ON app.conversations (org_id, contact_id);
CREATE INDEX conversations_org_assignee
  ON app.conversations (org_id, assignee_user_id);
CREATE INDEX conversations_org_assignee_team
  ON app.conversations (org_id, assignee_team_id);

CREATE TABLE app.conversation_messages (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Monotonic tiebreaker for same-instant rows (the 0.4 _id compare).
  seq bigint GENERATED ALWAYS AS IDENTITY,
  org_id text NOT NULL,
  conversation_id text NOT NULL
    REFERENCES app.conversations (id) ON DELETE CASCADE,
  channel text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  external_message_id text,
  delivery_state text NOT NULL CHECK (delivery_state IN (
    'queued', 'sent', 'delivered', 'failed'
  )),
  retry_count int,
  connector_name text,
  content text NOT NULL,
  sent_at_ms bigint,
  delivered_at_ms bigint,
  metadata jsonb,
  created_at_ms bigint NOT NULL
);

CREATE INDEX conversation_messages_conversation
  ON app.conversation_messages (conversation_id, delivered_at_ms);
-- The chronological walk: sentAt → deliveredAt → createdAt, seq tiebreak.
CREATE INDEX conversation_messages_conversation_chrono
  ON app.conversation_messages (
    conversation_id,
    coalesce(sent_at_ms, delivered_at_ms, created_at_ms),
    seq
  );
CREATE INDEX conversation_messages_org_delivered
  ON app.conversation_messages (org_id, delivered_at_ms);
CREATE INDEX conversation_messages_org_external
  ON app.conversation_messages (org_id, external_message_id);
CREATE INDEX conversation_messages_org_state_delivered
  ON app.conversation_messages (org_id, delivery_state, delivered_at_ms);
CREATE INDEX conversation_messages_org_lane
  ON app.conversation_messages (
    org_id, channel, direction, delivery_state, connector_name,
    delivered_at_ms
  );
