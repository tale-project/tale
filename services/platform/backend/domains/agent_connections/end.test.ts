// @vitest-environment node

/**
 * Ending the connections of coding agents: the record, the consent and the
 * refresh tokens the sign-in server holds for it, the audit row and the hint
 * — the same for whatever ends one.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { endAgentConnectionsInTx } from './end.ts';
import { recordingSql } from './test-helpers.ts';

vi.mock('../audit_logs/service.ts', () => ({
  createAuditLog: vi.fn(() => Promise.resolve('audit-1')),
}));
vi.mock('../../realtime/outbox.ts', () => ({
  emitHintInTx: vi.fn(() => Promise.resolve()),
}));

/** A transaction that records what it was awaited for, answering the live
 * connections an `UPDATE … RETURNING` ends. */
function fakeTx(ended: unknown[] = []) {
  const { tx, statements } = recordingSql((statement) =>
    statement.text.startsWith('UPDATE app.agent_connections')
      ? ended
      : undefined,
  );
  return { tx, statements };
}

const claude = {
  id: 'conn-1',
  organizationId: 'org-1',
  userId: 'user-ada',
  clientId: 'https://claude.ai/oauth/client.json',
  clientName: 'Claude Code',
  scopes: ['tale:mcp', 'tale:automations.write'],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ending agent connections', () => {
  it('ends the live connections the filters name, in the one statement that says why and by whom', async () => {
    const { tx, statements } = fakeTx([claude]);
    const before = Date.now();
    await expect(
      endAgentConnectionsInTx(tx, {
        organizationId: 'org-1',
        userId: 'user-ada',
        reason: 'membership_ended',
        revokedBy: 'system',
      }),
    ).resolves.toEqual([claude]);
    const update = statements[0];
    expect(update?.text).toContain(
      'UPDATE app.agent_connections SET revoked_at_ms = ?, revoked_by = ?, revoke_reason = ? WHERE revoked_at_ms IS NULL AND org_id = ? AND user_id = ? RETURNING',
    );
    expect(update?.values).toEqual([
      expect.any(Number),
      'system',
      'membership_ended',
      'org-1',
      'user-ada',
    ]);
    expect(Number(update?.values[0])).toBeGreaterThanOrEqual(before);
  });

  it('filters by app, by connection and by every filter given together, and by nothing else', async () => {
    for (const [args, where, values] of [
      [{ clientId: 'client-1' }, 'AND client_id = ?', ['client-1']],
      [{ connectionIds: ['a', 'b'] }, 'AND id = ANY(?)', [['a', 'b']]],
      [
        { userId: 'u', clientId: 'c' },
        'AND user_id = ? AND client_id = ?',
        ['u', 'c'],
      ],
    ] as const) {
      const { tx, statements } = fakeTx();
      await endAgentConnectionsInTx(tx, {
        ...args,
        reason: 'refresh_reuse',
        revokedBy: 'system',
      });
      const update = statements[0];
      expect(update?.text).toContain(
        `revoked_at_ms IS NULL ${where} RETURNING`,
      );
      expect(update?.text).not.toContain('org_id =');
      expect(update?.values.slice(3)).toEqual(values);
    }
  });

  it('refuses to end connections without a filter, so a call can never end them all', async () => {
    const { tx, statements } = fakeTx([claude]);
    await expect(
      endAgentConnectionsInTx(tx, { reason: 'user', revokedBy: 'ada' }),
    ).rejects.toThrow('needs a filter');
    expect(statements).toEqual([]);
  });

  it('ends nothing when it is given no connection to end', async () => {
    const { tx, statements } = fakeTx([claude]);
    await expect(
      endAgentConnectionsInTx(tx, {
        connectionIds: [],
        reason: 'admin',
        revokedBy: 'ada',
      }),
    ).resolves.toEqual([]);
    expect(statements).toEqual([]);
  });

  it('deletes the consent and every refresh token of the app for this person in this organization — never stamps one revoked [AGCONN-R3]', async () => {
    const { tx, statements } = fakeTx([claude]);
    await endAgentConnectionsInTx(tx, {
      connectionIds: ['conn-1'],
      reason: 'user',
      revokedBy: 'user-ada',
    });
    const grant = ['https://claude.ai/oauth/client.json', 'user-ada', 'org-1'];
    const deletes = statements.filter((s) => s.text.startsWith('DELETE FROM'));
    expect(deletes.map((s) => s.text.split(' WHERE ')[0])).toEqual([
      'DELETE FROM "oauthAccessToken"',
      'DELETE FROM "oauthAccessToken"',
      'DELETE FROM "oauthRefreshToken"',
      'DELETE FROM "oauthConsent"',
    ]);
    expect(deletes[0]?.values).toEqual(grant);
    // The access tokens a refresh token made, found through it.
    expect(deletes[1]?.text).toContain(
      '"refreshId" IN ( SELECT "id" FROM "oauthRefreshToken"',
    );
    expect(deletes[1]?.values).toEqual(grant);
    expect(deletes[2]?.values).toEqual(grant);
    expect(deletes[3]?.values).toEqual(grant);
    // The provider reads a refused token still on file as one used twice and
    // ends every refresh token of the app for the person, in every
    // organization: nothing here leaves a revoked one behind.
    expect(
      statements.some((s) => s.text.startsWith('UPDATE "oauthRefreshToken"')),
    ).toBe(false);
  });

  it('leaves the grant of the same app in another organization alone [AGCONN-R3]', async () => {
    const { tx, statements } = fakeTx([claude]);
    await endAgentConnectionsInTx(tx, {
      connectionIds: ['conn-1'],
      reason: 'user',
      revokedBy: 'user-ada',
    });
    for (const statement of statements.filter((s) =>
      s.text.startsWith('DELETE FROM'),
    )) {
      expect(statement.text).toMatch(/"referenceId" = \?|"refreshId" IN/);
      expect(statement.values).toContain('org-1');
    }
  });

  it('writes one audit row from the platform saying why, and one hint to the organization, for each [AGCONN-R5]', async () => {
    const other = { ...claude, id: 'conn-2', clientName: 'Codex' };
    const { tx } = fakeTx([claude, other]);
    await endAgentConnectionsInTx(tx, {
      userId: 'user-ada',
      reason: 'account_security',
      revokedBy: 'system',
    });
    expect(vi.mocked(createAuditLog).mock.calls.map((call) => call[1])).toEqual(
      [
        expect.objectContaining({
          organizationId: 'org-1',
          actorId: 'system',
          actorType: 'system',
          action: 'agent_connection.revoked',
          category: 'security',
          resourceType: 'agent_connection',
          resourceId: 'conn-1',
          resourceName: 'Claude Code',
          previousState: {
            clientId: claude.clientId,
            userId: 'user-ada',
            scopes: claude.scopes,
          },
          metadata: { reason: 'account_security' },
          status: 'success',
        }),
        expect.objectContaining({
          resourceId: 'conn-2',
          resourceName: 'Codex',
        }),
      ],
    );
    expect(vi.mocked(emitHintInTx).mock.calls.map((call) => call[1])).toEqual([
      { orgId: 'org-1', entity: 'agent_connection', entityId: 'conn-1' },
      { orgId: 'org-1', entity: 'agent_connection', entityId: 'conn-2' },
    ]);
  });

  it('names the person in the audit row when a person ends it [AGCONN-R5]', async () => {
    const { tx } = fakeTx([claude]);
    await endAgentConnectionsInTx(tx, {
      connectionIds: ['conn-1'],
      reason: 'admin',
      revokedBy: 'user-olav',
      actor: {
        actorId: 'user-olav',
        actorType: 'user',
        actorRole: 'admin',
        actorEmail: 'olav@example.test',
        ipAddress: '203.0.113.9',
        userAgent: 'probe',
      },
    });
    expect(vi.mocked(createAuditLog).mock.calls[0]?.[1]).toMatchObject({
      actorId: 'user-olav',
      actorType: 'user',
      actorRole: 'admin',
      actorEmail: 'olav@example.test',
      ipAddress: '203.0.113.9',
      userAgent: 'probe',
      metadata: { reason: 'admin' },
    });
  });

  it('writes nothing for a connection that was not live', async () => {
    const { tx, statements } = fakeTx([]);
    await expect(
      endAgentConnectionsInTx(tx, {
        organizationId: 'org-1',
        reason: 'membership_ended',
        revokedBy: 'system',
      }),
    ).resolves.toEqual([]);
    expect(statements).toHaveLength(1);
    expect(createAuditLog).not.toHaveBeenCalled();
    expect(emitHintInTx).not.toHaveBeenCalled();
  });
});
