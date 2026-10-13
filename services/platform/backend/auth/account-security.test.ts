// @vitest-environment node

/**
 * Taking a person's access back [AGCONN-R17]: the sessions and the coding
 * agents end together, as the platform's doing or the admin's.
 */

import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { endAgentConnectionsInTx } from '../domains/agent_connections/end.ts';
import { endAgentsOf, endAllAccessOf } from './account-security.ts';

vi.mock('../domains/agent_connections/end.ts', () => ({
  endAgentConnectionsInTx: vi.fn(() => Promise.resolve([])),
}));

function recordingTx() {
  const statements: { text: string; values: unknown[] }[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    statements.push({
      text: strings.join('?').replaceAll(/\s+/g, ' ').trim(),
      values,
    });
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SQL tag test double
  return { tx: tag as unknown as TransactionSql, statements };
}

const admin = {
  actorId: 'user-olav',
  actorType: 'user' as const,
  actorRole: 'owner',
  actorEmail: 'olav@example.test',
};

beforeEach(() => {
  vi.mocked(endAgentConnectionsInTx).mockClear();
});

describe('ending the coding agents of a person [AGCONN-R17]', () => {
  it('ends every one of theirs, in every organization, for account security, as the platform’s doing', async () => {
    const { tx, statements } = recordingTx();
    await endAgentsOf(tx, 'user-mia');
    expect(statements).toEqual([]);
    expect(endAgentConnectionsInTx).toHaveBeenCalledExactlyOnceWith(tx, {
      userId: 'user-mia',
      reason: 'account_security',
      revokedBy: 'system',
    });
  });

  it('names the admin whose act it is, in the trail and as the one who ended them', async () => {
    const { tx } = recordingTx();
    await endAgentsOf(tx, 'user-mia', admin);
    expect(endAgentConnectionsInTx).toHaveBeenCalledExactlyOnceWith(tx, {
      userId: 'user-mia',
      reason: 'account_security',
      revokedBy: 'user-olav',
      actor: admin,
    });
  });
});

describe('ending every access of a person [AGCONN-R17]', () => {
  it('ends their sessions and then their agents, on the same transaction', async () => {
    const { tx, statements } = recordingTx();
    await endAllAccessOf(tx, 'user-mia', admin);
    expect(statements).toEqual([
      {
        text: 'DELETE FROM "session" WHERE "userId" = ?',
        values: ['user-mia'],
      },
    ]);
    expect(endAgentConnectionsInTx).toHaveBeenCalledExactlyOnceWith(tx, {
      userId: 'user-mia',
      reason: 'account_security',
      revokedBy: 'user-olav',
      actor: admin,
    });
  });

  it('is the platform’s doing when no admin is named', async () => {
    const { tx } = recordingTx();
    await endAllAccessOf(tx, 'user-mia');
    expect(vi.mocked(endAgentConnectionsInTx).mock.calls[0]?.[1]).toMatchObject(
      { revokedBy: 'system' },
    );
    expect(
      vi.mocked(endAgentConnectionsInTx).mock.calls[0]?.[1],
    ).not.toHaveProperty('actor');
  });
});
