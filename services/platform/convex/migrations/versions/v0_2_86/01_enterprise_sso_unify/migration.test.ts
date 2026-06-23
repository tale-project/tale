import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../../../../_generated/api';
import {
  buildModules,
  historicalSchema,
} from '../../../framework/test_helpers';
import { meta } from './meta';

const DIR = 'migrations/versions/v0_2_86/01_enterprise_sso_unify';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

const ORG = 'org_sso_migrate';

async function seedLegacyProvider(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    await ctx.db.insert('ssoProviders', {
      organizationId: ORG,
      providerId: 'entra-id',
      issuer: 'https://login.microsoftonline.com/tid/v2.0',
      clientIdEncrypted: 'enc:client-id',
      clientSecretEncrypted: 'enc:client-secret',
      scopes: ['openid', 'email', 'profile'],
      autoProvisionRole: true,
      roleMappingRules: [
        { source: 'group', pattern: '*admin*', targetRole: 'admin' },
      ],
      defaultRole: 'member',
      providerFeatures: {
        entraId: {
          autoProvisionTeam: true,
          excludeGroups: ['Everyone'],
          enableOneDriveAccess: true,
          domainHint: 'acme.com',
        },
      },
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    });
  });
}

describe('0.2.86/01 enterprise_sso_unify', () => {
  it('up maps ssoProviders → ssoConnections; down deletes it', async () => {
    const t = convexTest(historicalSchema, modules);
    await seedLegacyProvider(t);

    await t.action(internal.migrations.framework.entrypoints.applyUp, {
      only: [meta.id],
    });

    const conns = await t.run((ctx) =>
      ctx.db.query('ssoConnections').collect(),
    );
    expect(conns).toHaveLength(1);
    expect(conns[0]).toMatchObject({
      organizationId: ORG,
      protocol: 'oidc',
      enabled: true,
      autoProvisionRole: true,
      defaultRole: 'member',
      autoProvisionTeam: true,
      excludeGroups: ['Everyone'],
      scimEnabled: false,
    });
    expect(conns[0].oidcConfig).toMatchObject({
      providerId: 'entra-id',
      issuer: 'https://login.microsoftonline.com/tid/v2.0',
      clientIdEncrypted: 'enc:client-id',
      clientSecretEncrypted: 'enc:client-secret',
      enableOneDriveAccess: true,
      domainHint: 'acme.com',
    });
    expect(conns[0].roleMappingRules).toHaveLength(1);
    // Legacy row is left intact (dropped by a later migration).
    expect(
      await t.run((ctx) => ctx.db.query('ssoProviders').collect()),
    ).toHaveLength(1);

    // Idempotent: a second up does not duplicate the connection.
    await t.action(internal.migrations.framework.entrypoints.applyUp, {
      only: [meta.id],
    });
    expect(
      await t.run((ctx) => ctx.db.query('ssoConnections').collect()),
    ).toHaveLength(1);

    // Down removes the migration-created connection.
    await t.action(internal.migrations.framework.entrypoints.applyDown, {
      to: '0.2.85',
      only: [meta.id],
    });
    expect(
      await t.run((ctx) => ctx.db.query('ssoConnections').collect()),
    ).toHaveLength(0);
  });

  it('records the migration in the ledger as applied then rolledBack', async () => {
    const t = convexTest(historicalSchema, modules);
    await seedLegacyProvider(t);

    await t.action(internal.migrations.framework.entrypoints.applyUp, {
      only: [meta.id],
    });
    let row = await t.run((ctx) =>
      ctx.db
        .query('migrationLedger')
        .withIndex('by_migrationId', (q) => q.eq('migrationId', meta.id))
        .unique(),
    );
    expect(row?.status).toBe('applied');

    await t.action(internal.migrations.framework.entrypoints.applyDown, {
      to: '0.2.85',
      only: [meta.id],
    });
    row = await t.run((ctx) =>
      ctx.db
        .query('migrationLedger')
        .withIndex('by_migrationId', (q) => q.eq('migrationId', meta.id))
        .unique(),
    );
    expect(row?.status).toBe('rolledBack');
  });
});
