// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR =
  'migrations/versions/v0_4_1/05_backfill_mail_attachment_received_at';

const ORG = 'org_mail_backfill';
const CREATED = 1_700_000_000_000;

// The harness runs the full ritual automatically: up through the real runner,
// TRUE handler idempotency over migrated state, digest-equal down (the seeded
// world must come back byte-for-byte), ledger transitions, snapshot hygiene,
// and the destructive gate. This file provides DATA + migration-specific truth.
defineMigrationTest({
  id: '0.4.1/05_backfill_mail_attachment_received_at',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    const conversationId: string = await ctx.db.insert('conversations', {
      organizationId: ORG,
      subject: 'Application',
      status: 'open',
      channel: 'email',
    });

    // The row this migration exists for: bound before the field existed, so it
    // is invisible to the mail index until stamped.
    await ctx.db.insert('fileMetadata', {
      organizationId: ORG,
      storageId: 'blob_unstamped',
      fileName: 'cv.pdf',
      contentType: 'application/pdf',
      size: 1024,
      source: 'imap-smtp',
      conversationId,
    });

    // Already stamped by the binder: `up` must leave it exactly as it is, and
    // it must not be given the creation time instead.
    await ctx.db.insert('fileMetadata', {
      organizationId: ORG,
      storageId: 'blob_stamped',
      fileName: 'offer.pdf',
      contentType: 'application/pdf',
      size: 2048,
      source: 'imap-smtp',
      conversationId,
      mailReceivedAt: CREATED - 90_000,
    });

    // Never arrived by mail. Nothing to stamp — a Document Hub upload must not
    // be pulled into the mail index.
    await ctx.db.insert('fileMetadata', {
      organizationId: ORG,
      storageId: 'blob_unbound',
      fileName: 'handbook.pdf',
      contentType: 'application/pdf',
      size: 4096,
      source: 'user',
    });
  },

  async expectUp(world) {
    const rows = await world.run(
      async (ctx: {
        // oxlint-disable-next-line typescript/no-explicit-any -- convex-test world db
        db: any;
      }) => {
        const all = await ctx.db.query('fileMetadata').collect();
        return (
          all as Array<{
            storageId: string;
            mailReceivedAt?: number;
            _creationTime: number;
          }>
        ).map((row) => ({
          storageId: row.storageId,
          stamp: row.mailReceivedAt,
          created: row._creationTime,
        }));
      },
    );
    const byId = new Map(rows.map((row) => [row.storageId, row]));

    // Stamped from its own creation time, so it now sits in the mail index.
    const unstamped = byId.get('blob_unstamped');
    expect(unstamped?.stamp).toBe(unstamped?.created);

    // An existing stamp is the binder's, and closer to the truth than the
    // row's creation time — `up` must not overwrite it.
    expect(byId.get('blob_stamped')?.stamp).toBe(CREATED - 90_000);

    // Not mail: still absent from the index.
    expect(byId.get('blob_unbound')?.stamp).toBeUndefined();
  },
});
