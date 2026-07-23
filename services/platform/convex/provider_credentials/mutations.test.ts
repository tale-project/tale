/**
 * Transactional invariants of the provider-credential CRUD, driven through
 * the REAL registered functions: the internal mutations exactly as the
 * `'use node'` actions and the file→row migration call them, and the public
 * secret-free writes (`deleteCredential`, `setDefaultCredential`) through
 * the full auth chain — a real betterAuth component organization + member
 * row and a `withIdentity` caller, mirroring
 * `conversations/assign_conversation_team.test.ts`.
 */

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api, components, internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import betterAuthSchema from '../betterAuth/schema';
import schema from '../schema';

const TEST_DIR_FROM_CONVEX_ROOT = 'provider_credentials';
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
// tasks/queries_error_codes.test.ts.
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

const ORG = 'org_pc_mutations';
const OTHER_ORG = 'org_pc_other';

interface InsertOverrides {
  organizationId?: string;
  providerSlug?: string;
  authMethod?: 'api-key' | 'env' | 'subscription-key' | 'subscription-broker';
  name?: string;
  encryptedData?: typeof CIPHER;
  envName?: string;
  maskedPreview?: string;
  modelAllowlist?: string[];
  status?: 'active' | 'disabled';
  createdBy?: string;
}

/**
 * Insert through the real internal mutation. Unless the test names the
 * secret fields itself (even as an explicit `undefined`, to drive the
 * absent-payload refusals), a non-env method gets the fixture ciphertext.
 */
async function insert(
  t: T,
  overrides: InsertOverrides = {},
): Promise<Id<'providerCredentials'>> {
  const {
    organizationId = ORG,
    providerSlug = 'openai',
    authMethod = 'api-key',
    name = 'Primary key',
    status = 'active',
    createdBy = 'user_1',
    ...optional
  } = overrides;
  const defaultCipher =
    authMethod !== 'env' &&
    !('encryptedData' in overrides) &&
    !('envName' in overrides);
  return await t.mutation(
    internal.provider_credentials.mutations.insertCredentialInternal,
    {
      organizationId,
      providerSlug,
      authMethod,
      name,
      status,
      createdBy,
      ...(defaultCipher && { encryptedData: CIPHER }),
      ...(optional.encryptedData !== undefined && {
        encryptedData: optional.encryptedData,
      }),
      ...(optional.envName !== undefined && { envName: optional.envName }),
      ...(optional.maskedPreview !== undefined && {
        maskedPreview: optional.maskedPreview,
      }),
      ...(optional.modelAllowlist !== undefined && {
        modelAllowlist: optional.modelAllowlist,
      }),
    },
  );
}

async function getRow(
  t: T,
  id: Id<'providerCredentials'>,
): Promise<Doc<'providerCredentials'> | null> {
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
  it('makes the first credential of an (org, provider) pair the default; the second stays non-default', async () => {
    const t = newWorld();
    const firstId = await insert(t, { name: 'First' });
    const secondId = await insert(t, { name: 'Second' });
    expect((await getRow(t, firstId))?.isDefault).toBe(true);
    expect((await getRow(t, secondId))?.isDefault).toBe(false);

    // A different provider starts its own pair — its first row is a default.
    const otherProvider = await insert(t, {
      providerSlug: 'openrouter',
      name: 'First',
    });
    expect((await getRow(t, otherProvider))?.isDefault).toBe(true);
  });

  it('refuses a name differing only in casing (CREDENTIAL_NAME_TAKEN), scoped to the pair', async () => {
    const t = newWorld();
    await insert(t, { name: 'Main Key' });
    expect(await catchCode(() => insert(t, { name: 'main key' }))).toBe(
      'CREDENTIAL_NAME_TAKEN',
    );
    // Same name is free on another provider and in another org.
    await insert(t, { providerSlug: 'openrouter', name: 'main key' });
    await insert(t, { organizationId: OTHER_ORG, name: 'main key' });
  });

  it('enforces method↔field coherence for api-key and subscription-broker', async () => {
    const t = newWorld();
    for (const authMethod of ['api-key', 'subscription-broker'] as const) {
      expect(
        await catchCode(() =>
          insert(t, {
            authMethod,
            name: `${authMethod} bare`,
            encryptedData: undefined,
          }),
        ),
      ).toBe('CREDENTIAL_SHAPE_INVALID');
      expect(
        await catchCode(() =>
          insert(t, {
            authMethod,
            name: `${authMethod} crossed`,
            encryptedData: CIPHER,
            envName: 'TALE_PROVIDER_KEY_X',
          }),
        ),
      ).toBe('CREDENTIAL_SHAPE_INVALID');
    }
  });

  it('enforces the env shape and the TALE_PROVIDER_KEY_ prefix gate', async () => {
    const t = newWorld();
    expect(
      await catchCode(() =>
        insert(t, { authMethod: 'env', name: 'No env name' }),
      ),
    ).toBe('CREDENTIAL_SHAPE_INVALID');
    expect(
      await catchCode(() =>
        insert(t, {
          authMethod: 'env',
          name: 'Env with cipher',
          envName: 'TALE_PROVIDER_KEY_OK',
          encryptedData: CIPHER,
        }),
      ),
    ).toBe('CREDENTIAL_SHAPE_INVALID');
    expect(
      await catchCode(() =>
        insert(t, {
          authMethod: 'env',
          name: 'Outside namespace',
          envName: 'BETTER_AUTH_SECRET',
        }),
      ),
    ).toBe('CREDENTIAL_ENV_NAME_INVALID');

    const id = await insert(t, {
      authMethod: 'env',
      name: 'Env ok',
      envName: 'TALE_PROVIDER_KEY_OPENAI',
    });
    const row = await getRow(t, id);
    expect(row?.envName).toBe('TALE_PROVIDER_KEY_OPENAI');
    expect(row?.encryptedData).toBeUndefined();
  });

  it('trims the name and refuses an empty one', async () => {
    const t = newWorld();
    const id = await insert(t, { name: '  Padded  ' });
    expect((await getRow(t, id))?.name).toBe('Padded');
    expect(await catchCode(() => insert(t, { name: '   ' }))).toBe(
      'CREDENTIAL_NAME_INVALID',
    );
  });
});

