/**
 * Transactional invariants of the connector-credential CRUD, driven
 * through the REAL registered functions: the internal mutations exactly as
 * the `'use node'` actions and the row-carrying migration call them, and the
 * public secret-free writes (`deleteCredential`, `setDefaultCredential`)
 * through the full auth chain — a real betterAuth component organization +
 * member row and a `withIdentity` caller, mirroring
 * `provider_credentials/mutations.test.ts`.
 */

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api, components, internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import betterAuthSchema from '../betterAuth/schema';
import schema from '../schema';

const TEST_DIR_FROM_CONVEX_ROOT = 'connector_credentials';
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

// convex-test surfaces ConvexError data as a (possibly double-encoded) JSON
// string; unwrap it to the structured payload — same helper as
// provider_credentials/mutations.test.ts.
function dataOf(err: unknown): Record<string, unknown> | undefined {
  if (err === null || typeof err !== 'object' || !('data' in err)) {
    return undefined;
  }
  let data: unknown = (err as { data: unknown }).data;
  for (let i = 0; i < 3 && typeof data === 'string'; i++) {
    try {
      data = JSON.parse(data);
    } catch {
      return undefined;
    }
  }
  if (typeof data !== 'object' || data === null) {
    return undefined;
  }
  return data as Record<string, unknown>;
}

async function catchCode(
  fn: () => Promise<unknown>,
): Promise<string | undefined> {
  try {
    await fn();
  } catch (err) {
    const candidate: unknown = dataOf(err)?.code;
    return typeof candidate === 'string' ? candidate : undefined;
  }
  return undefined;
}

type T = TestConvex<typeof schema>;

function newWorld(): T {
  const t = convexTest(schema, modules);
  t.registerComponent('betterAuth', betterAuthSchema, authModules);
  return t;
}

/** Fixture ciphertext — the internal mutations treat it as opaque. */
const CIPHER = {
  ciphertext: 'ct-fixture',
  nonce: 'nonce-fixture',
  authTag: 'tag-fixture',
  keyFingerprint: 'fp-fixture',
};

const ORG = 'org_ic_mutations';
const OTHER_ORG = 'org_ic_other';

interface InsertOverrides {
  organizationId?: string;
  connectorSlug?: string;
  authMethod?: 'api-key' | 'bearer' | 'basic' | 'oauth2';
  name?: string;
  endpointUrl?: string;
  maskedPreview?: string;
  isDefault?: boolean;
  status?: 'active' | 'disabled' | 'needs-reauth';
  statusDetail?: string;
  createdBy?: string;
}

/** Insert through the real internal mutation. */
async function insert(
  t: T,
  overrides: InsertOverrides = {},
): Promise<Id<'connectorCredentials'>> {
  const {
    organizationId = ORG,
    connectorSlug = 'github',
    authMethod = 'bearer',
    name = 'Primary token',
    status = 'active',
    createdBy = 'user_1',
    ...optional
  } = overrides;
  return await t.mutation(
    internal.connector_credentials.mutations.insertCredentialInternal,
    {
      organizationId,
      connectorSlug,
      authMethod,
      name,
      encryptedData: CIPHER,
      status,
      createdBy,
      ...(optional.endpointUrl !== undefined && {
        endpointUrl: optional.endpointUrl,
      }),
      ...(optional.maskedPreview !== undefined && {
        maskedPreview: optional.maskedPreview,
      }),
      ...(optional.isDefault !== undefined && {
        isDefault: optional.isDefault,
      }),
      ...(optional.statusDetail !== undefined && {
        statusDetail: optional.statusDetail,
      }),
    },
  );
}

async function getRow(
  t: T,
  id: Id<'connectorCredentials'>,
): Promise<Doc<'connectorCredentials'> | null> {
  return await t.run((ctx) => ctx.db.get(id));
}

/** Create a betterAuth organization; returns its component `_id`. */
async function seedAuthOrg(t: T, slug: string): Promise<string> {
  return await t.run(async (ctx) => {
    const created = await ctx.runMutation(
      components.betterAuth.adapter.create,
      {
        input: {
          model: 'organization',
          data: { name: slug, slug, createdAt: 0 },
        },
      },
    );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- adapter returns the created record as unknown
    return (created as { _id: string })._id;
  });
}

