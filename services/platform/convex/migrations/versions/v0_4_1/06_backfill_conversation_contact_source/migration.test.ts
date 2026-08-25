// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR =
  'migrations/versions/v0_4_1/06_backfill_conversation_contact_source';

const ORG = 'org_contact_source_backfill';

// The harness runs the full ritual automatically: up through the real runner,
// TRUE handler idempotency over migrated state, digest-equal down (the seeded
// world must come back byte-for-byte), ledger transitions, snapshot hygiene,
// and the destructive gate. This file provides DATA + migration-specific truth.
defineMigrationTest({
  id: '0.4.1/06_backfill_conversation_contact_source',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    // The row this migration exists for: minted by email ingest under the
    // wrong source stamp, with provenance already in metadata.
    await ctx.db.insert('contacts', {
      organizationId: ORG,
      email: 'inbox@example.com',
      name: 'Inbox Correspondent',
      source: 'manual_import',
      metadata: {
        createdFrom: 'email_sync',
        firstEmailDate: '2026-01-15T10:00:00.000Z',
      },
    });

    // Outbound sent-folder sync — same bug, different createdFrom tag.
    await ctx.db.insert('contacts', {
      organizationId: ORG,
      email: 'sent@example.com',
      name: 'Sent Correspondent',
      source: 'manual_import',
      metadata: {
        createdFrom: 'sent_email_sync',
        firstEmailDate: '2026-01-16T10:00:00.000Z',
      },
    });

    // A real manual import: no email-sync metadata. Must stay untouched so a
    // typed-in contact does not flip to Conversation.
    await ctx.db.insert('contacts', {
      organizationId: ORG,
      email: 'typed@example.com',
      name: 'Typed In',
      source: 'manual_import',
    });
  },

  async expectUp(world) {
    const rows = await world.run(
      async (ctx: {
        // oxlint-disable-next-line typescript/no-explicit-any -- convex-test world db
        db: any;
      }) => {
        const all = await ctx.db.query('contacts').collect();
        return (
          all as Array<{
            email?: string;
            source: string;
          }>
        ).map((row) => ({ email: row.email, source: row.source }));
      },
    );
    const byEmail = new Map(rows.map((row) => [row.email, row.source]));

    expect(byEmail.get('inbox@example.com')).toBe('conversation');
    expect(byEmail.get('sent@example.com')).toBe('conversation');
    expect(byEmail.get('typed@example.com')).toBe('manual_import');
  },
});
