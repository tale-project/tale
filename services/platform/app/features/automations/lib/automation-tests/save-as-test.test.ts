import { describe, expect, it } from 'vitest';

import { runForTestOfDetail, runForTestOfTry } from './save-as-test';

describe('a run as the test builder reads it', () => {
  it('reads a stored run that failed: its steps, and where it failed', () => {
    const run = runForTestOfDetail({
      mode: 'live',
      status: 'failed',
      input: { owner: 'acme' },
      trace: [
        {
          node: 'fetch',
          type: 'github.list_issues',
          status: 'ok',
          output: { issues: [] },
        },
        {
          node: 'triage',
          type: 'llm',
          status: 'error',
          error: 'model refused',
        },
      ],
      effects: [{ node: 'fetch', connector: 'github', input: {} }],
      startedAt: 1_000,
    });
    expect(run).toMatchObject({
      mode: 'live',
      status: 'failed',
      input: { owner: 'acme' },
      error: { nodeId: 'triage', message: 'model refused' },
      startedAt: 1_000,
    });
    expect(run.trace?.map((entry) => entry.node)).toEqual(['fetch', 'triage']);
    expect(run.effects).toHaveLength(1);
    expect(run).not.toHaveProperty('output');
  });

  it('reads a stored run that succeeded with its output and no failure', () => {
    const run = runForTestOfDetail({
      mode: 'mock',
      status: 'success',
      input: {},
      output: { total: 60 },
      trace: [{ node: 'total', type: 'transform', status: 'ok' }],
      startedAt: 2_000,
    });
    expect(run.output).toEqual({ total: 60 });
    expect(run).not.toHaveProperty('error');
  });

  it('reads a try of the draft as a mock run made in one call', () => {
    const run = runForTestOfTry({
      kind: 'try',
      run: {
        status: 'error',
        error: { nodeId: 'total', message: 'no price' },
        trace: [{ node: 'total', type: 'transform', status: 'error' }],
        effects: [],
        ms: 4,
      },
      input: { quantity: 3 },
      documentHash: 'h',
      at: 3_000,
    });
    expect(run).toMatchObject({
      mode: 'mock',
      status: 'error',
      input: { quantity: 3 },
      error: { nodeId: 'total', message: 'no price' },
      startedAt: 3_000,
    });
  });
});
