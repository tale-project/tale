import { describe, expect, it } from 'vitest';

import {
  evaluateGuardrails,
  type GuardContext,
  type GuardFacts,
} from './guard_core';

const baseFacts: GuardFacts = {
  monthSpentCents: 0,
  agentRunning: 0,
  orgRunning: 0,
  orgCap: 25,
  taskCircuitCap: 10,
};

const TASK_CONTEXTS: GuardContext[] = [
  'task_run',
  'external_enqueue',
  'external_claim',
];
const INTERACTIVE_CONTEXTS: GuardContext[] = ['chat_turn', 'delegation'];
const ALL_CONTEXTS: GuardContext[] = [
  ...TASK_CONTEXTS,
  ...INTERACTIVE_CONTEXTS,
];

describe('evaluateGuardrails — budget', () => {
  it('reports budgetState none without a configured budget', () => {
    const verdict = evaluateGuardrails('task_run', baseFacts);
    expect(verdict.allowed).toBe(true);
    expect(verdict.budgetState).toBe('none');
    expect(verdict.budgetPct).toBeUndefined();
  });

  it.each(ALL_CONTEXTS)('pauses in every context (%s)', (context) => {
    const verdict = evaluateGuardrails(context, {
      ...baseFacts,
      monthSpentCents: 1000,
      budget: { monthlyCents: 1000 },
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('budget_paused');
    expect(verdict.budgetState).toBe('paused');
    expect(verdict.budgetPct).toBe(100);
  });

  it('warns at the default 80% with an economy instruction', () => {
    const verdict = evaluateGuardrails('chat_turn', {
      ...baseFacts,
      monthSpentCents: 800,
      budget: { monthlyCents: 1000 },
    });
    expect(verdict.allowed).toBe(true);
    expect(verdict.budgetState).toBe('warn');
    expect(verdict.warningInstruction).toContain('80%');
  });

  it('respects custom warn/pause thresholds', () => {
    const budget = { monthlyCents: 1000, warnPct: 50, pausePct: 150 };
    expect(
      evaluateGuardrails('task_run', {
        ...baseFacts,
        monthSpentCents: 499,
        budget,
      }).budgetState,
    ).toBe('ok');
    expect(
      evaluateGuardrails('task_run', {
        ...baseFacts,
        monthSpentCents: 500,
        budget,
      }).budgetState,
    ).toBe('warn');
    const overHundred = evaluateGuardrails('task_run', {
      ...baseFacts,
      monthSpentCents: 1400,
      budget,
    });
    expect(overHundred.allowed).toBe(true);
    expect(overHundred.budgetState).toBe('warn');
    expect(
      evaluateGuardrails('task_run', {
        ...baseFacts,
        monthSpentCents: 1500,
        budget,
      }).reason,
    ).toBe('budget_paused');
  });
});

describe('evaluateGuardrails — circuit breaker', () => {
  it('refuses task_run and external_enqueue on a paused task', () => {
    for (const context of ['task_run', 'external_enqueue'] as const) {
      const verdict = evaluateGuardrails(context, {
        ...baseFacts,
        taskPausedAt: 123,
      });
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toBe('task_circuit_breaker');
    }
  });

  it('refuses when the rolling window is exhausted', () => {
    const verdict = evaluateGuardrails('task_run', {
      ...baseFacts,
      taskRunsLastHour: 10,
    });
    expect(verdict.reason).toBe('task_circuit_breaker');
  });

  it('allows under the window cap', () => {
    const verdict = evaluateGuardrails('task_run', {
      ...baseFacts,
      taskRunsLastHour: 9,
    });
    expect(verdict.allowed).toBe(true);
  });

  it('does not apply to claim/chat/delegation contexts', () => {
    for (const context of [
      'external_claim',
      'chat_turn',
      'delegation',
    ] as const) {
      const verdict = evaluateGuardrails(context, {
        ...baseFacts,
        taskPausedAt: 123,
        taskRunsLastHour: 99,
      });
      expect(verdict.allowed).toBe(true);
    }
  });
});

describe('evaluateGuardrails — concurrency', () => {
  it.each(TASK_CONTEXTS)('caps the agent in task contexts (%s)', (context) => {
    const verdict = evaluateGuardrails(context, {
      ...baseFacts,
      agentRunning: 3,
      agentCap: 3,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('agent_concurrency');
    expect(verdict.queueDepth).toBe(3);
  });

  it.each(TASK_CONTEXTS)('caps the org in task contexts (%s)', (context) => {
    const verdict = evaluateGuardrails(context, {
      ...baseFacts,
      orgRunning: 25,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('org_concurrency');
  });

  it.each(INTERACTIVE_CONTEXTS)(
    'never caps interactive contexts (%s)',
    (context) => {
      const verdict = evaluateGuardrails(context, {
        ...baseFacts,
        agentRunning: 99,
        agentCap: 1,
        orgRunning: 999,
      });
      expect(verdict.allowed).toBe(true);
    },
  );

  it('treats a missing agent cap as unlimited', () => {
    const verdict = evaluateGuardrails('task_run', {
      ...baseFacts,
      agentRunning: 500,
    });
    expect(verdict.allowed).toBe(true);
  });
});

describe('evaluateGuardrails — precedence', () => {
  const violatesEverything: GuardFacts = {
    monthSpentCents: 2000,
    budget: { monthlyCents: 1000 },
    agentRunning: 5,
    agentCap: 1,
    orgRunning: 100,
    orgCap: 25,
    taskRunsLastHour: 50,
    taskCircuitCap: 10,
    taskPausedAt: 1,
  };

  it('budget_paused wins over everything', () => {
    expect(evaluateGuardrails('task_run', violatesEverything).reason).toBe(
      'budget_paused',
    );
  });

  it('circuit breaker wins over concurrency', () => {
    expect(
      evaluateGuardrails('task_run', {
        ...violatesEverything,
        budget: undefined,
      }).reason,
    ).toBe('task_circuit_breaker');
  });

  it('agent concurrency wins over org concurrency', () => {
    expect(
      evaluateGuardrails('task_run', {
        ...violatesEverything,
        budget: undefined,
        taskPausedAt: undefined,
        taskRunsLastHour: 0,
      }).reason,
    ).toBe('agent_concurrency');
  });
});
