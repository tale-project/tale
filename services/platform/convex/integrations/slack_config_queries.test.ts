import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';

// convex-test module map keyed relative to the convex/ root. This file lives at
// convex/integrations/, so resolve glob keys against that base.
const TEST_DIR_FROM_CONVEX_ROOT = 'integrations';
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

const ORG = 'org_cfg';

async function seedSlackCredential(
  t: ReturnType<typeof convexTest>,
  opts: { isActive: boolean; slackAgentSlug?: string },
): Promise<Id<'integrationCredentials'>> {
  return await t.run(async (ctx) =>
    ctx.db.insert('integrationCredentials', {
      organizationId: ORG,
      slug: 'slack',
      status: opts.isActive ? 'active' : 'inactive',
      isActive: opts.isActive,
      authMethod: 'oauth2',
      connectionConfig: opts.slackAgentSlug
        ? { slackAgentSlug: opts.slackAgentSlug }
        : {},
    }),
  );
}

describe('getSlackAgentSlug', () => {
  it('returns the configured agent slug for an active credential', async () => {
    const t = convexTest(schema, modules);
    await seedSlackCredential(t, { isActive: true, slackAgentSlug: 'support' });

    const slug = await t.query(
      internal.integrations.slack_config_queries.getSlackAgentSlug,
      { organizationId: ORG },
    );
    expect(slug).toBe('support');
  });

  it('returns null when the credential is deactivated (not deleted)', async () => {
    const t = convexTest(schema, modules);
    // Deactivated but still carries a slackAgentSlug — inbound must NOT answer,
    // mirroring how the outbound sink (notify_slack) gates on isActive.
    await seedSlackCredential(t, {
      isActive: false,
      slackAgentSlug: 'support',
    });

    const slug = await t.query(
      internal.integrations.slack_config_queries.getSlackAgentSlug,
      { organizationId: ORG },
    );
    expect(slug).toBeNull();
  });

  it('returns null when no slack credential exists', async () => {
    const t = convexTest(schema, modules);
    const slug = await t.query(
      internal.integrations.slack_config_queries.getSlackAgentSlug,
      { organizationId: ORG },
    );
    expect(slug).toBeNull();
  });

  it('returns null for an active credential with no slackAgentSlug', async () => {
    const t = convexTest(schema, modules);
    await seedSlackCredential(t, { isActive: true });

    const slug = await t.query(
      internal.integrations.slack_config_queries.getSlackAgentSlug,
      { organizationId: ORG },
    );
    expect(slug).toBeNull();
  });
});
