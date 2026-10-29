import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import {
  observeWakeManagerAdmission,
  readWakeAdmissionFailure,
} from './standing-role-wake-admission.ts';

const FAILED_RUN = 'fixture-failed-occurrence';
const FAILURE = {
  failureCode: 'node_error',
  stepRecorded: true,
  stepFailed: true,
  stepFailureCode: 'node_error',
  stepFailureReason: 'TASK_PROJECT_NOT_BOUND',
  stepErrorName: null,
  stepErrorCode: null,
} as const;

function lane(
  options: {
    polls?: number;
    failureAt?: number;
    runs?: Array<{ id: string }>;
    previousRuns?: Array<{ id: string }>;
    occurrence?: { status: string; output: unknown } | null;
  } = {},
) {
  let poll = -1;
  const scan = vi.fn(async () => {
    poll += 1;
    return { examined: 7, fired: 0, waiting: 7, busy: 0, failed: 0 };
  });
  const managerRuns = vi.fn(async () =>
    poll < 0 ? (options.previousRuns ?? []) : (options.runs ?? []),
  );
  const waitFor = vi.fn(async (ready: () => Promise<boolean>, ms: number) => {
    expect(ms).toBe(30_000);
    for (let n = 0; n < (options.polls ?? 100); n += 1)
      if (await ready()) return true;
    return false;
  });
  const wake = vi.fn(async () => ({
    firedRunId: poll === (options.failureAt ?? 8) ? FAILED_RUN : null,
    signalSeq: 1,
    consumedSeq: 0,
    attempts: 1,
    notBefore: 60_000,
    outcome: 'not_admitted',
    poll,
  }));
  const occurrence = vi.fn(async (runId: string | null) =>
    options.occurrence !== undefined
      ? options.occurrence
      : runId === FAILED_RUN
        ? { status: 'failed', output: null }
        : null,
  );
  return {
    expectedCount: 1,
    timeoutMs: 30_000,
    backdate: vi.fn(async () => {}),
    managerRuns,
    scan,
    wake,
    occurrence,
    readFailure: vi.fn(
      async (
        _runId: string,
      ): Promise<Awaited<ReturnType<typeof readWakeAdmissionFailure>>> =>
        FAILURE,
    ),
    waitFor,
  };
}

async function refused(args: ReturnType<typeof lane>) {
  try {
    await observeWakeManagerAdmission(args);
    throw new Error('fixture unexpectedly admitted');
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(
      message.startsWith('itest: W18 manager admission not observed: '),
    ).toBe(true);
    return JSON.parse(message.slice(message.indexOf(': ', 7) + 2));
  }
}

