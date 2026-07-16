// Drives address-based routing through its REAL path: an inbound conversation
// created via `createConversationWithMessage` runs the built-in
// `applyAddressRouting` hook before the message-received event is emitted. No
// automation, no workflow action — routing is a governance feature applied
// inline at ingest, gated by the org's `conversation_routing` policy. Registers
// the real betterAuth component so the team-in-org validation runs.

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it, vi } from 'vitest';

import { components, internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import betterAuthSchema from '../betterAuth/schema';
import schema from '../schema';

const TEST_DIR_FROM_CONVEX_ROOT = 'conversations';
function toConvexRootKey(globKey: string): string {
  const stack: string[] = [];
  for (const part of `${TEST_DIR_FROM_CONVEX_ROOT}/${globKey}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}
const rawModules = import.meta.glob('../**/*.*s');
const modules: Record<string, () => Promise<unknown>> = {};
for (const [key, loader] of Object.entries(rawModules)) {
  modules[toConvexRootKey(key)] = loader;
}
const authModules = import.meta.glob('../betterAuth/**/*.*s');

const ORG = 'org_routing';
const OTHER_ORG = 'org_routing_other';
const MEMBER = 'user_routing_member';
type T = TestConvex<typeof schema>;

function newWorld(): T {
  const t = convexTest(schema, modules);
  t.registerComponent('betterAuth', betterAuthSchema, authModules);
  return t;
}

async function seedMember(t: T, userId: string, org = ORG): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId: `m_${userId}`,
      userId,
      organizationId: org,
      role: 'member',
      createdAt: 0,
    });
  });
}

async function seedTeam(t: T, org = ORG): Promise<string> {
  return t.run(async (ctx) => {
    const created = await ctx.runMutation(
      components.betterAuth.adapter.create,
      {
        input: {
          model: 'team',
          data: {
            name: `Team ${org}`,
            organizationId: org,
            createdAt: 0,
            updatedAt: 0,
          },
        },
      },
    );
    const record = created as { _id?: string; id?: string };
    return String(record._id ?? record.id);
  });
}

async function seedRoutingRules(
  t: T,
  rules: Array<{ address: string; teamId?: string; userId?: string }>,
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('configCache', {
      organizationId: ORG,
      domain: 'governance',
      key: 'conversation_routing',
      config: { rules },
      syncedAt: 0,
    });
  });
}

// Ingest a new INBOUND conversation the way the email sync path does; the
// address-routing hook fires inside this mutation, before the event emit.
async function ingestInbound(
  t: T,
  toAddress: string,
): Promise<Id<'conversations'>> {
  const res = await t.mutation(
    internal.conversations.internal_mutations.createConversationWithMessage,
    {
      organizationId: ORG,
      subject: 'Inbound',
      channel: 'email',
      metadata: { to: [{ address: toAddress }] },
      initialMessage: {
        sender: 'customer@example.com',
        content: 'hello',
        isCustomer: true,
      },
    },
  );
  return res.conversationId;
}

async function conv(t: T, id: Id<'conversations'>) {
  return t.run((ctx) => ctx.db.get(id));
}

describe('address routing at inbound ingest', () => {
  it('assigns the team the recipient address maps to', async () => {
    const t = newWorld();
    const teamId = await seedTeam(t);
    await seedRoutingRules(t, [{ address: 'billing@acme.test', teamId }]);
    const id = await ingestInbound(t, 'billing@acme.test');
    expect((await conv(t, id))?.assigneeTeamId).toBe(teamId);
  });

  it('assigns the person the recipient address maps to', async () => {
    const t = newWorld();
    await seedMember(t, MEMBER);
    await seedRoutingRules(t, [{ address: 'vip@acme.test', userId: MEMBER }]);
    const id = await ingestInbound(t, 'vip@acme.test');
    expect((await conv(t, id))?.assigneeUserId).toBe(MEMBER);
  });

  it('matches the address case-insensitively', async () => {
    const t = newWorld();
    const teamId = await seedTeam(t);
    await seedRoutingRules(t, [{ address: 'Billing@Acme.Test', teamId }]);
    const id = await ingestInbound(t, 'billing@acme.test');
    expect((await conv(t, id))?.assigneeTeamId).toBe(teamId);
  });

  it('leaves the conversation unassigned when no rule matches', async () => {
    const t = newWorld();
    const teamId = await seedTeam(t);
    await seedRoutingRules(t, [{ address: 'billing@acme.test', teamId }]);
    const id = await ingestInbound(t, 'support@acme.test');
    const c = await conv(t, id);
    expect(c?.assigneeTeamId).toBeUndefined();
    expect(c?.assigneeUserId).toBeUndefined();
  });

  it('leaves the conversation unassigned when the org has no routing policy', async () => {
    const t = newWorld();
    const id = await ingestInbound(t, 'billing@acme.test');
    expect((await conv(t, id))?.assigneeTeamId).toBeUndefined();
  });

  it('never breaks ingest on a stale rule (team from another org) — routing is skipped', async () => {
    const t = newWorld();
    // The matched rule points at a team from another org; assignment throws
    // and applyAddressRouting swallows it with a console.warn. Suppress the log
    // (also avoids a worker-teardown RPC race on the pending console line) and
    // assert it fired.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const foreignTeam = await seedTeam(t, OTHER_ORG);
      await seedRoutingRules(t, [
        { address: 'billing@acme.test', teamId: foreignTeam },
      ]);
      const id = await ingestInbound(t, 'billing@acme.test');
      const c = await conv(t, id);
      expect(c).not.toBeNull();
      expect(c?.assigneeTeamId).toBeUndefined();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
