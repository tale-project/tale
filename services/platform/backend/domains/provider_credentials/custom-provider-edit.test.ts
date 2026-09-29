// @vitest-environment node
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { providerDefinitionSchema } from '@tale/shared/schemas/providers';
import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  readProviderDefinition,
  saveProviderDefinition,
} from '../providers/config';
import { updateCredentialWithDefinition } from './custom-provider-edit';
import { CredentialAdminError, type CredentialScope } from './service';

/**
 * The edit dialog's one Save for a custom provider's credential, over the
 * real definition files: the definition's compare-and-set comes first, the
 * credential edit runs in the same transaction under the providers lock,
 * and the file is written last — so a refused credential (#3662) and an
 * editor older than the definition (#3663) both leave the provider as it
 * was. The credential write itself is stubbed at its module boundary; the
 * real-Postgres rollback is the `checkCustomProviderCredentialEdit` lane.
 */

const { audit, updateCredential } = vi.hoisted(() => ({
  audit: vi.fn(async () => undefined),
  updateCredential: vi.fn(),
}));
vi.mock('../audit_logs/service', () => ({ createAuditLog: audit }));
vi.mock('./service', async (original) => ({
  ...(await original<typeof import('./service')>()),
  updateCredential,
}));

/** A transaction handle that holds the native advisory lock to completion
 * (as `configuration-writes.test.ts` does) and answers the credential row
 * lock with `row`. Every statement is recorded. */
function credentialSql(row: { providerSlug: string } | null) {
  const statements: string[] = [];
  const tails = new Map<string, Promise<void>>();
  const tag = async (strings: TemplateStringsArray, ..._values: unknown[]) => {
    statements.push(strings.join('?'));
    return [];
  };
  const begin = async (work: (tx: unknown) => Promise<unknown>) => {
    const release: (() => void)[] = [];
    const tx = async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?');
      statements.push(text);
      if (text.includes('pg_advisory_xact_lock')) {
        const key = String(values[0]);
        const prior = tails.get(key) ?? Promise.resolve();
        let done!: () => void;
        const next = new Promise<void>((resolve) => {
          done = resolve;
        });
        tails.set(
          key,
          prior.then(() => next),
        );
        await prior;
        release.push(done);
        return [];
      }
      if (text.includes('FOR UPDATE')) return row === null ? [] : [row];
      return [];
    };
    try {
      return await work(tx);
    } finally {
      for (const done of release) done();
    }
  };
  return { sql: Object.assign(tag, { begin }) as unknown as Sql, statements };
}

const scope: CredentialScope = {
  organizationId: 'org-a',
  userId: 'operator',
  email: 'operator@example.test',
  role: 'admin',
};
const v1 = providerDefinitionSchema.parse({
  name: 'gateway',
  displayName: 'Gateway A',
  apiFormat: 'openai',
  baseUrl: 'https://models-v1.gateway.invalid/v1',
  catalog: { source: 'none' },
  auth: [{ method: 'api-key' }, { method: 'env' }],
});
const credentialHash = 'c'.repeat(64);
let directory: string;
const file = () => join(directory, 'north/providers/gateway.yml');
const history = async () =>
  readdir(join(directory, 'north/providers/.history/gateway')).catch(
    () => [] as string[],
  );

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'custom-provider-edit-'));
  vi.stubEnv('TALE_CONFIG_DIR', directory);
  audit.mockClear();
  updateCredential.mockReset();
  updateCredential.mockResolvedValue(undefined);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

/** Seed the definition an administrator's dialog then reads (v1). */
async function seed(sql: Sql) {
  const saved = await saveProviderDefinition(
    sql,
    { organizationId: 'org-a', orgSlug: 'north', userId: 'operator' },
    'gateway',
    v1,
    null,
  );
  audit.mockClear();
  return saved.hash ?? '';
}

