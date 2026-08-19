// The guard for a defect class, not for one bug.
//
// `getMessageByExternalId`, `getConversationById` and
// `getConversationByExternalMessageId` return whole rows through CLOSED object
// validators. A closed validator throws on a field it does not declare, so a
// field added to the table and not to the validator does not shrink the
// payload — it makes every row carrying that field unreadable. All three
// queries are on the mail ingest path, so the symptom is mail that will not
// sync, reported as a ReturnsValidationError.
//
// That is what happened: the validators omitted `retryCount` on messages and
// `assigneeUserId` / `assigneeTeamId` / `lifecycleStatus` / `statusChangedAt` on
// conversations, so ingest failed on any ASSIGNED conversation — which, on a
// deployment that routes mail to a team, is all of them.
//
// The assertion derives the expected field set from the table definition rather
// than restating it, so adding a column to the schema and forgetting the
// validator fails here instead of in production.

import { describe, expect, it } from 'vitest';

import {
  internalConversationRecordValidator,
  internalMessageRecordValidator,
} from './internal_queries';
import { conversationMessagesTable, conversationsTable } from './schema';

/** Field names a `v.object(...)` declares. */
function declared(validator: unknown): Set<string> {
  const fields = (validator as { fields: Record<string, unknown> }).fields;
  return new Set(Object.keys(fields));
}

/** Field names a `defineTable(...)` declares. */
function columns(table: unknown): Set<string> {
  const validator = (
    table as { validator: { fields: Record<string, unknown> } }
  ).validator;
  return new Set(Object.keys(validator.fields));
}

describe('internal record validators cover their whole table', () => {
  const cases = [
    ['conversations', conversationsTable, internalConversationRecordValidator],
    [
      'conversationMessages',
      conversationMessagesTable,
      internalMessageRecordValidator,
    ],
  ] as const;

  it.each(cases)(
    '%s: every column is declared, so no row is unreadable',
    (_name, table, validator) => {
      const missing = [...columns(table)].filter(
        (field) => !declared(validator).has(field),
      );
      expect(missing).toEqual([]);
    },
  );

  it.each(cases)(
    '%s: the validator invents no field the table lacks',
    (_name, table, validator) => {
      // System fields are supplied by Convex, not by the table definition.
      const system = new Set(['_id', '_creationTime']);
      const extra = [...declared(validator)].filter(
        (field) => !system.has(field) && !columns(table).has(field),
      );
      expect(extra).toEqual([]);
    },
  );
});
