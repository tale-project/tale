-- Bind API conversation sources and receipts to one organization and service user
--
-- Integration identity cannot live in Inbox metadata: editors may replace
-- that metadata. A source belongs to one service user; rotating its API key
-- preserves ownership. Existing email threads are unaffected.
CREATE TABLE IF NOT EXISTS app.conversation_api_bindings (
  conversation_id text PRIMARY KEY REFERENCES app.conversations(id) ON DELETE CASCADE,
  org_id text NOT NULL,
  source text NOT NULL,
  external_id text NOT NULL,
  external_contact_id text NOT NULL,
  owner_user_id text NOT NULL,
  snapshot_version bigint NOT NULL DEFAULT -1,
  snapshot_hash text,
  source_deleted boolean NOT NULL DEFAULT false,
  -- Negotiated destination limits belong to this protocol binding.
  reply_constraints jsonb NOT NULL DEFAULT '{}',
  UNIQUE (org_id, source, external_id)
);
CREATE INDEX IF NOT EXISTS conversation_api_bindings_owner
  ON app.conversation_api_bindings(org_id, source, owner_user_id);

-- Only rows with these receipts may be reconciled by source snapshots.
-- Office-authored replies can never be overwritten by an imported message.
CREATE TABLE IF NOT EXISTS app.conversation_api_messages (
  conversation_id text NOT NULL REFERENCES app.conversation_api_bindings(conversation_id) ON DELETE CASCADE,
  external_id text NOT NULL,
  message_id text NOT NULL UNIQUE REFERENCES app.conversation_messages(id) ON DELETE CASCADE,
  -- A snapshot older than this acknowledgement must not retract the reply.
  source_version bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_id, external_id)
);

-- Native Inbox replies wait here until the external app proves delivery.
-- A lost HTTP response is replayed; the stable message id is its receipt key.
CREATE TABLE IF NOT EXISTS app.conversation_api_deliveries (
  message_id text PRIMARY KEY REFERENCES app.conversation_messages(id) ON DELETE CASCADE,
  conversation_id text NOT NULL REFERENCES app.conversation_api_bindings(conversation_id) ON DELETE CASCADE,
  org_id text NOT NULL,
  actor_user_id text NOT NULL,
  actor_email text NOT NULL,
  body text NOT NULL,
  available_at_ms bigint NOT NULL,
  claimed_at_ms bigint,
  claim_token text,
  retry_at_ms bigint NOT NULL DEFAULT 0,
  attempt_count integer NOT NULL DEFAULT 0,
  failed_at_ms bigint,
  last_error_code text,
  acknowledged_at_ms bigint,
  receipt_id text
);
CREATE INDEX IF NOT EXISTS conversation_api_deliveries_pending
  ON app.conversation_api_deliveries(org_id, retry_at_ms, available_at_ms, message_id)
  WHERE acknowledged_at_ms IS NULL AND failed_at_ms IS NULL;
