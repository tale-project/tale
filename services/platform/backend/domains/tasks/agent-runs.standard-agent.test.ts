import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addJobInTx } from '../../jobs/enqueue.ts';
import { ProjectError } from '../projects/service.ts';
import { standardAgentServingForKick } from '../projects/standard-agent.ts';
import { isStandardAgentRefusal, kickAgentRun } from './agent-runs.ts';
import { TaskError } from './errors.ts';

vi.mock('./dispatch-reach.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./dispatch-reach.ts')>()),
  // Every agent here works its own project's board.
  agentReachesProject: vi.fn().mockResolvedValue(true),
}));
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
  return {
    tx: Object.assign(tag, {
      json: (value: unknown) => value,
    }) as unknown as TransactionSql,
    calls,
  };
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
      engine: 'harness',
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

describe('kickAgentRun — which engine a run starts on [TASK-R30]', () => {
  const serving = (engine: 'native' | 'harness') => ({
    harness: 'claude-code',
    model: 'claude-sonnet-5',
    modelProvider: 'anthropic',
    engine,
  });

  it.each([
    [
      'a person started a run the serving puts on the native engine',
      'native',
      {},
      'native',
      'task.agent_native',
    ],
    [
      'an API key started it',
      'native',
      { startedBy: 'api-key:member-1' },
      'native',
      'task.agent_native',
    ],
    [
      'the serving names the harness: a pinned runtime, a subscription model',
      'harness',
      {},
      'harness',
      'task.agent_turn',
    ],
    [
      'a schedule started it: no person to act as',
      'native',
      { startedBy: 'trigger:t-1' },
      'harness',
      'task.agent_turn',
    ],
    [
      'an automation put the agent to work',
      'native',
      {
        startedVia: {
          kind: 'automation',
          runId: 'ar-1',
          nodeId: 'n-1',
          automation: 'Triage',
        },
      },
      'harness',
      'task.agent_turn',
    ],
    [
      'another agent delegated it',
      'native',
      { startedVia: { kind: 'agent', runId: 'r-0', agentId: 'agent-2' } },
      'harness',
      'task.agent_turn',
    ],
    [
      'the retry of a run that already handed its work over',
      'native',
      { handoff: { reason: 'needs a repository', brief: 'Clone and test.' } },
      'harness',
      'task.agent_turn',
    ],
  ] as const)(
    'when %s, the run is %s → %s and queues %s',
    async (_label, served, extra, engine, job) => {
      vi.mocked(standardAgentServingForKick).mockResolvedValue(serving(served));
      const { tx, calls } = fakeTx((text) =>
        text.startsWith('INSERT INTO app.project_agent_runs')
          ? [{ id: 'run-new' }]
          : [],
      );

      await kickAgentRun(tx, { ...KICK, ...extra });

      const insert = calls.find((call) =>
        call.text.startsWith('INSERT INTO app.project_agent_runs'),
      );
      // The column's value rides after the harness in the insert's values.
      const values = insert?.values ?? [];
      expect(values[values.indexOf('claude-code') + 1]).toBe(engine);
      expect(addJobInTx).toHaveBeenCalledWith(
        tx,
        job,
        expect.objectContaining({ runId: 'run-new' }),
        {},
      );
    },
  );
});

describe('kickAgentRun — a retry carries the brief of the hand-over [TASK-R31]', () => {
  it('writes the handoff on the retried run, so the harness reads the same brief', async () => {
    vi.mocked(standardAgentServingForKick).mockResolvedValue({
      harness: 'claude-code',
      model: 'm',
      modelProvider: 'p',
      engine: 'native',
    });
    const { tx, calls } = fakeTx((text) =>
      text.startsWith('INSERT INTO app.project_agent_runs')
        ? [{ id: 'run-new' }]
        : [],
    );
    const handoff = { reason: 'needs a repository', brief: 'Clone and test.' };

    await kickAgentRun(tx, { ...KICK, trigger: 'auto_retry', handoff });

    const insert = calls.find((call) =>
      call.text.startsWith('INSERT INTO app.project_agent_runs'),
    );
    expect(insert?.text).toContain('handoff');
    expect(insert?.values).toContainEqual(handoff);
  });
});

describe('isStandardAgentRefusal', () => {
  it('names the two standard agent refusals of the task door, and nothing else', () => {
    expect(
      isStandardAgentRefusal(new TaskError('STANDARD_AGENT_OFF', 'off', 403)),
    ).toBe(true);
    expect(
      isStandardAgentRefusal(
        new TaskError('STANDARD_AGENT_UNAVAILABLE', 'no model', 409),
      ),
    ).toBe(true);
    expect(
      isStandardAgentRefusal(
        new TaskError('TASK_AUTOMATION_DISABLED', 'off', 403),
      ),
    ).toBe(false);
    // The project door's own error is answered by the kick, not here.
    expect(
      isStandardAgentRefusal(
        new ProjectError('STANDARD_AGENT_OFF', 'off', 403),
      ),
    ).toBe(false);
    expect(isStandardAgentRefusal(new Error('boom'))).toBe(false);
  });
});
