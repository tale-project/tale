// @vitest-environment node

/**
 * The coding agents people connected to an organization: made once for each
 * person, organization and app, shown to the person and to the owners and
 * admins, ended by either — and never revealed to anyone else.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { endAgentConnectionsAndTellInTx } from './end-and-tell.ts';
import {
  type AgentConnection,
  AgentConnectionError,
  connectAgent,
  type ConnectAgentInput,
  disconnectAgent,
  listAgentConnections,
} from './service.ts';
import { recordingSql } from './test-helpers.ts';

vi.mock('../audit_logs/service.ts', () => ({
  createAuditLog: vi.fn(() => Promise.resolve('audit-1')),
}));
vi.mock('../../realtime/outbox.ts', () => ({
  emitHintInTx: vi.fn(() => Promise.resolve()),
}));
vi.mock('./end-and-tell.ts', () => ({
  endAgentConnectionsAndTellInTx: vi.fn(() => Promise.resolve([])),
}));

const stored: AgentConnection = {
  id: 'conn-1',
  organizationId: 'org-1',
  userId: 'user-ada',
  clientId: 'https://claude.ai/oauth/client.json',
  clientName: 'Claude Code',
  provenance: 'metadata_document',
  clientHost: 'claude.ai',
  redirectHost: 'localhost',
  scopes: ['tale:mcp'],
  createdAt: 1_791_000_000_000,
  updatedAt: 1_791_000_000_000,
  revokedAt: null,
  revokedBy: null,
  revokeReason: null,
};

const ada = {
  actorId: 'user-ada',
  actorType: 'user' as const,
  actorRole: 'developer',
};

const connect: ConnectAgentInput = {
  organizationId: 'org-1',
  userId: 'user-ada',
  clientId: stored.clientId,
  clientName: 'Claude Code',
  provenance: 'metadata_document',
  clientHost: 'claude.ai',
  redirectHost: 'localhost',
  scopes: ['tale:mcp', 'tale:automations.write'],
  actor: ada,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('connecting an agent [AGCONN-R6]', () => {
  it('records a new connection under the lock of its person, organization and app, with the audit row and the hint', async () => {
    const { sql, statements } = recordingSql((statement) => {
      if (statement.text.startsWith('INSERT INTO app.agent_connections')) {
        return [{ ...stored, scopes: connect.scopes }];
      }
      return undefined;
    });
    const answered = await connectAgent(sql, connect);
    expect(answered).toMatchObject({
      created: true,
      scopesChanged: false,
      connection: { id: 'conn-1', scopes: connect.scopes },
    });
    expect(statements[0]?.text).toContain('pg_advisory_xact_lock');
    expect(statements[0]?.values).toEqual([
      `agent-connection:org-1/user-ada/${stored.clientId}`,
    ]);
    // Only a live connection is looked for, locked for the write.
    expect(statements[1]?.text).toContain(
      'WHERE org_id = ? AND user_id = ? AND client_id = ? AND revoked_at_ms IS NULL FOR UPDATE',
    );
    const insert = statements[2];
    expect(insert?.values.slice(1)).toEqual([
      'org-1',
      'user-ada',
      stored.clientId,
      'Claude Code',
      'metadata_document',
      'claude.ai',
      'localhost',
      ['tale:mcp', 'tale:automations.write'],
      expect.any(Number),
      expect.any(Number),
    ]);
    expect(vi.mocked(createAuditLog).mock.calls[0]?.[1]).toMatchObject({
      organizationId: 'org-1',
      actorId: 'user-ada',
      actorType: 'user',
      action: 'agent_connection.created',
      category: 'security',
      resourceType: 'agent_connection',
      resourceId: 'conn-1',
      resourceName: 'Claude Code',
      newState: {
        clientId: stored.clientId,
        provenance: 'metadata_document',
        clientHost: 'claude.ai',
        redirectHost: 'localhost',
        scopes: connect.scopes,
      },
      status: 'success',
    });
    expect(vi.mocked(emitHintInTx).mock.calls[0]?.[1]).toEqual({
      orgId: 'org-1',
      entity: 'agent_connection',
      entityId: 'conn-1',
    });
  });

  it('keeps the dedicated column list out of the person’s hands: a scope listed twice is stored once', async () => {
    const { sql, statements } = recordingSql((statement) =>
      statement.text.startsWith('INSERT INTO') ? [stored] : undefined,
    );
    await connectAgent(sql, {
      ...connect,
      scopes: ['tale:mcp', 'tale:mcp', 'offline_access'],
    });
    expect(statements[2]?.values[8]).toEqual(['tale:mcp', 'offline_access']);
  });

  it('changes the access of the connection that is already live instead of making a second one, and says what it was and is', async () => {
    const { sql, statements } = recordingSql((statement) => {
      if (statement.text.startsWith('SELECT')) return [stored];
      if (statement.text.startsWith('UPDATE app.agent_connections')) {
        return [{ ...stored, scopes: connect.scopes, updatedAt: 1 }];
      }
      return undefined;
    });
    const answered = await connectAgent(sql, connect);
    expect(answered).toMatchObject({
      created: false,
      scopesChanged: true,
      connection: { id: 'conn-1' },
    });
    expect(statements.some((s) => s.text.startsWith('INSERT INTO'))).toBe(
      false,
    );
    expect(statements[2]?.text).toContain(
      'SET client_name = ?, client_provenance = ?, client_host = ?, redirect_host = ?, scopes = ?::text[], updated_at_ms = ? WHERE id = ?',
    );
    expect(vi.mocked(createAuditLog).mock.calls[0]?.[1]).toMatchObject({
      action: 'agent_connection.updated',
      resourceId: 'conn-1',
      previousState: { scopes: ['tale:mcp'] },
      newState: { scopes: connect.scopes },
    });
    expect(emitHintInTx).toHaveBeenCalledTimes(1);
  });

  it('writes no audit row when the person allows the same access again', async () => {
    const { sql } = recordingSql((statement) => {
      if (statement.text.startsWith('SELECT')) {
        return [{ ...stored, scopes: ['tale:automations.write', 'tale:mcp'] }];
      }
      if (statement.text.startsWith('UPDATE')) {
        return [{ ...stored, scopes: connect.scopes }];
      }
      return undefined;
    });
    await expect(connectAgent(sql, connect)).resolves.toMatchObject({
      created: false,
      scopesChanged: false,
    });
    expect(createAuditLog).not.toHaveBeenCalled();
  });
});

describe('listing the connections of an organization [AGCONN-R1]', () => {
  const list = (
    args: Partial<Parameters<typeof listAgentConnections>[1]> & {
      viewerRole: string;
    },
  ) => {
    const { sql, statements } = recordingSql(() => [stored]);
    return listAgentConnections(sql, {
      organizationId: 'org-1',
      viewerId: 'user-ada',
      ...args,
    }).then((answer) => ({ answer, statement: statements[0] }));
  };

  it('shows a person their own live connections, newest first', async () => {
    const { answer, statement } = await list({ viewerRole: 'developer' });
    expect(answer).toEqual({ connections: [stored], canSeeEveryone: false });
    expect(statement?.text).toContain(
      'WHERE org_id = ? AND user_id = ? AND revoked_at_ms IS NULL ORDER BY created_at_ms DESC, id LIMIT ?',
    );
    expect(statement?.values).toEqual(['org-1', 'user-ada', 500]);
  });

  it('shows an owner or admin everyone’s when they ask for it, and the ended ones when they ask for those', async () => {
    for (const role of ['owner', 'admin', 'Admin']) {
      const everyone = await list({
        viewerRole: role,
        everyone: true,
        includeEnded: true,
      });
      expect(everyone.answer.canSeeEveryone).toBe(true);
      expect(everyone.statement?.text).toContain(
        'WHERE org_id = ? ORDER BY created_at_ms DESC',
      );
      expect(everyone.statement?.text).not.toContain('AND user_id = ?');
      expect(everyone.statement?.text).not.toContain('revoked_at_ms IS NULL');
      // Asked for nothing more, an admin sees their own, like anyone.
      const mine = await list({ viewerRole: role });
      expect(mine.statement?.text).toContain('AND user_id = ?');
      expect(mine.answer.canSeeEveryone).toBe(true);
    }
  });

  it('shows no one more than their own, however they ask', async () => {
    for (const role of ['developer', 'editor', 'member']) {
      const asked = await list({
        viewerRole: role,
        everyone: true,
        includeEnded: true,
      });
      expect(asked.answer.canSeeEveryone).toBe(false);
      expect(asked.statement?.text).toContain('AND user_id = ?');
      expect(asked.statement?.text).toContain('AND revoked_at_ms IS NULL');
    }
  });

  it('says when each agent last called, from the endpoint’s own counters for that connection alone', async () => {
    const { statement } = await list({ viewerRole: 'developer' });
    expect(statement?.text).toContain(
      '( SELECT MAX(last_at_ms)::float8 FROM app.mcp_client_activity WHERE org_id = c.org_id AND user_id = c.user_id AND credential_kind = \'oauth\' AND credential_id = c.id ) AS "lastUsedAt" FROM app.agent_connections c',
    );
  });

  it('keeps what was made, changed or ended after a moment', async () => {
    const { statement } = await list({
      viewerRole: 'developer',
      since: 1_791_000_000_500,
    });
    expect(statement?.text).toContain(
      'AND GREATEST(created_at_ms, updated_at_ms, COALESCE(revoked_at_ms, 0)) > ?',
    );
    expect(statement?.values).toEqual([
      'org-1',
      'user-ada',
      1_791_000_000_500,
      500,
    ]);
  });
});

describe('disconnecting an agent [AGCONN-R2]', () => {
  const live = (userId: string) =>
    recordingSql((statement) =>
      statement.text.startsWith('SELECT id, user_id')
        ? [{ id: 'conn-1', userId }]
        : undefined,
    );

  const disconnect = (
    sql: ReturnType<typeof recordingSql>['sql'],
    viewer: { userId: string; role: string },
    connectionId = 'conn-1',
  ) =>
    disconnectAgent(sql, {
      organizationId: 'org-1',
      connectionId,
      viewer: { ...viewer, email: 'ada@example.test', ip: '203.0.113.9' },
    });

  it('ends the person’s own connection as theirs, with their name on the trail', async () => {
    const { sql, statements } = live('user-ada');
    await expect(
      disconnect(sql, { userId: 'user-ada', role: 'developer' }),
    ).resolves.toEqual({ id: 'conn-1' });
    expect(statements[0]?.text).toContain(
      'WHERE id = ? AND org_id = ? AND revoked_at_ms IS NULL FOR UPDATE',
    );
    expect(statements[0]?.values).toEqual(['conn-1', 'org-1']);
    expect(
      vi.mocked(endAgentConnectionsAndTellInTx).mock.calls[0]?.[1],
    ).toEqual({
      organizationId: 'org-1',
      connectionIds: ['conn-1'],
      reason: 'user',
      revokedBy: 'user-ada',
      actor: {
        actorId: 'user-ada',
        actorType: 'user',
        actorRole: 'developer',
        actorEmail: 'ada@example.test',
        ipAddress: '203.0.113.9',
      },
    });
  });

  it('lets an owner or admin end anyone’s, as the admin’s act', async () => {
    for (const role of ['owner', 'admin']) {
      vi.mocked(endAgentConnectionsAndTellInTx).mockClear();
      const { sql } = live('user-ada');
      await disconnect(sql, { userId: 'user-olav', role });
      expect(
        vi.mocked(endAgentConnectionsAndTellInTx).mock.calls[0]?.[1],
      ).toMatchObject({ reason: 'admin', revokedBy: 'user-olav' });
    }
  });

  it('answers not found, never forbidden, for another person’s connection, an unknown one and one that already ended', async () => {
    for (const [role, rows] of [
      ['developer', [{ id: 'conn-1', userId: 'user-ada' }]],
      ['member', [{ id: 'conn-1', userId: 'user-ada' }]],
      // The lookup only finds a live connection of this organization.
      ['admin', []],
    ] as const) {
      const { sql } = recordingSql((statement) =>
        statement.text.startsWith('SELECT id, user_id') ? [...rows] : undefined,
      );
      await expect(
        disconnect(sql, { userId: 'user-mia', role }),
      ).rejects.toMatchObject({
        code: 'AGENT_CONNECTION_NOT_FOUND',
        status: 404,
      });
      await expect(
        disconnect(sql, { userId: 'user-mia', role }),
      ).rejects.toBeInstanceOf(AgentConnectionError);
    }
    expect(endAgentConnectionsAndTellInTx).not.toHaveBeenCalled();
  });
});
