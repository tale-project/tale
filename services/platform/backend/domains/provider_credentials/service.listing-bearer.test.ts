// @vitest-environment node

/**
 * The bearer a person's own check of one credential lists its provider's
 * models with (`resolveCredentialListingBearer`): that credential's key,
 * disabled or not — disabling stops serving, not a check of the key — and
 * nothing for a method that is no bearer, without resolving it.
 */

import type { ProviderDefinition } from '@tale/shared/schemas/providers';
import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveCredentialListingBearer } from './service.ts';

type Statement = { text: string; values: unknown[] };

function recordingSql(answer: (text: string, values: unknown[]) => unknown[]) {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    return Promise.resolve(answer(text, values));
  };
  const sql = Object.assign(tag, { unsafe: (text: string) => text });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  return { sql: sql as unknown as Sql, statements };
}

function credentialRow(patch: Record<string, unknown>) {
  return {
    _id: 'cred-2',
    organizationId: 'org-1',
    providerSlug: 'bifrost',
    authMethod: 'env',
    name: 'Second key',
    encryptedData: null,
    envName: 'TALE_PROVIDER_KEY_BIFROST_SECOND',
    endpointUrl: null,
    accountId: null,
    modelAllowlist: null,
    status: 'active',
    ...patch,
  };
}

/** The credentials table holding one row: answers the method read and the
 * resolver's by-id read. */
function table(row: ReturnType<typeof credentialRow>) {
  return recordingSql((text) => {
    if (text.includes('auth_method AS "authMethod" FROM'))
      return [{ authMethod: row.authMethod }];
    if (text.includes('FROM app.provider_credentials')) return [row];
    return [];
  });
}

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the name and source are read
const bifrost = {
  name: 'bifrost',
  catalog: { source: 'models-endpoint' },
} as unknown as ProviderDefinition;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveCredentialListingBearer', () => {
  it.each(['active', 'disabled'] as const)(
    "lists with a %s credential's own key",
    async (status) => {
      vi.stubEnv('TALE_PROVIDER_KEY_BIFROST_SECOND', 'sk-second');
      const { sql } = table(credentialRow({ status }));
      await expect(
        resolveCredentialListingBearer(sql, 'org-1', bifrost, 'cred-2'),
      ).resolves.toBe('sk-second');
    },
  );

  it('still refuses a credential of another organization', async () => {
    vi.stubEnv('TALE_PROVIDER_KEY_BIFROST_SECOND', 'sk-second');
    const { sql } = recordingSql((text) =>
      text.includes('auth_method AS "authMethod" FROM')
        ? []
        : [credentialRow({ organizationId: 'org-9' })],
    );
    await expect(
      resolveCredentialListingBearer(sql, 'org-1', bifrost, 'cred-2'),
    ).rejects.toMatchObject({ data: { code: 'CREDENTIAL_NOT_FOUND' } });
  });

  it('answers nothing for a broker without resolving it — no pool account is spent', async () => {
    const { sql, statements } = table(
      credentialRow({ authMethod: 'subscription-broker', envName: null }),
    );
    await expect(
      resolveCredentialListingBearer(sql, 'org-1', bifrost, 'cred-2'),
    ).resolves.toBeUndefined();
    expect(statements).toHaveLength(1);
    expect(statements[0]?.values).toEqual(['cred-2', 'org-1', 'bifrost']);
  });
});
