// @vitest-environment node

/**
 * Telling the person an agent they connected was disconnected [AGCONN-R20]:
 * which endings write a notice, in which organization, with what words, and
 * that a notice that cannot be written never undoes the ending.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { notifyUser } from '../collab/service.ts';
import { endAgentConnectionsAndTellInTx } from './end-and-tell.ts';
import { endAgentConnectionsInTx } from './end.ts';
import { recordingSql } from './test-helpers.ts';

vi.mock('./end.ts', () => ({ endAgentConnectionsInTx: vi.fn() }));
vi.mock('../collab/service.ts', () => ({
  notifyUser: vi.fn(() => Promise.resolve()),
}));

const claude = {
  id: 'conn-1',
  organizationId: 'org-1',
  userId: 'user-ada',
  clientId: 'https://claude.ai/oauth/client.json',
  clientName: 'Claude Code',
  scopes: ['tale:mcp', 'tale:automations.write'],
};
const codexElsewhere = {
  ...claude,
  id: 'conn-2',
  organizationId: 'org-2',
  clientName: 'Codex',
};

type Reason = Parameters<typeof endAgentConnectionsAndTellInTx>[1]['reason'];

/** A transaction whose only answer is the admin's name, and the ending the
 * core makes of `ended`. */
function endingOf(ended: unknown[], admin?: { name: string | null }) {
  vi.mocked(endAgentConnectionsInTx).mockResolvedValue(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the rows the core ending answers
    ended as Awaited<ReturnType<typeof endAgentConnectionsInTx>>,
  );
  return recordingSql((statement) =>
    statement.text.startsWith('SELECT "name", "email" FROM "user"')
      ? [{ name: admin?.name ?? null, email: 'olav@example.test' }]
      : undefined,
  );
}

const byThePlatform = (reason: Reason) => ({
  userId: 'user-ada',
  reason,
  revokedBy: 'system',
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ending an agent and telling the person [AGCONN-R20]', () => {
  it('ends them as the core does, with the arguments it was given, and answers what it ended', async () => {
    const { tx } = endingOf([claude]);
    const args = byThePlatform('account_security');
    await expect(endAgentConnectionsAndTellInTx(tx, args)).resolves.toEqual([
      claude,
    ]);
    expect(endAgentConnectionsInTx).toHaveBeenCalledExactlyOnceWith(tx, args);
  });

  it('writes a bell notice in the organization of each connection when a refresh token was used twice, naming the app and the way back', async () => {
    const { tx } = endingOf([claude, codexElsewhere]);
    await endAgentConnectionsAndTellInTx(tx, byThePlatform('refresh_reuse'));
    expect(vi.mocked(notifyUser).mock.calls.map((call) => call[1])).toEqual([
      {
        organizationId: 'org-1',
        userId: 'user-ada',
        type: 'agent_connection_ended',
        titleKey: 'agentConnectionEnded',
        bodyKey: 'agentConnectionEndedReuseBody',
        params: { client: 'Claude Code', agentConnections: true },
        resourceType: 'agent_connection',
        resourceId: 'conn-1',
        actorType: 'system',
      },
      {
        organizationId: 'org-2',
        userId: 'user-ada',
        type: 'agent_connection_ended',
        titleKey: 'agentConnectionEnded',
        bodyKey: 'agentConnectionEndedReuseBody',
        params: { client: 'Codex', agentConnections: true },
        resourceType: 'agent_connection',
        resourceId: 'conn-2',
        actorType: 'system',
      },
    ]);
  });

  it('says the sign-in details changed when an account’s security ended it', async () => {
    const { tx } = endingOf([claude]);
    await endAgentConnectionsAndTellInTx(tx, byThePlatform('account_security'));
    expect(vi.mocked(notifyUser).mock.calls[0]?.[1]).toMatchObject({
      bodyKey: 'agentConnectionEndedAccountBody',
      actorType: 'system',
    });
  });

  it('names the admin who disconnected it, by name and else by address', async () => {
    for (const [name, shown] of [
      ['Olav Berg', 'Olav Berg'],
      ['  ', 'olav@example.test'],
      [null, 'olav@example.test'],
    ] as const) {
      vi.mocked(notifyUser).mockClear();
      const { tx, statements } = endingOf([claude], { name });
      await endAgentConnectionsAndTellInTx(tx, {
        connectionIds: ['conn-1'],
        reason: 'admin',
        revokedBy: 'user-olav',
      });
      const lookup = statements.find((s) => s.text.includes('FROM "user"'));
      expect(lookup?.values).toEqual(['user-olav']);
      expect(vi.mocked(notifyUser).mock.calls[0]?.[1]).toMatchObject({
        bodyKey: 'agentConnectionEndedAdminBody',
        params: { client: 'Claude Code', name: shown, agentConnections: true },
        actorType: 'user',
        actorId: 'user-olav',
      });
    }
  });

  it('looks the admin up once however many connections it ended, and not when it ended none', async () => {
    const { tx, statements } = endingOf([claude, codexElsewhere], {
      name: 'Olav Berg',
    });
    await endAgentConnectionsAndTellInTx(tx, {
      userId: 'user-ada',
      reason: 'admin',
      revokedBy: 'user-olav',
    });
    expect(notifyUser).toHaveBeenCalledTimes(2);
    expect(
      statements.filter((s) => s.text.includes('FROM "user"')),
    ).toHaveLength(1);
    const none = endingOf([]);
    await endAgentConnectionsAndTellInTx(none.tx, {
      userId: 'user-ada',
      reason: 'admin',
      revokedBy: 'user-olav',
    });
    expect(none.statements).toEqual([]);
    expect(notifyUser).toHaveBeenCalledTimes(2);
  });

  it('tells nobody when the person ended it themselves, left the organization, or the app was removed', async () => {
    for (const reason of [
      'user',
      'membership_ended',
      'client_removed',
    ] as const) {
      const { tx, statements } = endingOf([claude]);
      await endAgentConnectionsAndTellInTx(tx, byThePlatform(reason));
      expect(statements, reason).toEqual([]);
    }
    expect(notifyUser).not.toHaveBeenCalled();
  });

  it('gives the notice up alone when it cannot be written: the ending stands, loudly, and the next connection is still told', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(notifyUser).mockRejectedValueOnce(new Error('disk full'));
    const { tx } = endingOf([claude, codexElsewhere]);
    await expect(
      endAgentConnectionsAndTellInTx(tx, byThePlatform('refresh_reuse')),
    ).resolves.toEqual([claude, codexElsewhere]);
    expect(notifyUser).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it('writes each notice inside a savepoint, so one that fails leaves the transaction usable', async () => {
    const { tx } = endingOf([claude]);
    const savepoint = vi.spyOn(tx, 'savepoint');
    await endAgentConnectionsAndTellInTx(tx, byThePlatform('refresh_reuse'));
    expect(savepoint).toHaveBeenCalledTimes(1);
  });
});
