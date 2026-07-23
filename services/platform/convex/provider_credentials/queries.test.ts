/**
 * Read surface of the provider-credential domain, driven through the real
 * registered functions. The public list runs under the real auth chain —
 * `withIdentity` + the `memberMirror` membership hot path (component
 * fallback exercised for the non-member refusal) — and its masked
 * projection is asserted by KEY SET, so ciphertext can never silently join
 * the wire shape.
 */

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api, internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
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

const ORG = 'org_pc_queries';
const OTHER_ORG = 'org_pc_queries_other';
const MEMBER = 'user_pc_member';
type T = TestConvex<typeof schema>;

function newWorld(): T {
  const t = convexTest(schema, modules);
  t.registerComponent('betterAuth', betterAuthSchema, authModules);
  return t;
}

/** Fixture ciphertext — queries must never surface it. */
const CIPHER = {
  ciphertext: 'ct-fixture',
  nonce: 'nonce-fixture',
  authTag: 'tag-fixture',
  keyFingerprint: 'fp-fixture',
};

/** Membership via the local mirror — the hot path the query reads. */
async function seedMember(
  t: T,
  userId: string,
  organizationId: string,
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId: `m_${userId}_${organizationId}`,
      userId,
      organizationId,
      role: 'member',
      createdAt: 0,
    });
  });
}

interface SeedRow {
  organizationId?: string;
  providerSlug: string;
  authMethod: 'api-key' | 'env' | 'subscription-key' | 'subscription-broker';
  name: string;
  envName?: string;
  maskedPreview?: string;
  modelAllowlist?: string[];
}

async function seedCredential(
  t: T,
  row: SeedRow,
): Promise<Id<'providerCredentials'>> {
  return await t.mutation(
    internal.provider_credentials.mutations.insertCredentialInternal,
    {
      organizationId: row.organizationId ?? ORG,
      providerSlug: row.providerSlug,
      authMethod: row.authMethod,
      name: row.name,
      status: 'active',
      createdBy: 'user_seed',
      ...(row.authMethod === 'env'
        ? { envName: row.envName ?? 'TALE_PROVIDER_KEY_SEED' }
        : { encryptedData: CIPHER }),
      ...(row.maskedPreview !== undefined && {
        maskedPreview: row.maskedPreview,
      }),
      ...(row.modelAllowlist !== undefined && {
        modelAllowlist: row.modelAllowlist,
      }),
    },
  );
}

