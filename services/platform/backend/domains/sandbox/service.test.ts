// @vitest-environment node

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sessionDestroy } from '../../core/node_only/sandbox/helpers/session_client.ts';
import { wakeParkedAgentRuns } from '../tasks/agent-runs.ts';
import { revokeSessionGatewayKeys } from './gateway-keys.ts';
import { teardownSession } from './service.ts';
import type { SessionRow } from './sessions.ts';

vi.mock('../../core/node_only/sandbox/helpers/session_client.ts', () => ({
  sessionDestroy: vi.fn(),
  sessionIsAlive: vi.fn(),
  sessionSetPinned: vi.fn(),
}));
vi.mock('../tasks/agent-runs.ts', () => ({
  wakeParkedAgentRuns: vi.fn(async () => 0),
}));
vi.mock('./gateway-keys.ts', () => ({
  revokeSessionGatewayKeys: vi.fn(async () => ({ revoked: 0, failed: 0 })),
}));

const OWNED_SESSION: SessionRow = {
  id: 'row-a',
  organizationId: 'org-a',
  sessionId: 'session-a',
  profile: 'agent',
  status: 'active',
  ownerType: 'project_agent',
  ownerId: 'agent-a',
  createdBy: 'user-a',
  agentKind: 'opencode',
  llmGatewayKeyId: null,
  pinned: false,
  createdAt: 1000,
  expiresAt: 2000,
  lastActivityAt: null,
  destroyedAt: null,
};

interface Statement {
  text: string;
  values: unknown[];
}

/** Exercise the real scoped lookup and settlement; only the SQL transport is
 * scripted. The SELECT's bound organization and id must both match the row. */
function fakeSql(row: SessionRow | null) {
  const statements: Statement[] = [];
  const stored = row === null ? null : { ...row };
  const query = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.startsWith('SELECT')) {
      const matches =
        stored !== null &&
        values.at(-2) === stored.sessionId &&
        values.at(-1) === stored.organizationId;
      return Promise.resolve(matches ? [stored] : []);
    }
    if (text.startsWith('UPDATE app.sandbox_sessions')) {
      if (
        stored === null ||
        stored.status === 'destroyed' ||
        !values.includes(stored.sessionId) ||
        !values.includes(stored.organizationId)
      )
        return Promise.resolve([]);
      stored.status = 'destroyed';
      return Promise.resolve([{ id: stored.id }]);
    }
    return Promise.resolve([]);
  };
  const sql = Object.assign(query, {
    unsafe: (fragment: string) => fragment,
    begin: <T>(callback: (tx: typeof query) => Promise<T>) => callback(query),
  });
  return { sql: sql as unknown as Sql, statements, stored };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sessionDestroy).mockResolvedValue(true);
});

describe('teardownSession ownership and confirmed deletion', () => {
  it.each([
    ['another organization', { ...OWNED_SESSION, organizationId: 'org-b' }],
    ['no organization', null],
  ])('does not touch a session belonging to %s', async (_label, row) => {
    const { sql, statements, stored } = fakeSql(row);

    expect(
      await teardownSession(sql, {
        organizationId: 'org-a',
        sessionId: 'session-a',
      }),
    ).toBe(false);

    expect(statements).toHaveLength(1);
    expect(statements[0]?.text).toContain(
      'WHERE session_id = ? AND org_id = ?',
    );
    expect(statements[0]?.values.slice(-2)).toEqual(['session-a', 'org-a']);
    expect(sessionDestroy).not.toHaveBeenCalled();
    expect(revokeSessionGatewayKeys).not.toHaveBeenCalled();
    expect(wakeParkedAgentRuns).not.toHaveBeenCalled();
    expect(stored?.status).toBe(row?.status);
  });

  it.each([true, false])(
    'settles an owned session after confirmed deletion or absence (%s)',
    async (destroyed) => {
      const { sql, statements, stored } = fakeSql(OWNED_SESSION);
      let stateAtDestroy: unknown;
      vi.mocked(sessionDestroy).mockImplementationOnce(async () => {
        stateAtDestroy = {
          statements: statements.length,
          status: stored?.status,
          revocations: vi.mocked(revokeSessionGatewayKeys).mock.calls.length,
        };
        return destroyed;
      });
      const args = { organizationId: 'org-a', sessionId: 'session-a' };

      await expect(teardownSession(sql, args)).resolves.toBe(true);

      expect(sessionDestroy).toHaveBeenCalledExactlyOnceWith('session-a');
      expect(stateAtDestroy).toEqual({
        statements: 1,
        status: 'active',
        revocations: 0,
      });
      expect(stored?.status).toBe('destroyed');
      expect(revokeSessionGatewayKeys).toHaveBeenCalledExactlyOnceWith(
        sql,
        args,
      );
      expect(wakeParkedAgentRuns).toHaveBeenCalledExactlyOnceWith(sql, 'org-a');
    },
  );

  it('leaves an owned session retryable when the spawner cannot confirm deletion', async () => {
    const { sql, statements, stored } = fakeSql(OWNED_SESSION);
    const failure = new Error('sandbox session destroy failed (503)');
    vi.mocked(sessionDestroy).mockRejectedValueOnce(failure);

    await expect(
      teardownSession(sql, {
        organizationId: 'org-a',
        sessionId: 'session-a',
      }),
    ).rejects.toBe(failure);

    expect(statements).toHaveLength(1);
    expect(stored?.status).toBe('active');
    expect(revokeSessionGatewayKeys).not.toHaveBeenCalled();
    expect(wakeParkedAgentRuns).not.toHaveBeenCalled();
  });
});
