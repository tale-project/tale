// @vitest-environment node

/**
 * The live-op read the stepper adopts a crashed kick's turn through
 * (`loadLiveAgentOpForRun`): the turn in flight runs on the harness its kick
 * stamped on its op, for the reason the kick recorded there — not the
 * harness a step on the default would resolve to now — so the adopted
 * cursor's settle, retry and answered-question resume follow both. An op
 * written before ops recorded them answers neither.
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { automationShimHandlers } from './shim.ts';

function fakeSql(row: Record<string, unknown> | null): {
  sql: Sql;
  texts: string[];
} {
  const texts: string[] = [];
  const fn = (strings: TemplateStringsArray): Promise<unknown[]> => {
    texts.push(strings.join('?'));
    return Promise.resolve(row === null ? [] : [row]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  return { sql: fn as unknown as Sql, texts };
}

async function liveOp(row: Record<string, unknown> | null): Promise<unknown> {
  const handler = automationShimHandlers(fakeSql(row).sql)[
    'automations/queries:loadLiveAgentOpForRun'
  ];
  if (handler === undefined)
    throw new Error('loadLiveAgentOpForRun is not wired');
  return handler({ organizationId: 'org-1', runId: 'run-1' });
}

const OP = {
  execId: 'exec-live',
  sessionId: 'wf-run-1',
  modelRef: 'anthropic/claude-sonnet-4-6',
  deadlineMs: 1_800_000_000_000,
};

describe('loadLiveAgentOpForRun', () => {
  it('answers the harness the turn runs on and why, as its kick stamped them', async () => {
    await expect(
      liveOp({
        ...OP,
        harness: 'claude-code',
        harnessReason: 'subscription_bound',
      }),
    ).resolves.toEqual({
      execId: 'exec-live',
      sessionId: 'wf-run-1',
      deadlineAt: 1_800_000_000_000,
      providerSlug: 'anthropic',
      gatewayModel: 'claude-sonnet-4-6',
      harness: 'claude-code',
      harnessReason: 'subscription_bound',
    });
  });

  it('answers neither for an op written before ops recorded them', async () => {
    const op = await liveOp({ ...OP, harness: null, harnessReason: null });
    expect(op).toMatchObject({ execId: 'exec-live' });
    expect(op).not.toHaveProperty('harness');
    expect(op).not.toHaveProperty('harnessReason');
  });

  it('answers null when no turn is in flight', async () => {
    await expect(liveOp(null)).resolves.toBeNull();
  });

  it('reads the columns it answers from', async () => {
    const fake = fakeSql(null);
    await automationShimHandlers(fake.sql)[
      'automations/queries:loadLiveAgentOpForRun'
    ]?.({ organizationId: 'org-1', runId: 'run-1' });
    expect(fake.texts[0]).toMatch(/\bharness\b/);
    expect(fake.texts[0]).toContain('harness_reason AS "harnessReason"');
  });
});
