import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api, internal } from '../_generated/api';
import schema from '../schema';

/**
 * Regression tests for multi-org connection resolution: with more than one
 * enabled connection and no org context, sign-in resolution must report
 * `'ambiguous'` (and email discovery must return null on a non-matching
 * domain) instead of silently picking whichever connection the index yields
 * first — the guess sent users to another org's IdP.
 */

// Build the module map keyed from the convex root (same pattern as the SCIM
// http_actions test) so convex-test can resolve the internal queries.
const TEST_DIR_FROM_CONVEX_ROOT = 'enterprise_sso';
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

function oidcConnection(opts: { domain?: string; issuer?: string } = {}) {
  return {
    enabled: true,
    protocol: 'oidc',
    displayName: 'Enterprise SSO',
    ...(opts.domain ? { domain: opts.domain } : {}),
    oidc: {
      providerId: 'entra-id',
      issuer:
        opts.issuer ??
        'https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000/v2.0',
      scopes: ['openid', 'profile', 'email'],
    },
  };
}

function samlConnection() {
  return {
    enabled: true,
    protocol: 'saml',
    displayName: 'Enterprise SSO',
    saml: {
      idpEntityId: 'https://idp.example.com/metadata',
      idpSsoUrl: 'https://idp.example.com/sso',
      idpCertificate: 'MIIC-fake',
    },
  };
}

async function seedConnection(
  t: ReturnType<typeof convexTest>,
  organizationId: string,
  config: Record<string, unknown>,
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('configCache', {
      organizationId,
      domain: 'sso',
      key: 'connection',
      config,
      enabled: config.enabled === true,
      syncedAt: 1_700_000_000_000,
    });
  });
}

describe('resolveSignInConfig without org context', () => {
  it('resolves the connection when exactly one is enabled', async () => {
    const t = convexTest(schema, modules);
    await seedConnection(t, 'org_a', oidcConnection());

    const config = await t.query(
      internal.enterprise_sso.internal_queries.resolveSignInConfig,
      {},
    );

    expect(config).not.toBeNull();
    expect(config).not.toBe('ambiguous');
    if (config && config !== 'ambiguous') {
      expect(config.organizationId).toBe('org_a');
    }
  });

  it('returns "ambiguous" when two orgs have enabled connections', async () => {
    const t = convexTest(schema, modules);
    await seedConnection(t, 'org_a', oidcConnection());
    await seedConnection(t, 'org_b', oidcConnection());

    const config = await t.query(
      internal.enterprise_sso.internal_queries.resolveSignInConfig,
      {},
    );

    expect(config).toBe('ambiguous');
  });

  it('still resolves the pinned org when organizationId is given', async () => {
    const t = convexTest(schema, modules);
    await seedConnection(t, 'org_a', oidcConnection());
    await seedConnection(t, 'org_b', oidcConnection());

    const config = await t.query(
      internal.enterprise_sso.internal_queries.resolveSignInConfig,
      { organizationId: 'org_b' },
    );

    expect(config).not.toBe('ambiguous');
    if (config && config !== 'ambiguous') {
      expect(config.organizationId).toBe('org_b');
    }
  });

  it('ignores disabled rows when counting (one enabled + one disabled resolves)', async () => {
    const t = convexTest(schema, modules);
    await seedConnection(t, 'org_a', { ...oidcConnection(), enabled: false });
    await seedConnection(t, 'org_b', oidcConnection());

    const config = await t.query(
      internal.enterprise_sso.internal_queries.resolveSignInConfig,
      {},
    );

    expect(config).not.toBe('ambiguous');
    if (config && config !== 'ambiguous') {
      expect(config.organizationId).toBe('org_b');
    }
  });
});

describe('resolveSamlConfig without org context', () => {
  it('returns "ambiguous" when two orgs have enabled connections', async () => {
    const t = convexTest(schema, modules);
    await seedConnection(t, 'org_a', samlConnection());
    await seedConnection(t, 'org_b', samlConnection());

    const config = await t.query(
      internal.enterprise_sso.internal_queries.resolveSamlConfig,
      {},
    );

    expect(config).toBe('ambiguous');
  });
});

describe('isConfigured (login page probe)', () => {
  it('reports multiple:false with a single enabled connection', async () => {
    const t = convexTest(schema, modules);
    await seedConnection(t, 'org_a', oidcConnection());

    const probe = await t.query(api.enterprise_sso.queries.isConfigured, {});

    expect(probe.enabled).toBe(true);
    expect(probe.multiple).toBe(false);
  });

  it('reports multiple:true with two enabled connections', async () => {
    const t = convexTest(schema, modules);
    await seedConnection(t, 'org_a', oidcConnection());
    await seedConnection(t, 'org_b', oidcConnection());

    const probe = await t.query(api.enterprise_sso.queries.isConfigured, {});

    expect(probe.enabled).toBe(true);
    expect(probe.multiple).toBe(true);
  });
});

describe('listSelectable (manual picker for domain-less connections)', () => {
  it('lists only enabled connections without an email domain', async () => {
    const t = convexTest(schema, modules);
    await seedConnection(t, 'org_domainless', oidcConnection());
    await seedConnection(
      t,
      'org_routed',
      oidcConnection({ domain: 'a.example' }),
    );
    await seedConnection(t, 'org_disabled', {
      ...oidcConnection(),
      enabled: false,
    });

    const list = await t.query(api.enterprise_sso.queries.listSelectable, {});

    expect(list).toEqual([
      {
        organizationId: 'org_domainless',
        displayName: 'Enterprise SSO',
        protocol: 'oidc',
      },
    ]);
  });
});

describe('discoverByEmail with several enabled connections', () => {
  it('routes to the org whose configured domain matches the email', async () => {
    const t = convexTest(schema, modules);
    await seedConnection(t, 'org_a', oidcConnection({ domain: 'a.example' }));
    await seedConnection(t, 'org_b', oidcConnection({ domain: 'b.example' }));

    const match = await t.query(
      internal.enterprise_sso.internal_queries.discoverByEmail,
      { email: 'user@b.example' },
    );

    expect(match).toEqual({ organizationId: 'org_b', protocol: 'oidc' });
  });

  it('returns null instead of guessing when no domain matches', async () => {
    const t = convexTest(schema, modules);
    await seedConnection(t, 'org_a', oidcConnection({ domain: 'a.example' }));
    await seedConnection(t, 'org_b', oidcConnection({ domain: 'b.example' }));

    const match = await t.query(
      internal.enterprise_sso.internal_queries.discoverByEmail,
      { email: 'user@other.example' },
    );

    expect(match).toBeNull();
  });

  it('keeps the single-connection fallback (no domain configured)', async () => {
    const t = convexTest(schema, modules);
    await seedConnection(t, 'org_a', oidcConnection());

    const match = await t.query(
      internal.enterprise_sso.internal_queries.discoverByEmail,
      { email: 'user@anything.example' },
    );

    expect(match).toEqual({ organizationId: 'org_a', protocol: 'oidc' });
  });
});