async function seedAuthMember(
  t: T,
  organizationId: string,
  userId: string,
  role: string,
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: 'member',
        data: { organizationId, userId, role, createdAt: 0 },
      },
    });
  });
}

describe('insertCredentialInternal', () => {
  it('makes the first credential of an (org, connector) pair the default; the second stays non-default', async () => {
    const t = newWorld();
    const firstId = await insert(t, { name: 'First' });
    const secondId = await insert(t, { name: 'Second' });
    expect((await getRow(t, firstId))?.isDefault).toBe(true);
    expect((await getRow(t, secondId))?.isDefault).toBe(false);

    // A different connector starts its own pair — its first row is a default.
    const otherConnector = await insert(t, {
      connectorSlug: 'slack',
      authMethod: 'oauth2',
      name: 'First',
    });
    expect((await getRow(t, otherConnector))?.isDefault).toBe(true);
  });

  it('an explicit isDefault demotes the previous default in the same transaction', async () => {
    const t = newWorld();
    const firstId = await insert(t, { name: 'First' });
    const promotedId = await insert(t, { name: 'Second', isDefault: true });
    expect((await getRow(t, firstId))?.isDefault).toBe(false);
    expect((await getRow(t, promotedId))?.isDefault).toBe(true);

    // isDefault: false on the first row of a pair is honoured — the pair then
    // simply has no default until one is chosen.
    const loneId = await insert(t, {
      connectorSlug: 'discord',
      name: 'Bot',
      isDefault: false,
    });
    expect((await getRow(t, loneId))?.isDefault).toBe(false);
  });

  it('refuses a name differing only in casing (CREDENTIAL_NAME_TAKEN), scoped to the pair', async () => {
    const t = newWorld();
    await insert(t, { name: 'Main Token' });
    expect(await catchCode(() => insert(t, { name: 'main token' }))).toBe(
      'CREDENTIAL_NAME_TAKEN',
    );
    // Same name is free on another connector and in another org.
    await insert(t, { connectorSlug: 'discord', name: 'main token' });
    await insert(t, { organizationId: OTHER_ORG, name: 'main token' });
  });

  it('trims the name and refuses an empty one', async () => {
    const t = newWorld();
    const id = await insert(t, { name: '  Padded  ' });
    expect((await getRow(t, id))?.name).toBe('Padded');
    expect(await catchCode(() => insert(t, { name: '   ' }))).toBe(
      'CREDENTIAL_NAME_INVALID',
    );
  });

  it('stores an endpoint as a bare https origin, dropping a trailing slash', async () => {
    const t = newWorld();
    const id = await insert(t, {
      connectorSlug: 'confluence',
      authMethod: 'basic',
      name: 'Site',
      endpointUrl: '  https://acme.atlassian.net/  ',
    });
    expect((await getRow(t, id))?.endpointUrl).toBe(
      'https://acme.atlassian.net',
    );
  });

  it('refuses an endpoint that is not an https ORIGIN', async () => {
    const t = newWorld();
    for (const endpointUrl of [
      'http://acme.atlassian.net',
      'https://acme.atlassian.net/wiki/rest',
      'https://acme.atlassian.net/?token=leak',
      'https://acme.atlassian.net/#frag',
      'https://user:pw@acme.atlassian.net',
      'acme.atlassian.net',
    ]) {
      expect(
        await catchCode(() =>
          insert(t, { name: `Endpoint ${endpointUrl}`, endpointUrl }),
        ),
        endpointUrl,
      ).toBe('CREDENTIAL_ENDPOINT_INVALID');
    }
  });
});

