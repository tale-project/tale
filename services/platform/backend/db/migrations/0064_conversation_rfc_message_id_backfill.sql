-- 0.5 app migration 0064: reconcile the conversation threading key to the RFC
-- Message-ID.
--
-- Ingest stores `external_message_id` as the threading key and matches an
-- inbound reply's In-Reply-To / References (which carry RFC Message-IDs) against
-- it. Gmail rows written before the ingest fix stored Gmail's OWN API id there
-- instead of the RFC Message-ID, so every reply's lookup missed and opened a new
-- conversation. The RFC Message-ID is recoverable — the same ingest stamped it
-- into `metadata.headers.'message-id'` — so this backfills the stored key from
-- it, normalized the way `normalizeExternalMessageId` does (trim, then strip one
-- surrounding pair of angle brackets).
--
-- Forward-only, rolling-safe, idempotent, bounded:
--   * Only email rows whose stored id DIFFERS from the recoverable RFC id are
--     touched, so Outlook/IMAP rows (already keyed on the RFC id) fall out of the
--     WHERE and re-running writes the same value — a no-op the second time.
--   * The previous image keeps working: it reads the same column, and the only
--     rows it writes during the overlap are freshly ingested ones the next sync
--     re-fetches and the shipped code now keys correctly.
--   * The `'@'` guard refuses to overwrite a valid stored id with a malformed
--     header value.
--
-- external_message_id carries no UNIQUE constraint (the org_external indexes are
-- non-unique), so the reconciliation cannot fail on a collision.

UPDATE app.conversation_messages
SET external_message_id = regexp_replace(
      regexp_replace(btrim(metadata -> 'headers' ->> 'message-id'), '^<', ''),
      '>$', '')
WHERE channel = 'email'
  AND metadata -> 'headers' ->> 'message-id' IS NOT NULL
  AND position('@' IN metadata -> 'headers' ->> 'message-id') > 0
  AND external_message_id IS DISTINCT FROM regexp_replace(
      regexp_replace(btrim(metadata -> 'headers' ->> 'message-id'), '^<', ''),
      '>$', '');

UPDATE app.conversations
SET external_message_id = regexp_replace(
      regexp_replace(btrim(metadata -> 'headers' ->> 'message-id'), '^<', ''),
      '>$', '')
WHERE channel = 'email'
  AND metadata -> 'headers' ->> 'message-id' IS NOT NULL
  AND position('@' IN metadata -> 'headers' ->> 'message-id') > 0
  AND external_message_id IS DISTINCT FROM regexp_replace(
      regexp_replace(btrim(metadata -> 'headers' ->> 'message-id'), '^<', ''),
      '>$', '');
