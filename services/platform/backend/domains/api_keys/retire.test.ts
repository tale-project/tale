// @vitest-environment node

import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAuditLog } from '../audit_logs/service.ts';
import { deleteOrganizationApiKeysInTx, retireApiKeysInTx } from './retire.ts';

/**
 * A key bound to an organization ends with what it belonged to: a deleted
 * team or project, a member who left, the organization itself.
 */

vi.mock('../audit_logs/service.ts', () => ({
  createAuditLog: vi.fn(() => Promise.resolve('audit-1')),
}));
vi.mock('../../realtime/outbox.ts', () => ({
  emitHintInTx: vi.fn(() => Promise.resolve()),
}));

interface Statement {
  text: string;
  values: unknown[];
}

function fakeTx(answers: {
  targets?: string[];
  revoked?: { apiKeyId: string; kind: string; name: string }[];
  deleted?: { apiKeyId: string; principalUserId: string; kind: string }[];
}): { tx: TransactionSql; statements: Statement[] } {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.startsWith('SELECT api_key_id')) {
      return Promise.resolve(
        (answers.targets ?? []).map((apiKeyId) => ({ apiKeyId })),
      );
    }
    if (text.startsWith('UPDATE app.api_key_owners')) {
      return Promise.resolve(answers.revoked ?? []);
    }
    if (text.startsWith('DELETE FROM app.api_key_owners')) {
      return Promise.resolve(answers.deleted ?? []);
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for postgres.js
  return { tx: tag as unknown as TransactionSql, statements };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('retireApiKeysInTx', () => {
  it('ends a deleted team’s keys, with an audit row from the system saying why [APIKEY-R7]', async () => {
    const { tx, statements } = fakeTx({
      targets: ['key-1'],
      revoked: [{ apiKeyId: 'key-1', kind: 'team', name: 'Finance export' }],
    });
    await expect(
      retireApiKeysInTx(tx, {
        organizationId: 'org-1',
        reason: 'team_deleted',
        teamId: 'finance',
      }),
    ).resolves.toEqual(['key-1']);

    // Only this organization's live keys of that team are looked for.
    expect(statements[0]?.values).toEqual(['org-1', 'finance', null, null]);
    expect(statements[1]?.values.slice(1)).toEqual([
      'system',
      'org-1',
      ['key-1'],
    ]);
    expect(statements[2]).toEqual({
      text: 'DELETE FROM "apikey" WHERE "id" = ANY(?)',
      values: [['key-1']],
    });
    expect(vi.mocked(createAuditLog).mock.calls.map((call) => call[1])).toEqual(
      [
        {
          organizationId: 'org-1',
          actorId: 'system',
          actorType: 'system',
          action: 'api_key.revoked',
          category: 'security',
          resourceType: 'api_key',
          resourceId: 'key-1',
          resourceName: 'Finance export',
          previousState: { owner: 'team' },
          metadata: { reason: 'team_deleted' },
          status: 'success',
        },
      ],
    );
  });

  it('looks for the keys made for a member who left, and touches nothing when there are none [APIKEY-R7]', async () => {
    const { tx, statements } = fakeTx({});
    await expect(
      retireApiKeysInTx(tx, {
        organizationId: 'org-1',
        reason: 'member_removed',
        memberUserId: 'mia',
      }),
    ).resolves.toEqual([]);
    expect(statements).toHaveLength(1);
    expect(statements[0]?.values).toEqual(['org-1', null, null, 'mia']);
    expect(createAuditLog).not.toHaveBeenCalled();
  });
});

describe('deleteOrganizationApiKeysInTx', () => {
  it('removes every bound key, and the identities only of the keys that are not a person [APIKEY-R7]', async () => {
    const { tx, statements } = fakeTx({
      deleted: [
        { apiKeyId: 'key-member', principalUserId: 'mia', kind: 'member' },
        { apiKeyId: 'key-team', principalUserId: 'identity-1', kind: 'team' },
        {
          apiKeyId: 'key-org',
          principalUserId: 'identity-2',
          kind: 'organization',
        },
      ],
    });
    await deleteOrganizationApiKeysInTx(tx, 'org-1');
    expect(statements.map(({ text, values }) => [text, values])).toEqual([
      [expect.stringContaining('DELETE FROM app.api_key_owners'), ['org-1']],
      [
        'DELETE FROM "apikey" WHERE "id" = ANY(?)',
        [['key-member', 'key-team', 'key-org']],
      ],
      // Mia is a person: her account stays.
      [
        'DELETE FROM "user" WHERE "id" = ANY(?)',
        [['identity-1', 'identity-2']],
      ],
    ]);
  });
});
