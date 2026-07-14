// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';
import type { WorldSeedCtx } from '../../../testing/harness.testkit';

const DIR =
  'migrations/versions/v0_3_4/44_realign_conversation_last_message_at';
const ORG = 'org_conv_last_message_at';

async function seedConversation(
  ctx: WorldSeedCtx,
  subject: string,
  lastMessageAt?: number,
): Promise<unknown> {
  return await ctx.db.insert('conversations', {
    organizationId: ORG,
    subject,
    status: 'open',
    ...(lastMessageAt === undefined ? {} : { lastMessageAt }),
  });
}

async function seedMessage(
  ctx: WorldSeedCtx,
  conversationId: unknown,
  sentAt: number,
): Promise<void> {
  await ctx.db.insert('conversationMessages', {
    organizationId: ORG,
    conversationId,
    channel: 'email',
    direction: 'inbound',
    deliveryState: 'delivered',
    content: 'hi',
    sentAt,
    deliveredAt: sentAt,
  });
}

async function lastMessageAtBySubject(world: {
  run<T>(fn: (ctx: WorldSeedCtx) => Promise<T>): Promise<T>;
}): Promise<Record<string, number | undefined>> {
  const rows = await world.run((ctx) =>
    ctx.db.query('conversations').collect(),
  );
  const out: Record<string, number | undefined> = {};
  for (const row of rows as Array<Record<string, unknown>>) {
    out[String(row.subject)] = row.lastMessageAt as number | undefined;
  }
  return out;
}

defineMigrationTest({
  id: '0.3.4/44_realign_conversation_last_message_at',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    const wrongSort = await seedConversation(ctx, 'Wrong sort', 5_000);
    await seedMessage(ctx, wrongSort, 1_000);

    const alreadyAligned = await seedConversation(
      ctx,
      'Already aligned',
      2_000,
    );
    await seedMessage(ctx, alreadyAligned, 2_000);
  },

  async expectUp(world) {
    const bySubject = await lastMessageAtBySubject(world);
    expect(bySubject['Wrong sort']).toBe(1_000);
    expect(bySubject['Already aligned']).toBe(2_000);
  },
});