describe('patchCredentialInternal', () => {
  it('renames with the clash check excluding the row itself', async () => {
    const t = newWorld();
    const aId = await insert(t, { name: 'Alpha' });
    await insert(t, { name: 'Beta' });

    // Re-casing yourself is not a clash.
    await t.mutation(
      internal.connector_credentials.mutations.patchCredentialInternal,
      { organizationId: ORG, credentialId: aId, name: 'ALPHA' },
    );
    expect((await getRow(t, aId))?.name).toBe('ALPHA');

    expect(
      await catchCode(() =>
        t.mutation(
          internal.connector_credentials.mutations.patchCredentialInternal,
          { organizationId: ORG, credentialId: aId, name: 'beta' },
        ),
      ),
    ).toBe('CREDENTIAL_NAME_TAKEN');
  });

  it('isDefault: true swaps the pair default in one transaction', async () => {
    const t = newWorld();
    const aId = await insert(t, { name: 'Alpha' });
    const bId = await insert(t, { name: 'Beta' });
    expect((await getRow(t, aId))?.isDefault).toBe(true);

    await t.mutation(
      internal.connector_credentials.mutations.patchCredentialInternal,
      { organizationId: ORG, credentialId: bId, isDefault: true },
    );
    expect((await getRow(t, aId))?.isDefault).toBe(false);
    expect((await getRow(t, bId))?.isDefault).toBe(true);
  });

  it('a secret replacement re-stamps the preview, and a null preview clears it', async () => {
    const t = newWorld();
    const id = await insert(t, { name: 'Rotating', maskedPreview: 'ghp_…01' });
    const replacement = { ...CIPHER, ciphertext: 'ct-rotated' };

    await t.mutation(
      internal.connector_credentials.mutations.patchCredentialInternal,
      {
        organizationId: ORG,
        credentialId: id,
        encryptedData: replacement,
        maskedPreview: 'ghp_…02',
      },
    );
    let row = await getRow(t, id);
    expect(row?.encryptedData.ciphertext).toBe('ct-rotated');
    expect(row?.maskedPreview).toBe('ghp_…02');

    // A replacement too short to excerpt must not leave the OLD preview
    // describing a secret that no longer exists.
    await t.mutation(
      internal.connector_credentials.mutations.patchCredentialInternal,
      {
        organizationId: ORG,
        credentialId: id,
        encryptedData: CIPHER,
        maskedPreview: null,
      },
    );
    row = await getRow(t, id);
    expect(row?.maskedPreview).toBeUndefined();
  });

  it('status and statusDetail move together; null clears the detail', async () => {
    const t = newWorld();
    const id = await insert(t, { name: 'Grant' });
    await t.mutation(
      internal.connector_credentials.mutations.patchCredentialInternal,
      {
        organizationId: ORG,
        credentialId: id,
        status: 'needs-reauth',
        statusDetail: 'refresh_token expired',
      },
    );
    let row = await getRow(t, id);
    expect(row?.status).toBe('needs-reauth');
    expect(row?.statusDetail).toBe('refresh_token expired');

    await t.mutation(
      internal.connector_credentials.mutations.patchCredentialInternal,
      {
        organizationId: ORG,
        credentialId: id,
        status: 'active',
        statusDetail: null,
      },
    );
    row = await getRow(t, id);
    expect(row?.status).toBe('active');
    expect(row?.statusDetail).toBeUndefined();
  });

  it('re-normalizes a replacement endpoint and refuses one carrying a path', async () => {
    const t = newWorld();
    const id = await insert(t, {
      connectorSlug: 'shopify',
      authMethod: 'api-key',
      name: 'Store',
      endpointUrl: 'https://acme.myshopify.com',
    });
    await t.mutation(
      internal.connector_credentials.mutations.patchCredentialInternal,
      {
        organizationId: ORG,
        credentialId: id,
        endpointUrl: 'https://acme-eu.myshopify.com/',
      },
    );
    expect((await getRow(t, id))?.endpointUrl).toBe(
      'https://acme-eu.myshopify.com',
    );

    expect(
      await catchCode(() =>
        t.mutation(
          internal.connector_credentials.mutations.patchCredentialInternal,
          {
            organizationId: ORG,
            credentialId: id,
            endpointUrl: 'https://acme.myshopify.com/admin/api',
          },
        ),
      ),
    ).toBe('CREDENTIAL_ENDPOINT_INVALID');
  });

  it('reads a row of another org as CREDENTIAL_NOT_FOUND', async () => {
    const t = newWorld();
    const foreignId = await insert(t, { organizationId: OTHER_ORG });
    expect(
      await catchCode(() =>
        t.mutation(
          internal.connector_credentials.mutations.patchCredentialInternal,
          { organizationId: ORG, credentialId: foreignId, name: 'Stolen' },
        ),
      ),
    ).toBe('CREDENTIAL_NOT_FOUND');
    // Untouched.
    expect((await getRow(t, foreignId))?.name).toBe('Primary token');
  });
});

