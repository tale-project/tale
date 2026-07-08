import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.2.90 / 02 — backfill `conversations.integrationName` from each
 * conversation's message history.
 *
 * The email inbox apps (reply-outlook-emails / reply-gmail-emails / reply-imap-emails) list and
 * reply per integration: the list query filters on the new
 * `by_org_integration_status_lastMessageAt` index and `replyToConversation`
 * derives the outbound integration from the conversation row (no more
 * hardcoded fallback). Historical conversations predate the column, so this
 * migration stamps each row with the `integrationName` of its most recent
 * `conversationMessages` row that carries one (messages have recorded it at
 * ingest/send since the column existed).
 *
 * Idempotent both ways, the 0.2.88 posture: `up` skips a row whose
 * `integrationName` is already a non-empty string, and skips rows whose
 * messages name no integration (underivable — the reply path surfaces those
 * as an explicit error). `down` clears the column ONLY where the current
 * value still equals what `up` would derive, so a post-migration edit
 * survives rollback.
 */
export const meta: MigrationMeta = {
  id: '0.2.90/02_backfill_conversation_integration_name',
  semver: '0.2.90',
  numericId: 2,
  slug: 'backfill_conversation_integration_name',
  title: 'Backfill conversations.integrationName from the latest message',
  description:
    'Stamps each conversations row that has no integrationName with the ' +
    'integrationName of its most recent conversationMessages row carrying ' +
    'one, so the email inbox apps can filter and reply per integration. ' +
    'Rows with a value and rows whose messages name no integration are left ' +
    'untouched. down clears only the rows whose current value still equals ' +
    'the derived one, preserving post-migration edits.',
  kind: 'db',
  reversible: true,
  destructive: false,
  snapshot: 'none',
};
