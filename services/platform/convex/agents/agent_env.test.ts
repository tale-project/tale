import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
import schema from '../schema';

// convex-test module map keyed relative to the convex/ root. This file lives at
// convex/agents/, so resolve glob keys against that base.
const TEST_DIR_FROM_CONVEX_ROOT = 'agents';
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

const ORG = 'org_appenv';
type T = TestConvex<typeof schema>;

function countEnv(t: T, agentSlug: string) {
  return t.run(
    async (ctx) =>
      (
        await ctx.db
          .query('agentEnv')
          .withIndex('by_org_agent', (q) =>
            q.eq('organizationId', ORG).eq('agentSlug', agentSlug),
          )
          .collect()
      ).length,
  );
}

async function seedEnv(
  t: T,
  agentSlug: string,
  key: string,
  isSecret: boolean,
) {
  await t.mutation(internal.agents.agent_env.upsertAgentEnvInternal, {
    organizationId: ORG,
    agentSlug,
    key,
    isSecret,
    value: isSecret ? undefined : `${key}-value`,
    encryptedValue: isSecret ? `${key}-cipher` : undefined,
    updatedBy: 'system',
  });
}

// `deleteAppAgentEnvInternal` is the app-uninstall env/secrets teardown: it must
// sweep the WHOLE `<app>/` agent namespace — including agents the current
// manifest no longer lists (renamed/removed) — while leaving global agents and
// sibling apps untouched, so a later reinstall starts clean.
describe('deleteAppAgentEnvInternal', () => {
  it('sweeps the app namespace, including stale agents, sparing others', async () => {
    const t = convexTest(schema, modules);

    // Two current agents + one STALE agent no longer in the manifest (the live
    // bug that motivated the namespace sweep over a manifest-keyed loop).
    await seedEnv(t, 'issue-desk/desk-implementer', 'API_BASE', false);
    await seedEnv(t, 'issue-desk/desk-implementer', 'API_TOKEN', true);
    await seedEnv(t, 'issue-desk/desk-reviewer', 'API_TOKEN', true);
    await seedEnv(t, 'issue-desk/desk-coordinator', 'OAUTH_TOKEN', true);

    // Must NOT be swept: a global agent and a sibling app sharing the prefix.
    await seedEnv(t, 'global-helper', 'SHARED_KEY', true);
    await seedEnv(t, 'issue-desk-2/desk-implementer', 'API_TOKEN', true);

    await t.mutation(internal.agents.agent_env.deleteAppAgentEnvInternal, {
      organizationId: ORG,
      appSlug: 'issue-desk',
    });

    expect(await countEnv(t, 'issue-desk/desk-implementer')).toBe(0);
    expect(await countEnv(t, 'issue-desk/desk-reviewer')).toBe(0);
    expect(await countEnv(t, 'issue-desk/desk-coordinator')).toBe(0);
    // The '/' delimiter scopes the sweep: a global agent and a sibling app
    // ('issue-desk-2/...') sort outside ['issue-desk/', 'issue-desk0').
    expect(await countEnv(t, 'global-helper')).toBe(1);
    expect(await countEnv(t, 'issue-desk-2/desk-implementer')).toBe(1);
  });

  it('is a no-op when the app has no agent env', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agents.agent_env.deleteAppAgentEnvInternal, {
      organizationId: ORG,
      appSlug: 'never-configured',
    });
    expect(await countEnv(t, 'never-configured/agent')).toBe(0);
  });
});
