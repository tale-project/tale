import { providerEnvironmentCredentialSchema } from '@tale/shared/schemas/providers';
import type { Sql, TransactionSql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import { createCredential, listCredentials, updateCredential } from './service';

vi.mock('../audit_logs/service', () => ({
  createAuditLog: vi.fn(async () => undefined),
}));

const scope = { organizationId: 'org-a', userId: 'user-a', role: 'admin' };
const row = {
  id: 'credential-a',
  providerSlug: 'local',
  authMethod: 'env',
  name: 'Local',
  envName: 'TALE_PROVIDER_KEY_LOCAL',
  endpointUrl: null,
  maskedPreview: null,
  modelAllowlist: ['model-a'],
  isDefault: true,
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
};
function fixture(rows: Record<string, unknown>[]) {
  const statements: { sql: string; values: unknown[] }[] = [];
  const tag = async (sql: TemplateStringsArray, ...values: unknown[]) => {
    statements.push({ sql: sql.join('?'), values });
    return rows;
  };
  return {
    sql: tag as unknown as Sql,
    tx: tag as unknown as TransactionSql,
    statements,
  };
}

describe('native credential public metadata preconditions', () => {
  it('creates a declared disabled credential in that state without transient activation', async () => {
    const inserts: Record<string, unknown>[] = [];
    const tag = async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      if (sql.includes('INSERT INTO app.provider_credentials')) {
        const columns = sql
          .split('(')[1]!
          .split(')')[0]!
          .split(',')
          .map((column) => column.trim());
        inserts.push(
          Object.fromEntries(
            columns.map((column, index) => [column, values[index]]),
          ),
        );
        return [{ id: 'new-credential' }];
      }
      expect(sql).not.toContain('UPDATE app.provider_credentials');
      return [];
    };
    await createCredential(
      tag as unknown as TransactionSql,
      scope,
      {
        providerSlug: 'local',
        authMethod: 'env',
        name: 'Disabled',
        envName: row.envName,
        status: 'disabled',
        isDefault: false,
      },
      null,
    );
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ status: 'disabled', is_default: false });
    await expect(
      createCredential(
        fixture([]).tx,
        scope,
        {
          providerSlug: 'local',
          authMethod: 'env',
          name: 'Invalid',
          envName: row.envName,
          status: 'disabled',
          isDefault: true,
        },
        null,
      ),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_DISABLED_DEFAULT' });
  });

  it('never takes over another default as an implicit effect of a reviewed create or update', async () => {
    const existing = fixture([row]);
    await expect(
      createCredential(
        existing.tx,
        scope,
        {
          providerSlug: 'local',
          authMethod: 'env',
          name: 'Other',
          envName: row.envName,
          isDefault: true,
        },
        null,
      ),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_DEFAULT_CONFLICT' });
    expect(existing.statements).toHaveLength(1);
    const hash = (await listCredentials(fixture([row]).sql, scope))[0]!.hash;
    const update = fixture([row]);
    await expect(
      updateCredential(update.tx, scope, row.id, { isDefault: true }, hash),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_DEFAULT_CONFLICT' });
    expect(
      update.statements.every(
        (statement) =>
          !statement.sql.includes('UPDATE app.provider_credentials'),
      ),
    ).toBe(true);
  });

  it('exports the env-only desired shape and hashes no masked/secret material', async () => {
    expect(
      providerEnvironmentCredentialSchema.parse({
        providerSlug: 'local',
        authMethod: 'env',
        name: 'Local',
        envName: row.envName,
      }),
    ).toMatchObject({
      endpointUrl: null,
      modelAllowlist: null,
      status: 'active',
      isDefault: true,
    });
    expect(
      providerEnvironmentCredentialSchema.safeParse({
        providerSlug: 'local',
        authMethod: 'env',
        name: 'Local',
        envName: row.envName,
        secret: 'forbidden',
      }).success,
    ).toBe(false);
    const first = (
      await listCredentials(
        fixture([{ ...row, encryptedData: 'not-returned' }]).sql,
        scope,
      )
    )[0]!;
    const second = (
      await listCredentials(
        fixture([
          { ...row, maskedPreview: 'different', encryptedData: 'different' },
        ]).sql,
        scope,
      )
    )[0]!;
    expect(first.hash).toBe(second.hash);
    expect(first).not.toHaveProperty('encryptedData');
    expect(JSON.stringify(first)).not.toContain('not-returned');
    const changed = (
      await listCredentials(
        fixture([{ ...row, envName: 'TALE_PROVIDER_KEY_OTHER' }]).sql,
        scope,
      )
    )[0]!;
    expect(changed.hash).not.toBe(first.hash);
  });

  it('updates the proven ID in place and refuses a stale review before any mutation', async () => {
    const first = (await listCredentials(fixture([row]).sql, scope))[0]!;
    const accepted = fixture([row]);
    await updateCredential(
      accepted.tx,
      scope,
      row.id,
      { envName: 'TALE_PROVIDER_KEY_NEW' },
      first.hash,
    );
    expect(
      accepted.statements.some((statement) =>
        statement.sql.includes('UPDATE app.provider_credentials'),
      ),
    ).toBe(true);
    expect(accepted.statements[0]?.values).toEqual([
      row.id,
      scope.organizationId,
    ]);
    const stale = fixture([{ ...row, status: 'disabled', updatedAt: 3 }]);
    await expect(
      updateCredential(
        stale.tx,
        scope,
        row.id,
        { envName: 'TALE_PROVIDER_KEY_NEW' },
        first.hash,
      ),
    ).rejects.toMatchObject({ code: 'CONFIG_VERSION_CONFLICT', status: 409 });
    expect(stale.statements).toHaveLength(1);
    const foreign = fixture([]);
    await expect(
      updateCredential(
        foreign.tx,
        { ...scope, organizationId: 'org-b' },
        row.id,
        { name: 'Foreign' },
        first.hash,
      ),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_NOT_FOUND' });
  });

  it('fences create-if-absent by provider/name and retains old unguarded behavior', async () => {
    const existing = fixture([row]);
    const input = {
      providerSlug: row.providerSlug,
      authMethod: 'env' as const,
      name: row.name,
      envName: row.envName,
    };
    await expect(
      createCredential(existing.tx, scope, input, null),
    ).rejects.toMatchObject({ code: 'CONFIG_VERSION_CONFLICT', status: 409 });
    expect(existing.statements).toHaveLength(1);
    await expect(
      createCredential(fixture([row]).tx, scope, input),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_NAME_TAKEN' });
  });
});