describe('updateCredentialWithDefinition', () => {
  it('saves the credential and the provider together, the file last, and reads back', async () => {
    const { sql, statements } = credentialSql({ providerSlug: 'gateway' });
    const reviewed = await seed(sql);
    // What the definition file holds while the credential is written.
    let fileDuringCredentialWrite = '';
    updateCredential.mockImplementation(async () => {
      fileDuringCredentialWrite = await readFile(file(), 'utf8');
    });
    const before = await readFile(file(), 'utf8');
    const v2 = {
      ...v1,
      displayName: 'Gateway A2',
      baseUrl: 'https://models-v2.gateway.invalid/v1',
    };

    await updateCredentialWithDefinition(
      sql,
      scope,
      'north',
      'cred-a',
      { name: 'Gateway A2', modelAllowlist: null },
      credentialHash,
      { config: v2, expectedHash: reviewed },
    );

    expect(updateCredential).toHaveBeenCalledWith(
      expect.anything(),
      scope,
      'cred-a',
      { name: 'Gateway A2', modelAllowlist: null },
      credentialHash,
    );
    expect(fileDuringCredentialWrite).toBe(before);
    expect(
      statements.find((statement) => statement.includes('FOR UPDATE')),
    ).toContain('app.provider_credentials');
    const readback = await readProviderDefinition('north', 'gateway');
    expect(readback.config).toEqual(v2);
    expect(readback.hash).not.toBe(reviewed);
    expect(await history()).toHaveLength(1);
    expect(audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'provider_definition.saved' }),
    );
  });

  it('keeps the provider as it was when the credential is refused (#3662)', async () => {
    const { sql } = credentialSql({ providerSlug: 'gateway' });
    const reviewed = await seed(sql);
    const before = await readFile(file(), 'utf8');
    updateCredential.mockRejectedValue(
      new CredentialAdminError(
        'CREDENTIAL_NAME_TAKEN',
        'A credential named "Gateway B" already exists for this provider — pick a different name.',
        409,
      ),
    );

    await expect(
      updateCredentialWithDefinition(
        sql,
        scope,
        'north',
        'cred-a',
        { name: 'Gateway B', modelAllowlist: null },
        credentialHash,
        {
          config: {
            ...v1,
            displayName: 'Gateway B',
            baseUrl: 'https://models-v2.gateway.invalid/v1',
          },
          expectedHash: reviewed,
        },
      ),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_NAME_TAKEN', status: 409 });

    expect(await readFile(file(), 'utf8')).toBe(before);
    expect(await readProviderDefinition('north', 'gateway')).toEqual({
      config: v1,
      hash: reviewed,
    });
    expect(await history()).toEqual([]);
    expect(audit).not.toHaveBeenCalled();
  });

  it('refuses an editor older than the definition before writing either part (#3663)', async () => {
    const { sql } = credentialSql({ providerSlug: 'gateway' });
    const reviewed = await seed(sql);
    // Another administrator moves the provider to v2 while the dialog is open.
    const newer = await saveProviderDefinition(
      sql,
      { organizationId: 'org-a', orgSlug: 'north', userId: 'other' },
      'gateway',
      { ...v1, baseUrl: 'https://models-v2.gateway.invalid/v1' },
      reviewed,
    );
    const after = await readFile(file(), 'utf8');

    // The older dialog renames only: its facts are still v1's.
    await expect(
      updateCredentialWithDefinition(
        sql,
        scope,
        'north',
        'cred-a',
        { name: 'Gateway renamed', modelAllowlist: null },
        credentialHash,
        {
          config: { ...v1, displayName: 'Gateway renamed' },
          expectedHash: reviewed,
        },
      ),
    ).rejects.toMatchObject({ code: 'CONFIG_VERSION_CONFLICT', status: 409 });

    expect(updateCredential).not.toHaveBeenCalled();
    expect(await readFile(file(), 'utf8')).toBe(after);
    expect((await readProviderDefinition('north', 'gateway')).hash).toBe(
      newer.hash,
    );
  });

  it('refuses a credential of another provider, or none, without writing', async () => {
    const other = credentialSql({ providerSlug: 'another' });
    const reviewed = await seed(other.sql);
    const before = await readFile(file(), 'utf8');
    const edit = (sql: Sql) =>
      updateCredentialWithDefinition(
        sql,
        scope,
        'north',
        'cred-a',
        { name: 'Gateway A2' },
        credentialHash,
        {
          config: { ...v1, displayName: 'Gateway A2' },
          expectedHash: reviewed,
        },
      );

    await expect(edit(other.sql)).rejects.toMatchObject({
      code: 'PROVIDER_DEFINITION_INVALID',
      status: 400,
    });
    await expect(edit(credentialSql(null).sql)).rejects.toMatchObject({
      code: 'CREDENTIAL_NOT_FOUND',
      status: 404,
    });
    expect(updateCredential).not.toHaveBeenCalled();
    expect(await readFile(file(), 'utf8')).toBe(before);
  });

  it('refuses a caller without the admin or developer role before any lock', async () => {
    const { sql, statements } = credentialSql({ providerSlug: 'gateway' });
    await expect(
      updateCredentialWithDefinition(
        sql,
        { ...scope, role: 'member' },
        'north',
        'cred-a',
        { name: 'Gateway A2' },
        credentialHash,
        { config: v1, expectedHash: credentialHash },
      ),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN_DEVELOPER_SETTINGS',
      status: 403,
    });
    expect(statements).toEqual([]);
  });
});