describe('setDefaultCredential (public)', () => {
  it('swaps the default for an org admin', async () => {
    const t = newWorld();
    const orgId = await seedAuthOrg(t, 'ic-set-default');
    await seedAuthMember(t, orgId, 'user_admin', 'admin');
    const aId = await insert(t, { organizationId: orgId, name: 'Alpha' });
    const bId = await insert(t, { organizationId: orgId, name: 'Beta' });

    await t
      .withIdentity({ subject: 'user_admin' })
      .mutation(api.connector_credentials.mutations.setDefaultCredential, {
        organizationId: orgId,
        credentialId: bId,
      });
    expect((await getRow(t, aId))?.isDefault).toBe(false);
    expect((await getRow(t, bId))?.isDefault).toBe(true);
  });

  it('refuses a disabled row (CREDENTIAL_DISABLED) and keeps the current default', async () => {
    const t = newWorld();
    const orgId = await seedAuthOrg(t, 'ic-set-disabled');
    await seedAuthMember(t, orgId, 'user_admin', 'admin');
    const aId = await insert(t, { organizationId: orgId, name: 'Alpha' });
    const bId = await insert(t, {
      organizationId: orgId,
      name: 'Beta',
      status: 'disabled',
    });

    expect(
      await catchCode(() =>
        t
          .withIdentity({ subject: 'user_admin' })
          .mutation(api.connector_credentials.mutations.setDefaultCredential, {
            organizationId: orgId,
            credentialId: bId,
          }),
      ),
    ).toBe('CREDENTIAL_DISABLED');
    expect((await getRow(t, aId))?.isDefault).toBe(true);
  });

  it('refuses a row that lost its authorization (CREDENTIAL_NEEDS_REAUTH)', async () => {
    const t = newWorld();
    const orgId = await seedAuthOrg(t, 'ic-set-reauth');
    await seedAuthMember(t, orgId, 'user_admin', 'admin');
    await insert(t, { organizationId: orgId, name: 'Alpha' });
    const bId = await insert(t, {
      organizationId: orgId,
      name: 'Beta',
      status: 'needs-reauth',
      statusDetail: 'refresh failed',
    });

    expect(
      await catchCode(() =>
        t
          .withIdentity({ subject: 'user_admin' })
          .mutation(api.connector_credentials.mutations.setDefaultCredential, {
            organizationId: orgId,
            credentialId: bId,
          }),
      ),
    ).toBe('CREDENTIAL_NEEDS_REAUTH');
  });

  it("reads another org's row as CREDENTIAL_NOT_FOUND even for an admin of their own org", async () => {
    const t = newWorld();
    const orgId = await seedAuthOrg(t, 'ic-set-cross-a');
    const otherOrgId = await seedAuthOrg(t, 'ic-set-cross-b');
    await seedAuthMember(t, orgId, 'user_admin', 'admin');
    const foreignId = await insert(t, { organizationId: otherOrgId });

    expect(
      await catchCode(() =>
        t
          .withIdentity({ subject: 'user_admin' })
          .mutation(api.connector_credentials.mutations.setDefaultCredential, {
            organizationId: orgId,
            credentialId: foreignId,
          }),
      ),
    ).toBe('CREDENTIAL_NOT_FOUND');
    expect((await getRow(t, foreignId))?.isDefault).toBe(true);
  });

  it('refuses a plain member (FORBIDDEN_DEVELOPER_SETTINGS)', async () => {
    const t = newWorld();
    const orgId = await seedAuthOrg(t, 'ic-set-member');
    await seedAuthMember(t, orgId, 'user_member', 'member');
    const id = await insert(t, { organizationId: orgId });

    expect(
      await catchCode(() =>
        t
          .withIdentity({ subject: 'user_member' })
          .mutation(api.connector_credentials.mutations.setDefaultCredential, {
            organizationId: orgId,
            credentialId: id,
          }),
      ),
    ).toBe('FORBIDDEN_DEVELOPER_SETTINGS');
  });
});

