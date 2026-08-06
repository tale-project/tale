import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
import schema from '../schema';

// convex-test module map keyed relative to the convex/ root (this file is at
// convex/notifications/), mirroring queries.test.ts.
const TEST_DIR_FROM_CONVEX_ROOT = 'notifications';
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

const ORG = 'org_mail';
const OTHER_ORG = 'org_other';

type T = TestConvex<typeof schema>;

async function seedCredential(
  t: T,
  overrides: {
    organizationId?: string;
    connectorSlug?: string;
    status?: 'active' | 'disabled' | 'needs-reauth';
    isDefault?: boolean;
    name?: string;
  } = {},
) {
  return t.run(async (ctx) =>
    ctx.db.insert('connectorCredentials', {
      organizationId: overrides.organizationId ?? ORG,
      connectorSlug: overrides.connectorSlug ?? 'imap-smtp',
      authMethod: 'basic',
      name: overrides.name ?? 'Mailbox',
      encryptedData: {
        ciphertext: 'x',
        nonce: 'y',
        authTag: 'z',
        keyFingerprint: 'k',
      },
      isDefault: overrides.isDefault ?? false,
      status: overrides.status ?? 'active',
      createdBy: 'user_1',
      createdAt: 0,
      updatedAt: 0,
    }),
  );
}

// This query decides WHICH mailbox sends an org's actionable notification
// mail, so its org scoping is a tenant-isolation boundary, not a filter
// detail: a leak here would send one org's notifications out of another org's
// mailbox.
describe('listActiveMailCredentialsInternal', () => {
  it('returns only the asking org rows', async () => {
    const t = convexTest(schema, modules);
    await seedCredential(t, { name: 'Ours' });
    await seedCredential(t, { organizationId: OTHER_ORG, name: 'Theirs' });

    const rows = await t.query(
      internal.notifications.email_notification_queries
        .listActiveMailCredentialsInternal,
      { organizationId: ORG },
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.connectorSlug).toBe('imap-smtp');
  });

  it('skips credentials that are not active', async () => {
    const t = convexTest(schema, modules);
    await seedCredential(t, { status: 'disabled' });
    await seedCredential(t, { status: 'needs-reauth', name: 'Stale' });

    const rows = await t.query(
      internal.notifications.email_notification_queries
        .listActiveMailCredentialsInternal,
      { organizationId: ORG },
    );

    expect(rows).toEqual([]);
  });

  it('skips connectors that do not carry mail', async () => {
    const t = convexTest(schema, modules);
    await seedCredential(t, { connectorSlug: 'shopify' });

    const rows = await t.query(
      internal.notifications.email_notification_queries
        .listActiveMailCredentialsInternal,
      { organizationId: ORG },
    );

    expect(rows).toEqual([]);
  });

  it('reports which credential is the default so the caller can prefer it', async () => {
    const t = convexTest(schema, modules);
    await seedCredential(t, { name: 'Secondary', isDefault: false });
    await seedCredential(t, { name: 'Primary', isDefault: true });

    const rows = await t.query(
      internal.notifications.email_notification_queries
        .listActiveMailCredentialsInternal,
      { organizationId: ORG },
    );

    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.isDefault)).toHaveLength(1);
  });

  it('returns nothing when the org has no mail credential at all', async () => {
    const t = convexTest(schema, modules);

    const rows = await t.query(
      internal.notifications.email_notification_queries
        .listActiveMailCredentialsInternal,
      { organizationId: ORG },
    );

    expect(rows).toEqual([]);
  });
});
