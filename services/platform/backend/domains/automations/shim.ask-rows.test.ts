// @vitest-environment node

/**
 * Unit lock for the ask reads' PROJECTION (ask-park class): the agent host
 * narrows every ask row through `readAskRow`, which returns null unless
 * `_id`, `runId`, `nodeId`, `execId`, `question`, `expiresAt` and `status`
 * are all present. Regression: `getPendingAskForExec` selected only
 * id/node_id/question/expires_at/task_id, so the host read every pending ask
 * as "no ask" — a turn that asked and ended cleanly settled as a completed
 * node instead of parking, the answer route found nothing to resume, and the
 * expiry walk never fired. Both reads now share one column list.
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { automationShimHandlers } from './shim.ts';

/** The keys `readAskRow` (core/automations/agent_host.ts) requires. */
const REQUIRED_ASK_KEYS = [
  '_id',
  'runId',
  'nodeId',
  'execId',
  'question',
  'expiresAt',
  'status',
] as const;

interface Statement {
  text: string;
  values: unknown[];
}

function fakeSql(row: Record<string, unknown> | null): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const fn = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    statements.push({ text: strings.join('?'), values });
    return Promise.resolve(row === null ? [] : [row]);
  };
  fn.unsafe = (text: string): { raw: string } => ({ raw: text });
  return { sql: fn as unknown as Sql, statements };
}

const stored = {
  _id: 'ask_1',
  runId: 'run_1',
  nodeId: 'ask',
  execId: 'exec_1',
  question: 'Which region?',
  expiresAt: 1_700_000_000_000,
  status: 'pending',
  agentSessionId: null,
  answer: null,
  taskId: null,
};

describe('the ask reads the agent host consumes', () => {
  it('getPendingAskForExec returns every key readAskRow requires', async () => {
    const fake = fakeSql(stored);
    const result = await automationShimHandlers(fake.sql)[
      'automations/human_asks:getPendingAskForExec'
    ]?.({ sessionId: 'sess_1', execId: 'exec_1' });

    expect(result).toEqual({
      _id: 'ask_1',
      runId: 'run_1',
      nodeId: 'ask',
      execId: 'exec_1',
      question: 'Which region?',
      expiresAt: 1_700_000_000_000,
      status: 'pending',
    });
    for (const key of REQUIRED_ASK_KEYS) {
      expect(result).toHaveProperty(key);
    }
    // The pending predicate stays: only an open question parks a turn.
    expect(fake.statements[0]?.text).toContain("status = 'pending'");
  });

  it('both reads project the same columns, so they cannot drift apart', async () => {
    const pending = fakeSql(stored);
    const resume = fakeSql({
      ...stored,
      agentSessionId: 'agent-sess',
      answer: 'EU',
    });
    const handlers = automationShimHandlers(pending.sql);
    await handlers['automations/human_asks:getPendingAskForExec']?.({
      sessionId: 'sess_1',
      execId: 'exec_1',
    });
    const resumed = await automationShimHandlers(resume.sql)[
      'automations/human_asks:getAskForResume'
    ]?.({ askId: 'ask_1', organizationId: 'org_1' });

    const columnsOf = (statement: Statement | undefined): unknown =>
      statement?.values.find(
        (value) =>
          typeof value === 'object' && value !== null && 'raw' in value,
      );
    const pendingColumns = columnsOf(pending.statements[0]);
    expect(pendingColumns).toBeDefined();
    expect(columnsOf(resume.statements[0])).toEqual(pendingColumns);
    const raw = (pendingColumns as { raw: string }).raw;
    for (const key of REQUIRED_ASK_KEYS) {
      // Aliased columns are quoted; `question` and `status` are bare.
      expect(raw).toMatch(new RegExp(`"${key}"|\\b${key}\\b`));
    }
    // Optional fields ride along when present and are omitted (never null)
    // when absent — the host's `AskRow` shape.
    expect(resumed).toMatchObject({
      agentSessionId: 'agent-sess',
      answer: 'EU',
    });
    expect(resumed).not.toHaveProperty('taskId');
  });

  it('recordAskParked keys the park on the ask id the host holds', async () => {
    // The host passes `{ askId, agentSessionId? }` (agent_host.ts, the
    // clean-end-with-a-question branch). The handler used to read
    // `sessionId`/`execId` — both undefined — and postgres.js refuses an
    // undefined parameter, so the first real park threw.
    const withHandle = fakeSql(null);
    await automationShimHandlers(withHandle.sql)[
      'automations/human_asks:recordAskParked'
    ]?.({ askId: 'ask_1', agentSessionId: 'agent-sess' });
    const parked = withHandle.statements[0];
    expect(parked?.text).toMatch(/WHERE id = \?/);
    expect(parked?.text).toContain("status = 'pending'");
    expect(parked?.values).toEqual(['agent-sess', 'ask_1']);

    // Without a handle the row keeps whatever it had (coalesce), and no
    // parameter is ever `undefined`.
    const noHandle = fakeSql(null);
    await automationShimHandlers(noHandle.sql)[
      'automations/human_asks:recordAskParked'
    ]?.({ askId: 'ask_1' });
    expect(noHandle.statements[0]?.values).toEqual([null, 'ask_1']);
    expect(noHandle.statements[0]?.text).toContain('coalesce(');
  });

  it('answers null for no pending ask', async () => {
    const fake = fakeSql(null);
    await expect(
      automationShimHandlers(fake.sql)[
        'automations/human_asks:getPendingAskForExec'
      ]?.({ sessionId: 'sess_1', execId: 'exec_1' }),
    ).resolves.toBeNull();
  });
});