describe('W18 manager admission evidence [AUTO-R33]', () => {
  it('keeps the initial scan, latest scans and first failed occurrence outside both windows', async () => {
    const args = lane();
    const trace = await refused(args);
    expect(
      trace.first.map(
        (sample: { state: { poll: number } }) => sample.state.poll,
      ),
    ).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(
      trace.last.map(
        (sample: { state: { poll: number } }) => sample.state.poll,
      ),
    ).toEqual([92, 93, 94, 95, 96, 97, 98, 99]);
    expect(trace.firstFailedOccurrence).toEqual({
      expectedCount: 1,
      runId: FAILED_RUN,
      sample: {
        expectedCount: 1,
        result: { examined: 7, fired: 0, waiting: 7, busy: 0, failed: 0 },
        state: expect.objectContaining({ poll: 8 }),
        runs: 0,
        occurrence: 'failed',
      },
      failure: FAILURE,
    });
    expect(args.readFailure).toHaveBeenCalledExactlyOnceWith(FAILED_RUN);
    expect(args.backdate).toHaveBeenCalledTimes(1);
    expect(args.waitFor).toHaveBeenCalledTimes(1);
  });

  it('keeps only the relevant first failure and remains bounded across many polls', async () => {
    const args = lane({ polls: 10_000, failureAt: 8 });
    const readWake = args.wake.getMockImplementation();
    if (readWake === undefined) throw new Error('fixture wake missing');
    args.wake.mockImplementation(async () => {
      const state = await readWake();
      return state.poll > 8
        ? { ...state, firedRunId: 'later-failed-occurrence' }
        : state;
    });
    args.occurrence.mockImplementation(async (runId: string | null) =>
      runId === null ? null : { status: 'failed', output: null },
    );
    const trace = await refused(args);
    expect(trace.first).toHaveLength(8);
    expect(trace.last).toHaveLength(8);
    expect(trace.firstFailedOccurrence.runId).toBe(FAILED_RUN);
    expect(args.readFailure).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(trace).length).toBeLessThan(8_000);
  });

  it('reports absence honestly when no failed occurrence was observed', async () => {
    const args = lane({ failureAt: -1, polls: 4 });
    const trace = await refused(args);
    expect(trace.firstFailedOccurrence).toBeNull();
    expect(trace.first).toHaveLength(4);
    expect(trace.last).toHaveLength(4);
    expect(args.readFailure).not.toHaveBeenCalled();
  });

  it('returns only a new manager matching the successful occurrence receipt', async () => {
    const manager = { id: 'manager' };
    const args = lane({
      runs: [manager],
      occurrence: { status: 'success', output: { runId: manager.id } },
    });
    await expect(observeWakeManagerAdmission(args)).resolves.toBe(manager);
    expect(args.readFailure).not.toHaveBeenCalled();
  });

  it('keeps successful admission scans across starts for the later circuit assertion', async () => {
    const trace: { first: unknown[]; last: unknown[] } = {
      first: [],
      last: [],
    };
    for (let expectedCount = 1; expectedCount <= 3; expectedCount += 1) {
      const previousRuns = Array.from(
        { length: expectedCount - 1 },
        (_, n) => ({ id: 'manager-' + n }),
      );
      const manager = { id: 'manager-' + (expectedCount - 1) };
      await expect(
        observeWakeManagerAdmission({
          ...lane({
            previousRuns,
            runs: [...previousRuns, manager],
            occurrence: { status: 'success', output: { runId: manager.id } },
          }),
          expectedCount,
          trace,
        }),
      ).resolves.toBe(manager);
    }
    expect(trace.first).toEqual(
      [1, 2, 3].map((expectedCount) =>
        expect.objectContaining({
          expectedCount,
          runs: expectedCount,
          occurrence: 'success',
        }),
      ),
    );
    expect(trace.last).toEqual(trace.first);
  });

  it.each([
    [
      'a previously existing manager',
      {
        runs: [{ id: 'manager' }],
        previousRuns: [{ id: 'manager' }],
        occurrence: { status: 'success', output: { runId: 'manager' } },
      },
    ],
    [
      'the wrong receipt',
      {
        runs: [{ id: 'manager' }],
        occurrence: { status: 'success', output: { runId: 'other' } },
      },
    ],
    [
      'a failed occurrence even with a matching output',
      {
        runs: [{ id: 'manager' }],
        occurrence: { status: 'failed', output: { runId: 'manager' } },
      },
    ],
    [
      'the wrong number of managers',
      {
        runs: [{ id: 'manager' }, { id: 'other' }],
        occurrence: { status: 'success', output: { runId: 'manager' } },
      },
    ],
  ])('still refuses %s', async (_case, options) => {
    await expect(
      observeWakeManagerAdmission(lane({ ...options, polls: 1 })),
    ).rejects.toThrow('W18 manager admission not observed');
  });
});

