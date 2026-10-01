import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addJobInTx } from '../../jobs/enqueue.ts';
import { ProjectError } from '../projects/service.ts';
import { standardAgentServingForKick } from '../projects/standard-agent.ts';
import { kickAgentRun } from './agent-runs.ts';

vi.mock('../../lib/org-config.ts', () => ({
  readGovernancePolicyForOrg: vi.fn().mockResolvedValue(null),
}));
vi.mock('./run-ledger.ts', () => ({ recordTaskAgentRunLedgerEntry: vi.fn() }));
vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));
vi.mock('./run-failure-notice.ts', () => ({
  announceAgentRunFailed: vi.fn(),
  withdrawAgentRunFailedNotices: vi.fn(),
}));
vi.mock('../sandbox/gateway-keys.ts', () => ({
  revokeSessionGatewayKeys: vi.fn(async () => {}),
}));
vi.mock('../projects/standard-agent.ts', () => ({
  STANDARD_AGENT_REFUSAL_CODES: new Set([
    'STANDARD_AGENT_OFF',
    'STANDARD_AGENT_UNAVAILABLE',
  ]),
  standardAgentServingForKick: vi.fn(),
}));

type Row = Record<string, unknown>;

/** A postgres.js tagged-template stand-in answering each statement from its
 * (whitespace-collapsed) text. */
function fakeTx(answer: (text: string) => Row[]) {
  const calls: { text: string; values: unknown[] }[] = [];
  const tag = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<Row[]> => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    calls.push({ text, values });
    return Promise.resolve(answer(text));
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a one-member stand-in for the postgres.js template function
  return { tx: tag as unknown as TransactionSql, calls };
}

const KICK = {
  organizationId: 'org-1',
  projectId: 'p-1',
  taskId: 'task-1',
  agentId: 'agent-standard',
  harness: 'codex',
  model: 'stale-model',
  modelProvider: 'openai',
  startedBy: 'member-1',
};

beforeEach(() => {
  vi.mocked(addJobInTx).mockReset();
  vi.mocked(standardAgentServingForKick).mockReset();
});

describe('kickAgentRun — the standard agent runs what its policy says at the start', () => {
  it('writes the serving the kick view answers onto the run, not what the caller read', async () => {
    vi.mocked(standardAgentServingForKick).mockResolvedValue({
      harness: 'claude-code',
      model: 'claude-sonnet-5',
      modelProvider: 'anthropic',
    });
    const { tx, calls } = fakeTx((text) =>
      text.startsWith('INSERT INTO app.project_agent_runs')
        ? [{ id: 'run-new' }]
        : [],
    );

    await expect(kickAgentRun(tx, KICK)).resolves.toMatchObject({
      runId: 'run-new',
      reused: false,
    });
    expect(standardAgentServingForKick).toHaveBeenCalledWith(tx, {
      organizationId: 'org-1',
      agentId: 'agent-standard',
      startedBy: 'member-1',
      harness: 'codex',
      model: 'stale-model',
      modelProvider: 'openai',
    });
    const insert = calls.find((call) =>
      call.text.startsWith('INSERT INTO app.project_agent_runs'),
    );
    expect(insert?.values).toEqual(
      expect.arrayContaining(['claude-code', 'claude-sonnet-5', 'anthropic']),
    );
    expect(insert?.values).not.toContain('stale-model');
  });

  it.each([
    ['STANDARD_AGENT_OFF', 403],
    ['STANDARD_AGENT_UNAVAILABLE', 409],
  ] as const)(
    'answers %s as the task door’s own refusal, and queues nothing',
    async (code, status) => {
      vi.mocked(standardAgentServingForKick).mockRejectedValue(
        new ProjectError(code, 'The standard agent cannot run', status, {
          reason: 'no-model',
        }),
      );
      const { tx, calls } = fakeTx(() => []);

      await expect(kickAgentRun(tx, KICK)).rejects.toMatchObject({
        name: 'TaskError',
        code,
        status,
        data: { reason: 'no-model' },
      });
      expect(calls.some((call) => call.text.startsWith('INSERT'))).toBe(false);
      expect(addJobInTx).not.toHaveBeenCalled();
    },
  );
});
