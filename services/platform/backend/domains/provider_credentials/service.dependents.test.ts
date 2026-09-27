// @vitest-environment node

/**
 * Deleting the credential the knowledge embedding model resolves took
 * indexing and search down org-wide, with nothing said at the delete. The
 * dependents read names the dependency, and the delete refuses on it.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readOrgEmbeddingConfig, resolveOrgSlug, createAuditLog } = vi.hoisted(
  () => ({
    readOrgEmbeddingConfig: vi.fn(),
    resolveOrgSlug: vi.fn(async (): Promise<string | null> => 'acme'),
    createAuditLog: vi.fn(async () => 'audit-1'),
  }),
);

vi.mock('../../core/knowledge/connection.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../core/knowledge/connection.ts')
  >()),
  readOrgEmbeddingConfig,
}));
vi.mock('../../lib/org-config.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/org-config.ts')>()),
  resolveOrgSlug,
}));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));
vi.mock('../../realtime/outbox.ts', () => ({
  emitHintInTx: vi.fn(async () => undefined),
}));

import {
  credentialDependents,
  deleteCredential,
  isCredentialSelectionResolvable,
} from './service.ts';

type Statement = { text: string; values: unknown[] };

function recordingSql(
  answer: (text: string, values: unknown[]) => unknown[] = () => [],
) {
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

const scope = { organizationId: 'org-1', userId: 'admin-1', role: 'admin' };

function harness(options: {
  row?: { providerSlug: string; isDefault: boolean; status: string } | null;
  sibling?: boolean;
}) {
  return recordingSql((text) => {
    if (text.includes('is_default AS "isDefault", status'))
      return options.row === null ? [] : [options.row ?? defaultRow];
    if (text.includes("status = 'active' AND id <> ?"))
      return options.sibling ? [{ id: 'cred-2' }] : [];
    if (text.startsWith('DELETE FROM app.provider_credentials'))
      return [{ name: 'Key', providerSlug: 'openai' }];
    return [];
  });
}
const defaultRow = {
  providerSlug: 'openai',
  isDefault: true,
  status: 'active',
};

beforeEach(() => {
  vi.clearAllMocks();
  resolveOrgSlug.mockResolvedValue('acme');
  readOrgEmbeddingConfig.mockResolvedValue(null);
});

describe('credentialDependents', () => {
  it('names the embedding model when the settings name this credential', async () => {
    readOrgEmbeddingConfig.mockResolvedValue({
      providerSlug: 'openai',
      credentialId: 'cred-1',
      model: 'm',
      dimensions: 3,
    });
    const { sql } = harness({
      row: { providerSlug: 'openai', isDefault: false, status: 'active' },
    });
    expect(await credentialDependents(sql, scope, 'cred-1')).toEqual({
      usedBy: ['embedding'],
    });
    expect(await credentialDependents(sql, scope, 'cred-9')).toEqual({
      usedBy: [],
    });
  });

  it('names it for the provider default that is the last active credential, not with a sibling', async () => {
    readOrgEmbeddingConfig.mockResolvedValue({
      providerSlug: 'openai',
      model: 'm',
      dimensions: 3,
    });
    expect(
      await credentialDependents(harness({}).sql, scope, 'cred-1'),
    ).toEqual({ usedBy: ['embedding'] });
    expect(
      await credentialDependents(
        harness({ sibling: true }).sql,
        scope,
        'cred-1',
      ),
    ).toEqual({ usedBy: [] });
    expect(
      await credentialDependents(
        harness({
          row: { providerSlug: 'openai', isDefault: false, status: 'active' },
        }).sql,
        scope,
        'cred-1',
      ),
    ).toEqual({ usedBy: [] });
    expect(
      await credentialDependents(
        harness({
          row: { providerSlug: 'mistral', isDefault: true, status: 'active' },
        }).sql,
        scope,
        'cred-1',
      ),
    ).toEqual({ usedBy: [] });
  });

  it('answers nothing without an embedding model, for an unknown credential, or a gone org', async () => {
    expect(
      await credentialDependents(harness({}).sql, scope, 'cred-1'),
    ).toEqual({ usedBy: [] });
    readOrgEmbeddingConfig.mockResolvedValue({
      providerSlug: 'openai',
      credentialId: 'cred-1',
      model: 'm',
      dimensions: 3,
    });
    expect(
      await credentialDependents(harness({ row: null }).sql, scope, 'cred-1'),
    ).toEqual({ usedBy: [] });
    resolveOrgSlug.mockResolvedValue(null);
    expect(
      await credentialDependents(harness({}).sql, scope, 'cred-1'),
    ).toEqual({ usedBy: [] });
  });

  it('is an admin read', async () => {
    await expect(
      credentialDependents(harness({}).sql, { ...scope, role: 'member' }, 'x'),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('deleteCredential', () => {
  it('refuses with 409 CREDENTIAL_IN_USE naming the dependent, nothing deleted', async () => {
    readOrgEmbeddingConfig.mockResolvedValue({
      providerSlug: 'openai',
      credentialId: 'cred-1',
      model: 'm',
      dimensions: 3,
    });
    const { sql, statements } = harness({});
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tag stands in for a transaction
    await expect(
      deleteCredential(sql as never, scope, 'cred-1'),
    ).rejects.toMatchObject({
      code: 'CREDENTIAL_IN_USE',
      status: 409,
      data: { usedBy: ['embedding'] },
    });
    expect(statements.some((s) => s.text.startsWith('DELETE'))).toBe(false);
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('deletes a credential nothing depends on', async () => {
    const { sql, statements } = harness({
      row: { providerSlug: 'openai', isDefault: false, status: 'active' },
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tag stands in for a transaction
    expect(await deleteCredential(sql as never, scope, 'cred-1')).toEqual({
      providerSlug: 'openai',
    });
    expect(statements.some((s) => s.text.startsWith('DELETE'))).toBe(true);
  });
});

describe('isCredentialSelectionResolvable', () => {
  it('looks the named credential up under its provider, else the provider default', async () => {
    const { sql, statements } = recordingSql((text) =>
      text.includes('is_default AND status') ? [] : [{ id: 'cred-1' }],
    );
    expect(
      await isCredentialSelectionResolvable(sql, 'org-1', {
        providerSlug: 'openai',
        credentialId: 'cred-1',
      }),
    ).toBe(true);
    expect(statements[0]?.values).toEqual(['cred-1', 'org-1', 'openai']);
    expect(
      await isCredentialSelectionResolvable(sql, 'org-1', {
        providerSlug: 'openai',
      }),
    ).toBe(false);
  });
});
