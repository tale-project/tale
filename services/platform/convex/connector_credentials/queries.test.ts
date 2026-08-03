/**
 * Read surface of the connector-credential domain, driven through the real
 * registered functions. The public reads run under the real auth chain —
 * `withIdentity` + the `memberMirror` membership hot path (component
 * fallback exercised for the non-member refusal) — and the masked projection
 * is asserted by KEY SET, so ciphertext can never silently join the wire
 * shape. `resolveCredentialRefInternal` is covered here too: it is the V8
 * half of resolution, and its tenant scoping is the rule that keeps one
 * organization's credentials unreachable from another's invocation.
 */

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api, internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
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
// provider_credentials/queries.test.ts.
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

const ORG = 'org_ic_queries';
const OTHER_ORG = 'org_ic_queries_other';
const MEMBER = 'user_ic_member';
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
  connectorSlug: string;
  authMethod: 'api-key' | 'bearer' | 'basic' | 'oauth2';
  name: string;
  endpointUrl?: string;
  config?: Record<string, string | number | boolean>;
  maskedPreview?: string;
  status?: 'active' | 'disabled' | 'needs-reauth';
  statusDetail?: string;
}

async function seedCredential(
  t: T,
  row: SeedRow,
): Promise<Id<'connectorCredentials'>> {
  return await t.mutation(
    internal.connector_credentials.mutations.insertCredentialInternal,
    {
      organizationId: row.organizationId ?? ORG,
      connectorSlug: row.connectorSlug,
      authMethod: row.authMethod,
      name: row.name,
      encryptedData: CIPHER,
      status: row.status ?? 'active',
      createdBy: 'user_seed',
      ...(row.endpointUrl !== undefined && { endpointUrl: row.endpointUrl }),
      ...(row.config !== undefined && { config: row.config }),
      ...(row.maskedPreview !== undefined && {
        maskedPreview: row.maskedPreview,
      }),
      ...(row.statusDetail !== undefined && {
        statusDetail: row.statusDetail,
      }),
    },
  );
}

