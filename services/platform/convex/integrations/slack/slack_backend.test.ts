import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import schema from '../../schema';

// convex-test needs a module map keyed relative to the convex/ root. This file
// lives at convex/integrations/slack/, so glob from two levels up and strip the
// leading '../../' so e.g. internal.integrations.slack_installations resolves.
// convex-test needs a module map keyed relative to the convex/ root. Vite
// returns glob keys relative to THIS file's dir (convex/integrations/slack/)
// with collapsed `../` depth, so resolve each against that base to recover a
// convex-root-relative path (e.g. `integrations/slack/internal_mutations.ts`).
const TEST_DIR_FROM_CONVEX_ROOT = 'integrations/slack';
function toConvexRootKey(globKey: string): string {
  const stack: string[] = [];
  for (const part of `${TEST_DIR_FROM_CONVEX_ROOT}/${globKey}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

const rawModules = import.meta.glob('../../**/*.*s');
const modules: Record<string, () => Promise<unknown>> = {};
for (const [key, loader] of Object.entries(rawModules)) {
  modules[toConvexRootKey(key)] = loader;
}

const ORG_A = 'org_a';
const ORG_B = 'org_b';

async function seedSlackCredential(
  t: ReturnType<typeof convexTest>,
  organizationId: string,
): Promise<Id<'integrationCredentials'>> {
  return await t.run(async (ctx) =>
    ctx.db.insert('integrationCredentials', {
      organizationId,
      slug: 'slack',
      status: 'active',
      isActive: true,
      authMethod: 'oauth2',
    }),
  );
}

describe('slack installations routing', () => {
  it('upserts a workspace and resolves the org by team_id', async () => {
    const t = convexTest(schema, modules);
    const credentialId = await seedSlackCredential(t, ORG_A);

    await t.mutation(
      internal.integrations.slack_installations.upsertInstallation,
      {
        teamId: 'T123',
        organizationId: ORG_A,
        slug: 'slack',
        botUserId: 'UBOT',
        credentialId,
      },
    );

    const route = await t.query(
      internal.integrations.slack_installations.resolveOrgBySlackTeamId,
      { teamId: 'T123' },
    );
    expect(route?.organizationId).toBe(ORG_A);
    expect(route?.botUserId).toBe('UBOT');
  });

  it('re-install by the same org patches in place', async () => {
    const t = convexTest(schema, modules);
    const credentialId = await seedSlackCredential(t, ORG_A);

    await t.mutation(
      internal.integrations.slack_installations.upsertInstallation,
      {
        teamId: 'T1',
        organizationId: ORG_A,
        slug: 'slack',
        botUserId: 'U1',
        credentialId,
      },
    );
    await t.mutation(
      internal.integrations.slack_installations.upsertInstallation,
      {
        teamId: 'T1',
        organizationId: ORG_A,
        slug: 'slack',
        botUserId: 'U2',
        credentialId,
      },
    );

    const rows = await t.run(async (ctx) =>
      ctx.db.query('slackInstallations').collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].botUserId).toBe('U2');
  });

  it('rejects a different org claiming an already-mapped workspace', async () => {
    const t = convexTest(schema, modules);
    const credA = await seedSlackCredential(t, ORG_A);
    const credB = await seedSlackCredential(t, ORG_B);

    await t.mutation(
      internal.integrations.slack_installations.upsertInstallation,
      {
        teamId: 'Tshared',
        organizationId: ORG_A,
        slug: 'slack',
        credentialId: credA,
      },
    );

    await expect(
      t.mutation(internal.integrations.slack_installations.upsertInstallation, {
        teamId: 'Tshared',
        organizationId: ORG_B,
        slug: 'slack',
        credentialId: credB,
      }),
    ).rejects.toThrow(/already connected to another organization/);
  });

  it('resolves null for an unknown workspace', async () => {
    const t = convexTest(schema, modules);
    const route = await t.query(
      internal.integrations.slack_installations.resolveOrgBySlackTeamId,
      { teamId: 'nope' },
    );
    expect(route).toBeNull();
  });
});

describe('slack event dedup', () => {
  it('claims an event once; a retry is dropped', async () => {
    const t = convexTest(schema, modules);

    const first = await t.mutation(
      internal.integrations.slack.internal_mutations.claimSlackEvent,
      { eventId: 'Ev123' },
    );
    const second = await t.mutation(
      internal.integrations.slack.internal_mutations.claimSlackEvent,
      { eventId: 'Ev123' },
    );

    expect(first.claimed).toBe(true);
    expect(second.claimed).toBe(false);
  });
});
