import { convexTest } from 'convex-test';
import { defineSchema } from 'convex/server';
import { describe, expect, it } from 'vitest';

import {
  SSO_CONFIG_DOMAIN,
  SSO_CONNECTION_KEY,
} from '../../lib/shared/schemas/enterprise_sso';
import { internal } from '../_generated/api';
import { configCacheTable } from '../lib/config_cache/schema';
import { buildModules } from '../migrations/framework/test_helpers';

// Minimal schema: the internal SSO sign-in reads only the `configCache` mirror.
const schema = defineSchema({ configCache: configCacheTable });
const modules = buildModules(
  import.meta.glob('../../**/*.*s'),
  'enterprise_sso',
);

type ConnArgs = {
  organizationId: string;
  domain?: string;
  enabled?: boolean;
};

/** Seed an enabled OIDC connection for an org into the configCache mirror. */
function seedConnection({ organizationId, domain, enabled = true }: ConnArgs) {
  return {
    organizationId,
    domain: SSO_CONFIG_DOMAIN,
    key: SSO_CONNECTION_KEY,
    enabled,
    syncedAt: 0,
    config: {
      enabled,
      protocol: 'oidc',
      displayName: `SSO ${organizationId}`,
      ...(domain ? { domain } : {}),
      oidc: {
        providerId: 'generic-oidc',
        issuer: `https://idp.${organizationId}.example.com`,
        scopes: ['openid', 'email'],
      },
      provisioning: {
        autoProvisionRole: false,
        defaultRole: 'member',
        roleMappingRules: [],
        autoProvisionTeam: false,
        excludeGroups: [],
      },
    },
  };
}

describe('enterprise_sso internal_queries — multi-org routing (#2082)', () => {
  it('resolveSignInConfig scopes to the requested org, not the first enabled', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert(
        'configCache',
        seedConnection({ organizationId: 'orgA' }),
      );
      await ctx.db.insert(
        'configCache',
        seedConnection({ organizationId: 'orgB' }),
      );
    });

    const orgB = await t.query(
      internal.enterprise_sso.internal_queries.resolveSignInConfig,
      { organizationId: 'orgB' },
    );
    expect(orgB?.organizationId).toBe('orgB');
    expect(orgB?.issuer).toBe('https://idp.orgB.example.com');
  });

  it('discoverByEmail routes by email domain across orgs', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert(
        'configCache',
        seedConnection({ organizationId: 'orgA', domain: 'a-corp.com' }),
      );
      await ctx.db.insert(
        'configCache',
        seedConnection({ organizationId: 'orgB', domain: 'b-corp.com' }),
      );
    });

    const match = await t.query(
      internal.enterprise_sso.internal_queries.discoverByEmail,
      { email: 'user@b-corp.com' },
    );
    expect(match?.organizationId).toBe('orgB');
    expect(match?.protocol).toBe('oidc');
  });

  it('discoverByEmail falls back to the first enabled connection on no domain match', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert(
        'configCache',
        seedConnection({ organizationId: 'orgA', domain: 'a-corp.com' }),
      );
    });

    const match = await t.query(
      internal.enterprise_sso.internal_queries.discoverByEmail,
      { email: 'user@unknown.com' },
    );
    expect(match?.organizationId).toBe('orgA');
  });
});
