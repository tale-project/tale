import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../../../../_generated/api';
import type { Id } from '../../../../_generated/dataModel';
import schema from '../../../../schema';
import { buildModules } from '../../../framework/test_helpers';
import { meta } from './meta';

const DIR =
  'migrations/versions/v0_2_90/02_backfill_conversation_integration_name';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

const ORG = 'org_conv_backfill';

type Test = ReturnType<typeof convexTest>;

async function seedConversation(
  t: Test,
  integrationName?: string,
): Promise<Id<'conversations'>> {
  return await t.run((ctx) =>
    ctx.db.insert('conversations', {
      organizationId: ORG,
      subject: 'Hello',
      status: 'open',
      ...(integrationName === undefined ? {} : { integrationName }),
    }),
  );
}

async function seedMessage(
  t: Test,
  conversationId: Id<'conversations'>,
  fields: { integrationName?: string; deliveredAt?: number },
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('conversationMessages', {
      organizationId: ORG,
      conversationId,
      channel: 'email',
      direction: 'inbound',
      deliveryState: 'delivered',
      content: 'hi',
      ...fields,
    });
  });
}

async function readIntegrationName(
  t: Test,
  id: Id<'conversations'>,
): Promise<string | undefined> {
  const row = await t.run((ctx) => ctx.db.get(id));
  return row?.integrationName;
}

function applyUp(t: Test) {
  return t.action(internal.migrations.framework.entrypoints.applyUp, {
    only: [meta.id],
  });
}

function applyDown(t: Test) {
  return t.action(internal.migrations.framework.entrypoints.applyDown, {
    to: '0.2.89',
    only: [meta.id],
  });
}

describe('0.2.90/02 backfill_conversation_integration_name', () => {
  it('up stamps the LATEST message integration; down clears the stamp; up re-stamps (round trip)', async () => {
    const t = convexTest(schema, modules);
    const id = await seedConversation(t);
    await seedMessage(t, id, { integrationName: 'outlook', deliveredAt: 100 });
    await seedMessage(t, id, { integrationName: 'gmail', deliveredAt: 200 });
    // Newest by deliveredAt but names no integration — must be skipped over.
    await seedMessage(t, id, { deliveredAt: 300 });

    await applyUp(t);
    expect(await readIntegrationName(t, id)).toBe('gmail');

    await applyDown(t);
    expect(await readIntegrationName(t, id)).toBeUndefined();

    await applyUp(t);
    expect(await readIntegrationName(t, id)).toBe('gmail');
  });

  it('up leaves an underivable conversation unset', async () => {
    const t = convexTest(schema, modules);
    const noMessages = await seedConversation(t);
    const unnamedMessages = await seedConversation(t);
    await seedMessage(t, unnamedMessages, { deliveredAt: 100 });

    await applyUp(t);
    expect(await readIntegrationName(t, noMessages)).toBeUndefined();
    expect(await readIntegrationName(t, unnamedMessages)).toBeUndefined();
  });

  it('up treats an empty-string integrationName as unset and stamps it', async () => {
    const t = convexTest(schema, modules);
    const id = await seedConversation(t, '');
    await seedMessage(t, id, { integrationName: 'imap_smtp', deliveredAt: 50 });

    await applyUp(t);
    expect(await readIntegrationName(t, id)).toBe('imap_smtp');
  });

  it('up leaves an already-set value untouched; down preserves a value up would not derive', async () => {
    const t = convexTest(schema, modules);
    // Operator pinned 'outlook' although the latest message says 'gmail'.
    const id = await seedConversation(t, 'outlook');
    await seedMessage(t, id, { integrationName: 'gmail', deliveredAt: 100 });

    await applyUp(t);
    expect(await readIntegrationName(t, id)).toBe('outlook');

    await applyDown(t);
    expect(await readIntegrationName(t, id)).toBe('outlook');
  });
});