describe('listCredentials', () => {
  it('projects masked rows only — no encryptedData key anywhere — sorted provider-then-name', async () => {
    const t = newWorld();
    await seedMember(t, MEMBER, ORG);
    await seedCredential(t, {
      providerSlug: 'openrouter',
      authMethod: 'api-key',
      name: 'Zeta',
      maskedPreview: 'sk-o…r1',
      modelAllowlist: ['anthropic/claude-fable-5'],
    });
    await seedCredential(t, {
      providerSlug: 'anthropic',
      authMethod: 'subscription-broker',
      name: 'beta',
      maskedPreview: 'brok…et',
    });
    await seedCredential(t, {
      providerSlug: 'anthropic',
      authMethod: 'env',
      name: 'Alpha',
      envName: 'TALE_PROVIDER_KEY_ANTHROPIC',
    });

    const rows = await t
      .withIdentity({ subject: MEMBER })
      .query(api.provider_credentials.queries.listCredentials, {
        organizationId: ORG,
      });

    expect(rows.map((row) => [row.providerSlug, row.name])).toEqual([
      ['anthropic', 'Alpha'],
      ['anthropic', 'beta'],
      ['openrouter', 'Zeta'],
    ]);

    for (const row of rows) {
      // The projection is masked BY KEY SET — ciphertext absent, not blanked.
      expect(Object.keys(row)).not.toContain('encryptedData');
      expect(row.status).toBe('active');
      expect(typeof row.createdAt).toBe('number');
      expect(typeof row.updatedAt).toBe('number');
    }

    const [alpha, beta, zeta] = rows;
    expect(alpha.authMethod).toBe('env');
    expect(alpha.envName).toBe('TALE_PROVIDER_KEY_ANTHROPIC');
    expect(alpha.maskedPreview).toBeUndefined();
    expect(alpha.isDefault).toBe(false);
    expect(beta.authMethod).toBe('subscription-broker');
    expect(beta.maskedPreview).toBe('brok…et');
    expect(beta.isDefault).toBe(true);
    expect(zeta.maskedPreview).toBe('sk-o…r1');
    expect(zeta.modelAllowlist).toEqual(['anthropic/claude-fable-5']);
    expect(zeta.isDefault).toBe(true);
  });

  it("returns only the caller organization's rows", async () => {
    const t = newWorld();
    await seedMember(t, MEMBER, ORG);
    await seedCredential(t, {
      providerSlug: 'openai',
      authMethod: 'api-key',
      name: 'Mine',
    });
    await seedCredential(t, {
      organizationId: OTHER_ORG,
      providerSlug: 'openai',
      authMethod: 'api-key',
      name: 'Theirs',
    });

    const rows = await t
      .withIdentity({ subject: MEMBER })
      .query(api.provider_credentials.queries.listCredentials, {
        organizationId: ORG,
      });
    expect(rows.map((row) => row.name)).toEqual(['Mine']);
  });

  it('requires authentication (UNAUTHENTICATED)', async () => {
    const t = newWorld();
    expect(
      await catchCode(() =>
        t.query(api.provider_credentials.queries.listCredentials, {
          organizationId: ORG,
        }),
      ),
    ).toBe('UNAUTHENTICATED');
  });

  it('refuses a caller who is not a member of the organization', async () => {
    const t = newWorld();
    await seedMember(t, MEMBER, OTHER_ORG);
    await expect(
      t
        .withIdentity({ subject: MEMBER })
        .query(api.provider_credentials.queries.listCredentials, {
          organizationId: ORG,
        }),
    ).rejects.toThrowError(/Not a member/);
  });
});

describe('getDefaultCredentialInternal', () => {
  it('returns the pair default, and null when the pair has none', async () => {
    const t = newWorld();
    const firstId = await seedCredential(t, {
      providerSlug: 'openai',
      authMethod: 'api-key',
      name: 'First',
    });
    await seedCredential(t, {
      providerSlug: 'openai',
      authMethod: 'api-key',
      name: 'Second',
    });

    const row = await t.query(
      internal.provider_credentials.queries.getDefaultCredentialInternal,
      { organizationId: ORG, providerSlug: 'openai' },
    );
    expect(row?._id).toBe(firstId);

    // Deleting the default leaves the pair without one — resolution then
    // reports CREDENTIAL_NONE_CONFIGURED instead of silently promoting.
    await t.run((ctx) => ctx.db.delete(firstId));
    const after = await t.query(
      internal.provider_credentials.queries.getDefaultCredentialInternal,
      { organizationId: ORG, providerSlug: 'openai' },
    );
    expect(after).toBeNull();
  });
});

describe('listCredentialFactsInternal', () => {
  it('returns the (providerSlug, name, createdBy) triples of exactly the requested org', async () => {
    const t = newWorld();
    const marker = 'migration:0.4.0/02_provider_credentials_from_files';
    await t.mutation(
      internal.provider_credentials.mutations.insertCredentialInternal,
      {
        organizationId: ORG,
        providerSlug: 'openai',
        authMethod: 'api-key',
        name: 'Migrated',
        encryptedData: CIPHER,
        status: 'active',
        createdBy: marker,
      },
    );
    await seedCredential(t, {
      providerSlug: 'anthropic',
      authMethod: 'env',
      name: 'Hand made',
      envName: 'TALE_PROVIDER_KEY_A',
    });
    await seedCredential(t, {
      organizationId: OTHER_ORG,
      providerSlug: 'openai',
      authMethod: 'api-key',
      name: 'Foreign',
    });

    const facts = await t.query(
      internal.provider_credentials.queries.listCredentialFactsInternal,
      { organizationId: ORG },
    );
    expect(facts).toHaveLength(2);
    expect(facts).toEqual(
      expect.arrayContaining([
        { providerSlug: 'openai', name: 'Migrated', createdBy: marker },
        {
          providerSlug: 'anthropic',
          name: 'Hand made',
          createdBy: 'user_seed',
        },
      ]),
    );
  });
});