describe('patchCredentialInternal', () => {
  it('renames with the clash check excluding the row itself', async () => {
    const t = newWorld();
    const aId = await insert(t, { name: 'Alpha' });
    await insert(t, { name: 'Beta' });

    // Re-casing yourself is not a clash.
    await t.mutation(
      internal.provider_credentials.mutations.patchCredentialInternal,
      { organizationId: ORG, credentialId: aId, name: 'ALPHA' },
    );
    expect((await getRow(t, aId))?.name).toBe('ALPHA');

    expect(
      await catchCode(() =>
        t.mutation(
          internal.provider_credentials.mutations.patchCredentialInternal,
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
      internal.provider_credentials.mutations.patchCredentialInternal,
      { organizationId: ORG, credentialId: bId, isDefault: true },
    );
    expect((await getRow(t, aId))?.isDefault).toBe(false);
    expect((await getRow(t, bId))?.isDefault).toBe(true);
  });

  it('modelAllowlist: null clears the field; an array replaces it', async () => {
    const t = newWorld();
    const id = await insert(t, { name: 'Scoped', modelAllowlist: ['gpt-4o'] });
    await t.mutation(
      internal.provider_credentials.mutations.patchCredentialInternal,
      { organizationId: ORG, credentialId: id, modelAllowlist: ['o3', 'o4'] },
    );
    expect((await getRow(t, id))?.modelAllowlist).toEqual(['o3', 'o4']);

    await t.mutation(
      internal.provider_credentials.mutations.patchCredentialInternal,
      { organizationId: ORG, credentialId: id, modelAllowlist: null },
    );
    expect((await getRow(t, id))?.modelAllowlist).toBeUndefined();
  });

  it('re-checks method↔field coherence over the merged row', async () => {
    const t = newWorld();
    const envId = await insert(t, {
      authMethod: 'env',
      name: 'Env row',
      envName: 'TALE_PROVIDER_KEY_A',
    });
    // Cross-wiring an env row with ciphertext must be refused.
    expect(
      await catchCode(() =>
        t.mutation(
          internal.provider_credentials.mutations.patchCredentialInternal,
          { organizationId: ORG, credentialId: envId, encryptedData: CIPHER },
        ),
      ),
    ).toBe('CREDENTIAL_SHAPE_INVALID');

    const keyId = await insert(t, { name: 'Key row' });
    expect(
      await catchCode(() =>
        t.mutation(
          internal.provider_credentials.mutations.patchCredentialInternal,
          {
            organizationId: ORG,
            credentialId: keyId,
            envName: 'TALE_PROVIDER_KEY_B',
          },
        ),
      ),
    ).toBe('CREDENTIAL_SHAPE_INVALID');
  });

  it('reads a row of another org as CREDENTIAL_NOT_FOUND', async () => {
    const t = newWorld();
    const foreignId = await insert(t, { organizationId: OTHER_ORG });
    expect(
      await catchCode(() =>
        t.mutation(
          internal.provider_credentials.mutations.patchCredentialInternal,
          { organizationId: ORG, credentialId: foreignId, name: 'Stolen' },
        ),
      ),
    ).toBe('CREDENTIAL_NOT_FOUND');
    // Untouched.
    expect((await getRow(t, foreignId))?.name).toBe('Primary key');
  });
});

describe('setDefaultCredential (public)', () => {
  it('swaps the default for an org admin', async () => {
    const t = newWorld();
    const orgId = await seedAuthOrg(t, 'pc-set-default');
    await seedAuthMember(t, orgId, 'user_admin', 'admin');
    const aId = await insert(t, { organizationId: orgId, name: 'Alpha' });
    const bId = await insert(t, { organizationId: orgId, name: 'Beta' });

    await t
      .withIdentity({ subject: 'user_admin' })
      .mutation(api.provider_credentials.mutations.setDefaultCredential, {
        organizationId: orgId,
        credentialId: bId,
      });
    expect((await getRow(t, aId))?.isDefault).toBe(false);
    expect((await getRow(t, bId))?.isDefault).toBe(true);
  });

  it('refuses a disabled row (CREDENTIAL_DISABLED) and keeps the current default', async () => {
    const t = newWorld();
    const orgId = await seedAuthOrg(t, 'pc-set-disabled');
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
          .mutation(api.provider_credentials.mutations.setDefaultCredential, {
            organizationId: orgId,
            credentialId: bId,
          }),
      ),
    ).toBe('CREDENTIAL_DISABLED');
    expect((await getRow(t, aId))?.isDefault).toBe(true);
  });

  it("reads another org's row as CREDENTIAL_NOT_FOUND even for an admin of their own org", async () => {
    const t = newWorld();
    const orgId = await seedAuthOrg(t, 'pc-set-cross-a');
    const otherOrgId = await seedAuthOrg(t, 'pc-set-cross-b');
    await seedAuthMember(t, orgId, 'user_admin', 'admin');
    const foreignId = await insert(t, { organizationId: otherOrgId });

    expect(
      await catchCode(() =>
        t
          .withIdentity({ subject: 'user_admin' })
          .mutation(api.provider_credentials.mutations.setDefaultCredential, {
            organizationId: orgId,
            credentialId: foreignId,
          }),
      ),
    ).toBe('CREDENTIAL_NOT_FOUND');
    expect((await getRow(t, foreignId))?.isDefault).toBe(true);
  });

  it('refuses a plain member (FORBIDDEN_DEVELOPER_SETTINGS)', async () => {
    const t = newWorld();
    const orgId = await seedAuthOrg(t, 'pc-set-member');
    await seedAuthMember(t, orgId, 'user_member', 'member');
    const id = await insert(t, { organizationId: orgId });

    expect(
      await catchCode(() =>
        t
          .withIdentity({ subject: 'user_member' })
          .mutation(api.provider_credentials.mutations.setDefaultCredential, {
            organizationId: orgId,
            credentialId: id,
          }),
      ),
    ).toBe('FORBIDDEN_DEVELOPER_SETTINGS');
  });
});

