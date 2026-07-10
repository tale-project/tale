// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';
import type { WorldSeedCtx } from '../../../testing/harness.testkit';

const DIR =
  'migrations/versions/v0_2_90/02_backfill_conversation_integration_name';
const ORG = 'org_conv_backfill';

async function seedConversation(
  ctx: WorldSeedCtx,
  subject: string,
  integrationName?: string,
): Promise<unknown> {
  return await ctx.db.insert('conversations', {
    organizationId: ORG,
    subject,
    status: 'open',
    ...(integrationName === undefined ? {} : { integrationName }),
  });
}

async function seedMessage(
  ctx: WorldSeedCtx,
  conversationId: unknown,
  fields: { integrationName?: string; deliveredAt?: number },
): Promise<void> {
  await ctx.db.insert('conversationMessages', {
    organizationId: ORG,
    conversationId,
    channel: 'email',
    direction: 'inbound',
    deliveryState: 'delivered',
    content: 'hi',
    ...fields,
  });
}

async function integrationNameBySubject(world: {
  run<T>(fn: (ctx: WorldSeedCtx) => Promise<T>): Promise<T>;
}): Promise<Record<string, string | undefined>> {
  const rows = await world.run((ctx) =>
    ctx.db.query('conversations').collect(),
  );
  const out: Record<string, string | undefined> = {};
  for (const row of rows as Array<Record<string, unknown>>) {
    out[String(row.subject)] = row.integrationName as string | undefined;
  }
  return out;
}

// The harness runs the standard ritual automatically: up through the real
// runner, true handler idempotency over migrated state, down restoring the
// seed digest byte-for-byte (the stamp cleared; the operator-pinned value
// preserved because it differs from the derived one), and the ledger
// transitions. The empty-string edge cannot round-trip ('' would come back
// unset), so it lives in the case below.
defineMigrationTest({
  id: '0.2.90/02_backfill_conversation_integration_name',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    // Latest message names 'gmail'; the newest row names none and must be
    // skipped over.
    const stamped = await seedConversation(ctx, 'Stamped');
    await seedMessage(ctx, stamped, {
      integrationName: 'outlook',
      deliveredAt: 100,
    });
    await seedMessage(ctx, stamped, {
      integrationName: 'gmail',
      deliveredAt: 200,
    });
    await seedMessage(ctx, stamped, { deliveredAt: 300 });

    // Underivable: no messages at all / messages naming no integration.
    await seedConversation(ctx, 'No messages');
    const unnamed = await seedConversation(ctx, 'Unnamed messages');
    await seedMessage(ctx, unnamed, { deliveredAt: 100 });

    // Operator pinned 'outlook' although the latest message says 'gmail' —
    // up must leave it and down must preserve it.
    const pinned = await seedConversation(ctx, 'Pinned', 'outlook');
    await seedMessage(ctx, pinned, {
      integrationName: 'gmail',
      deliveredAt: 100,
    });
  },

  async expectUp(world) {
    expect(await integrationNameBySubject(world)).toEqual({
      Stamped: 'gmail',
      'No messages': undefined,
      'Unnamed messages': undefined,
      Pinned: 'outlook',
    });
  },

  cases: {
    'up treats an empty-string integrationName as unset and stamps it': async (
      world,
    ) => {
      await world.run(async (ctx) => {
        const id = await seedConversation(ctx, 'Empty string', '');
        await seedMessage(ctx, id, {
          integrationName: 'imap_smtp',
          deliveredAt: 50,
        });
      });

      await world.applyUpOnly();

      const bySubject = await integrationNameBySubject(world);
      expect(bySubject['Empty string']).toBe('imap_smtp');
    },
  },
});