describe('W18 stored failure boundary [AUTO-R33]', () => {
  function database(row: unknown) {
    const query = vi.fn(async () => (row === undefined ? [] : [row]));
    return { sql: query as unknown as Sql, query };
  }

  it('reads the owned failed occurrence and only its fixed start-agent node scalars', async () => {
    const { sql, query } = database({
      failureCode: 'node_error',
      stepStatus: 'failed',
      stepFailureCode: 'node_error',
      stepFailureReason: 'TASK_PROJECT_NOT_BOUND',
      stepErrorName: null,
      stepErrorCode: null,
    });
    await expect(
      readWakeAdmissionFailure(sql, 'fixture-org', FAILED_RUN),
    ).resolves.toEqual(FAILURE);
    const [strings, ...values] = query.mock.calls[0] as unknown as [
      TemplateStringsArray,
      ...unknown[],
    ];
    expect(values).toEqual(['fixture-org', FAILED_RUN]);
    const text = strings.join('?');
    expect(text).toContain('n.org_id = r.org_id AND n.run_id = r.id');
    expect(text).toContain(
      "n.node_id = 'start' AND n.node_type = 'task.start_agent'",
    );
    expect(text).toContain(
      "n.path = 'start' AND n.item_index = -1 AND n.pass = -1",
    );
    expect(text).toContain("AND r.status = 'failed'");
    expect(text).toContain('LIMIT 1');
    expect(text).toContain(
      `n.record #>> '{failure,params,errorName}' AS "stepErrorName"`,
    );
    expect(text).toContain(
      `n.record #>> '{failure,params,errorCode}' AS "stepErrorCode"`,
    );
    expect(text).not.toMatch(/\b(detail|trace|input|output)\b/);
    expect(text).not.toContain('n.record,');
  });

  it.each([
    ['a transaction that lost to another one', 'PostgresError', '40001'],
    ['a write the database refused', 'PostgresError', '23505'],
    ['a refusal of the task domain', 'TaskError', 'AGENT_START_FORBIDDEN'],
    ['the connector door itself', 'ConnectorError', 'INTERRUPTED'],
    ['a defect', 'TypeError', null],
  ])(
    'reports the class of %s that the start step threw',
    async (_case, name, code) => {
      const { sql } = database({
        failureCode: 'connector_error',
        stepStatus: 'failed',
        stepFailureCode: 'connector_error',
        stepFailureReason: 'CONNECTOR_FAILED',
        stepErrorName: name,
        stepErrorCode: code,
      });
      await expect(
        readWakeAdmissionFailure(sql, 'fixture-org', FAILED_RUN),
      ).resolves.toEqual({
        failureCode: 'connector_error',
        stepRecorded: true,
        stepFailed: true,
        stepFailureCode: 'connector_error',
        stepFailureReason: 'CONNECTOR_FAILED',
        stepErrorName: name,
        stepErrorCode: code,
      });
    },
  );

  it('never logs unknown codes, service text, tokens, trace, values or failure params', async () => {
    const privateText =
      'Bearer fixture-private-token https://private.example.invalid/' +
      'x'.repeat(100_000);
    const { sql } = database({
      failureCode: privateText,
      stepStatus: privateText,
      stepFailureCode: privateText,
      stepFailureReason: privateText,
      stepErrorName: privateText,
      stepErrorCode: privateText,
      detail: privateText,
      output: { token: privateText },
      trace: [{ error: privateText }],
      params: { detail: privateText },
    });
    const args = lane();
    args.readFailure = vi.fn(async (runId: string) =>
      readWakeAdmissionFailure(sql, 'fixture-org', runId),
    );
    const trace = await refused(args);
    expect(trace.firstFailedOccurrence.failure).toEqual({
      failureCode: null,
      stepRecorded: false,
      stepFailed: false,
      stepFailureCode: null,
      stepFailureReason: null,
      stepErrorName: null,
      stepErrorCode: null,
    });
    expect(JSON.stringify(trace)).not.toContain('fixture-private-token');
    expect(JSON.stringify(trace)).not.toContain('private.example.invalid');
    expect(JSON.stringify(trace).length).toBeLessThan(8_000);
  });

  it('does not infer missing node or run failure records', async () => {
    const { sql } = database({
      failureCode: 'node_error',
      stepStatus: null,
      stepFailureCode: null,
      stepFailureReason: null,
    });
    await expect(
      readWakeAdmissionFailure(sql, 'fixture-org', FAILED_RUN),
    ).resolves.toEqual({
      failureCode: 'node_error',
      stepRecorded: false,
      stepFailed: false,
      stepFailureCode: null,
      stepFailureReason: null,
      stepErrorName: null,
      stepErrorCode: null,
    });
    await expect(
      readWakeAdmissionFailure(
        database(undefined).sql,
        'fixture-org',
        FAILED_RUN,
      ),
    ).resolves.toBeNull();
  });

  it('propagates a failed diagnostic read rather than inventing a stored cause', async () => {
    const error = new Error('fixture SQL refusal');
    const query = vi.fn(async () => {
      throw error;
    });
    await expect(
      readWakeAdmissionFailure(
        query as unknown as Sql,
        'fixture-org',
        FAILED_RUN,
      ),
    ).rejects.toBe(error);
  });
});