describe('deleteCredential (public)', () => {
  it('deleting the default leaves the pair with NO default — no silent promotion', async () => {
    const t = newWorld();
    const orgId = await seedAuthOrg(t, 'pc-delete');
    await seedAuthMember(t, orgId, 'user_admin', 'admin');
    const aId = await insert(t, { organizationId: orgId, name: 'Alpha' });
    const bId = await insert(t, { organizationId: orgId, name: 'Beta' });

    await t
      .withIdentity({ subject: 'user_admin' })
      .mutation(api.provider_credentials.mutations.deleteCredential, {
        organizationId: orgId,
        credentialId: aId,
      });
    expect(await getRow(t, aId)).toBeNull();
    expect((await getRow(t, bId))?.isDefault).toBe(false);
  });

  it("reads another org's row as CREDENTIAL_NOT_FOUND and leaves it in place", async () => {
    const t = newWorld();
    const orgId = await seedAuthOrg(t, 'pc-delete-cross-a');
    const otherOrgId = await seedAuthOrg(t, 'pc-delete-cross-b');
    await seedAuthMember(t, orgId, 'user_admin', 'admin');
    const foreignId = await insert(t, { organizationId: otherOrgId });

    expect(
      await catchCode(() =>
        t
          .withIdentity({ subject: 'user_admin' })
          .mutation(api.provider_credentials.mutations.deleteCredential, {
            organizationId: orgId,
            credentialId: foreignId,
          }),
      ),
    ).toBe('CREDENTIAL_NOT_FOUND');
    expect(await getRow(t, foreignId)).not.toBeNull();
  });
});

describe('removeMigratedCredentialsInternal', () => {
  it('removes exactly the marker rows of the org, returns the count, and is idempotent', async () => {
    const t = newWorld();
    const marker = 'migration:0.4.0/02_provider_credentials_from_files';
    await insert(t, { name: 'Migrated A', createdBy: marker });
    await insert(t, {
      providerSlug: 'anthropic',
      name: 'Migrated B',
      createdBy: marker,
    });
    const userId = await insert(t, { name: 'User made', createdBy: 'user_1' });
    // Same marker in ANOTHER org must never be touched by this org's down.
    const foreignId = await insert(t, {
      organizationId: OTHER_ORG,
      name: 'Foreign migrated',
      createdBy: marker,
    });

    const removed = await t.mutation(
      internal.provider_credentials.mutations.removeMigratedCredentialsInternal,
      { organizationId: ORG, createdBy: marker },
    );
    expect(removed).toBe(2);
    expect(await getRow(t, userId)).not.toBeNull();
    expect(await getRow(t, foreignId)).not.toBeNull();

    const again = await t.mutation(
      internal.provider_credentials.mutations.removeMigratedCredentialsInternal,
      { organizationId: ORG, createdBy: marker },
    );
    expect(again).toBe(0);
  });
});