describe('listCredentials', () => {
  it('projects masked rows only — no encryptedData key anywhere — sorted connector-then-name', async () => {
    const t = newWorld();
    await seedMember(t, MEMBER, ORG);
    await seedCredential(t, {
      connectorSlug: 'shopify',
      authMethod: 'api-key',
      name: 'Zeta store',
      endpointUrl: 'https://zeta.myshopify.com',
      maskedPreview: 'shpa…9f',
    });
    await seedCredential(t, {
      connectorSlug: 'github',
      authMethod: 'bearer',
      name: 'beta',
      maskedPreview: 'ghp_…02',
    });
    await seedCredential(t, {
      connectorSlug: 'github',
      authMethod: 'bearer',
      name: 'Alpha',
      status: 'needs-reauth',
      statusDetail: 'token revoked',
    });

    const rows = await t
      .withIdentity({ subject: MEMBER })
      .query(api.connector_credentials.queries.listCredentials, {
        organizationId: ORG,
      });

    expect(rows.map((row) => [row.connectorSlug, row.name])).toEqual([
      ['github', 'Alpha'],
      ['github', 'beta'],
      ['shopify', 'Zeta store'],
    ]);

    for (const row of rows) {
      // The projection is masked BY KEY SET — ciphertext absent, not blanked.
      expect(Object.keys(row)).not.toContain('encryptedData');
      expect(typeof row.createdAt).toBe('number');
      expect(typeof row.updatedAt).toBe('number');
    }

    const [alpha, beta, zeta] = rows;
    expect(alpha.status).toBe('needs-reauth');
    expect(alpha.statusDetail).toBe('token revoked');
    expect(alpha.maskedPreview).toBeUndefined();
    // `beta` was the connector's first credential, so it holds the default —
    // listing order is alphabetical and says nothing about which one runs.
    expect(alpha.isDefault).toBe(false);
    expect(beta.maskedPreview).toBe('ghp_…02');
    expect(beta.isDefault).toBe(true);
    expect(zeta.authMethod).toBe('api-key');
    expect(zeta.endpointUrl).toBe('https://zeta.myshopify.com');

    // config comes back too. updateCredential REPLACES config wholesale, so an
    // edit form seeded without the stored values would clear them on save —
    // which is why the listing has to return them.
    const mailbox = await seedCredential(t, {
      connectorSlug: 'imap-smtp',
      authMethod: 'basic',
      name: 'hello@example.com',
      config: { imapHost: 'mail.example.com', imapPort: 993 },
    });
    const listed = await t
      .withIdentity({ subject: MEMBER })
      .query(api.connector_credentials.queries.listCredentials, {
        organizationId: ORG,
      });
    const row = listed.find((entry) => entry.id === mailbox);
    expect(row?.config).toEqual({
      imapHost: 'mail.example.com',
      imapPort: 993,
    });
    expect(zeta.isDefault).toBe(true);
  });

  it('narrows to one connector when connectorSlug is given', async () => {
    const t = newWorld();
    await seedMember(t, MEMBER, ORG);
    await seedCredential(t, {
      connectorSlug: 'github',
      authMethod: 'bearer',
      name: 'Repo bot',
    });
    await seedCredential(t, {
      connectorSlug: 'slack',
      authMethod: 'oauth2',
      name: 'Workspace',
    });

    const rows = await t
      .withIdentity({ subject: MEMBER })
      .query(api.connector_credentials.queries.listCredentials, {
        organizationId: ORG,
        connectorSlug: 'slack',
      });
    expect(rows.map((row) => row.name)).toEqual(['Workspace']);
  });

  it("returns only the caller organization's rows", async () => {
    const t = newWorld();
    await seedMember(t, MEMBER, ORG);
    await seedCredential(t, {
      connectorSlug: 'github',
      authMethod: 'bearer',
      name: 'Mine',
    });
    await seedCredential(t, {
      organizationId: OTHER_ORG,
      connectorSlug: 'github',
      authMethod: 'bearer',
      name: 'Theirs',
    });

    const rows = await t
      .withIdentity({ subject: MEMBER })
      .query(api.connector_credentials.queries.listCredentials, {
        organizationId: ORG,
      });
    expect(rows.map((row) => row.name)).toEqual(['Mine']);
  });

  it('requires authentication (UNAUTHENTICATED)', async () => {
    const t = newWorld();
    expect(
      await catchCode(() =>
        t.query(api.connector_credentials.queries.listCredentials, {
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
        .query(api.connector_credentials.queries.listCredentials, {
          organizationId: ORG,
        }),
    ).rejects.toThrowError(/Not a member/);
  });
});

describe('getCredential', () => {
  it('returns one masked row without its ciphertext', async () => {
    const t = newWorld();
    await seedMember(t, MEMBER, ORG);
    const id = await seedCredential(t, {
      connectorSlug: 'confluence',
      authMethod: 'basic',
      name: 'Docs site',
      endpointUrl: 'https://acme.atlassian.net',
      maskedPreview: 'ATAT…9k',
    });

    const row = await t
      .withIdentity({ subject: MEMBER })
      .query(api.connector_credentials.queries.getCredential, {
        organizationId: ORG,
        credentialId: id,
      });
    expect(row.name).toBe('Docs site');
    expect(row.endpointUrl).toBe('https://acme.atlassian.net');
    expect(row.maskedPreview).toBe('ATAT…9k');
    expect(Object.keys(row)).not.toContain('encryptedData');
  });

  it("reads another organization's row as CREDENTIAL_NOT_FOUND", async () => {
    const t = newWorld();
    await seedMember(t, MEMBER, ORG);
    const foreignId = await seedCredential(t, {
      organizationId: OTHER_ORG,
      connectorSlug: 'github',
      authMethod: 'bearer',
      name: 'Theirs',
    });

    expect(
      await catchCode(() =>
        t
          .withIdentity({ subject: MEMBER })
          .query(api.connector_credentials.queries.getCredential, {
            organizationId: ORG,
            credentialId: foreignId,
          }),
      ),
    ).toBe('CREDENTIAL_NOT_FOUND');
  });
});

describe('resolveCredentialRefInternal', () => {
  it('falls back to the pair default, and reports null when the pair has none', async () => {
    const t = newWorld();
    const firstId = await seedCredential(t, {
      connectorSlug: 'github',
      authMethod: 'bearer',
      name: 'First',
    });
    await seedCredential(t, {
      connectorSlug: 'github',
      authMethod: 'bearer',
      name: 'Second',
    });

    const row = await t.query(
      internal.connector_credentials.queries.resolveCredentialRefInternal,
      { organizationId: ORG, connectorSlug: 'github' },
    );
    expect(row?._id).toBe(firstId);

    // With the default gone and no successor chosen, resolution reports the
    // miss instead of silently picking one.
    await t.run((ctx) => ctx.db.patch(firstId, { isDefault: false }));
    const after = await t.query(
      internal.connector_credentials.queries.resolveCredentialRefInternal,
      { organizationId: ORG, connectorSlug: 'github' },
    );
    expect(after).toBeNull();
  });

  it('resolves a credential id, and a NAME case-insensitively', async () => {
    const t = newWorld();
    await seedCredential(t, {
      connectorSlug: 'github',
      authMethod: 'bearer',
      name: 'Default bot',
    });
    const namedId = await seedCredential(t, {
      connectorSlug: 'github',
      authMethod: 'bearer',
      name: 'Release Bot',
    });

    const byId = await t.query(
      internal.connector_credentials.queries.resolveCredentialRefInternal,
      { organizationId: ORG, connectorSlug: 'github', credentialRef: namedId },
    );
    expect(byId?._id).toBe(namedId);

    const byName = await t.query(
      internal.connector_credentials.queries.resolveCredentialRefInternal,
      {
        organizationId: ORG,
        connectorSlug: 'github',
        credentialRef: '  release bot  ',
      },
    );
    expect(byName?._id).toBe(namedId);
  });

  it('reports null for an unknown name rather than falling back to the default', async () => {
    const t = newWorld();
    await seedCredential(t, {
      connectorSlug: 'github',
      authMethod: 'bearer',
      name: 'Default bot',
    });
    const row = await t.query(
      internal.connector_credentials.queries.resolveCredentialRefInternal,
      {
        organizationId: ORG,
        connectorSlug: 'github',
        credentialRef: 'Nonexistent',
      },
    );
    expect(row).toBeNull();
  });

  it("never resolves another organization's credential id", async () => {
    const t = newWorld();
    const foreignId = await seedCredential(t, {
      organizationId: OTHER_ORG,
      connectorSlug: 'github',
      authMethod: 'bearer',
      name: 'Theirs',
    });
    const row = await t.query(
      internal.connector_credentials.queries.resolveCredentialRefInternal,
      {
        organizationId: ORG,
        connectorSlug: 'github',
        credentialRef: foreignId,
      },
    );
    expect(row).toBeNull();

    // And the reverse direction: this org's row is invisible to the other.
    const mineId = await seedCredential(t, {
      connectorSlug: 'github',
      authMethod: 'bearer',
      name: 'Mine',
    });
    const reverse = await t.query(
      internal.connector_credentials.queries.resolveCredentialRefInternal,
      {
        organizationId: OTHER_ORG,
        connectorSlug: 'github',
        credentialRef: mineId,
      },
    );
    expect(reverse?._id).not.toBe(mineId);
    expect(reverse).toBeNull();
  });

  it('never resolves a credential belonging to another connector', async () => {
    const t = newWorld();
    const slackId = await seedCredential(t, {
      connectorSlug: 'slack',
      authMethod: 'oauth2',
      name: 'Workspace',
    });
    const row = await t.query(
      internal.connector_credentials.queries.resolveCredentialRefInternal,
      {
        organizationId: ORG,
        connectorSlug: 'github',
        credentialRef: slackId,
      },
    );
    expect(row).toBeNull();
  });
});