describe('deleteCredential (public)', () => {
  it('deleting the default promotes the OLDEST remaining active row', async () => {
    const t = newWorld();
    const orgId = await seedAuthOrg(t, 'ic-delete');
    await seedAuthMember(t, orgId, 'user_admin', 'admin');
    const aId = await insert(t, { organizationId: orgId, name: 'Alpha' });
    const bId = await insert(t, { organizationId: orgId, name: 'Beta' });
    const cId = await insert(t, { organizationId: orgId, name: 'Gamma' });
    // Make the youngest row unambiguously younger than Beta.
    await t.run((ctx) => ctx.db.patch(cId, { createdAt: Date.now() + 10_000 }));

    await t
      .withIdentity({ subject: 'user_admin' })
      .mutation(api.connector_credentials.mutations.deleteCredential, {
        organizationId: orgId,
        credentialId: aId,
      });
    expect(await getRow(t, aId)).toBeNull();
    expect((await getRow(t, bId))?.isDefault).toBe(true);
    expect((await getRow(t, cId))?.isDefault).toBe(false);
  });

  it('leaves the connector without a default when every survivor is unusable', async () => {
    const t = newWorld();
    const orgId = await seedAuthOrg(t, 'ic-delete-unusable');
    await seedAuthMember(t, orgId, 'user_admin', 'admin');
    const aId = await insert(t, { organizationId: orgId, name: 'Alpha' });
    const bId = await insert(t, {
      organizationId: orgId,
      name: 'Beta',
      status: 'disabled',
    });

    await t
      .withIdentity({ subject: 'user_admin' })
      .mutation(api.connector_credentials.mutations.deleteCredential, {
        organizationId: orgId,
        credentialId: aId,
      });
    expect((await getRow(t, bId))?.isDefault).toBe(false);
  });

  it('deleting a NON-default row never moves the default', async () => {
    const t = newWorld();
    const orgId = await seedAuthOrg(t, 'ic-delete-nondefault');
    await seedAuthMember(t, orgId, 'user_admin', 'admin');
    const aId = await insert(t, { organizationId: orgId, name: 'Alpha' });
    const bId = await insert(t, { organizationId: orgId, name: 'Beta' });

    await t
      .withIdentity({ subject: 'user_admin' })
      .mutation(api.connector_credentials.mutations.deleteCredential, {
        organizationId: orgId,
        credentialId: bId,
      });
    expect((await getRow(t, aId))?.isDefault).toBe(true);
  });

  it("reads another org's row as CREDENTIAL_NOT_FOUND and leaves it in place", async () => {
    const t = newWorld();
    const orgId = await seedAuthOrg(t, 'ic-delete-cross-a');
    const otherOrgId = await seedAuthOrg(t, 'ic-delete-cross-b');
    await seedAuthMember(t, orgId, 'user_admin', 'admin');
    const foreignId = await insert(t, { organizationId: otherOrgId });

    expect(
      await catchCode(() =>
        t
          .withIdentity({ subject: 'user_admin' })
          .mutation(api.connector_credentials.mutations.deleteCredential, {
            organizationId: orgId,
            credentialId: foreignId,
          }),
      ),
    ).toBe('CREDENTIAL_NOT_FOUND');
    expect(await getRow(t, foreignId)).not.toBeNull();
  });

  it('refuses a plain member (FORBIDDEN_DEVELOPER_SETTINGS)', async () => {
    const t = newWorld();
    const orgId = await seedAuthOrg(t, 'ic-delete-member');
    await seedAuthMember(t, orgId, 'user_member', 'member');
    const id = await insert(t, { organizationId: orgId });

    expect(
      await catchCode(() =>
        t
          .withIdentity({ subject: 'user_member' })
          .mutation(api.connector_credentials.mutations.deleteCredential, {
            organizationId: orgId,
            credentialId: id,
          }),
      ),
    ).toBe('FORBIDDEN_DEVELOPER_SETTINGS');
    expect(await getRow(t, id)).not.toBeNull();
  });
});
