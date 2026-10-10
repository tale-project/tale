import { describe, expect, it } from 'vitest';

import { analyzeFlow } from '@/lib/engine/core/analysis/flow';
import type { Automation } from '@/lib/engine/core/types';
import { i18n } from '@/tests/utils/i18n-all-languages';

import { toFlowGraph } from './flow-graph';
import { END_ID, START_ID, gateIdOf } from './flow-ids';
import { nodeCatalogView } from './node-face';
import { runOverlay } from './run-overlay';
import type { NodeRunStatus, RunProjection, RunStatus } from './run-view';

/**
 * A run laid over the canvas: every node in the package's state words, the
 * way each condition decided, who started the run and how it ended.
 */

const t = i18n.getFixedT('en', 'automations');

const DOC: Automation = {
  name: 'triage',
  nodes: [
    { id: 'inbox', type: 'transform', code: 'return [];' },
    {
      id: 'triage',
      type: 'llm',
      when: '{{ nodes.inbox.output.length > 0 }}',
      prompt: '{{ nodes.inbox.output }}',
    },
    {
      id: 'quiet',
      type: 'transform',
      elseOf: 'triage',
      code: 'return null;',
    },
    {
      id: 'report',
      type: 'transform',
      input: { triage: '{{ nodes.triage.output }}' },
      code: 'return input;',
    },
  ],
};

const { graph } = toFlowGraph(DOC, {
  t,
  tSchema: i18n.getFixedT('en', 'schemaTree'),
  locale: 'en',
  catalog: nodeCatalogView([]),
  returns: { status: 'off', outputs: null },
  triggers: [{ id: 'trigger:manual', label: 'By hand, the API or MCP' }],
  flow: analyzeFlow(DOC.nodes),
});

function overlay(
  statuses: Record<string, NodeRunStatus>,
  status: RunStatus,
  byNode: RunProjection['byNode'] = new Map(),
  startedBy?: string,
) {
  return runOverlay({
    graph,
    statusByNode: new Map(Object.entries(statuses)),
    projection: { byNode, effects: [], trace: [] },
    status,
    t,
    ...(startedBy !== undefined && { startedBy }),
  });
}

describe('runOverlay', () => {
  it('reads a run that took the No branch, with durations and who started it', () => {
    const result = overlay(
      { inbox: 'ok', triage: 'skipped', quiet: 'ok', report: 'skipped' },
      'success',
      new Map([['inbox', { status: 'ok', ms: 1200, effects: [] }]]),
      'Started by you',
    );
    expect(result.finished).toBe(true);
    expect(result.nodes.inbox).toEqual({ state: 'succeeded', detail: '2s' });
    expect(result.nodes.triage).toEqual({ state: 'skipped' });
    // The condition decided No: its node was skipped while what it reads ran.
    expect(result.nodes[gateIdOf('triage')]).toEqual({
      state: 'succeeded',
      decision: false,
    });
    expect(result.nodes[START_ID]).toEqual({
      state: 'succeeded',
      detail: 'Started by you',
    });
    expect(result.nodes[END_ID]).toEqual({ state: 'succeeded' });
  });

  it('says Yes for a condition whose node ran', () => {
    const result = overlay(
      { inbox: 'ok', triage: 'ok', quiet: 'skipped', report: 'ok' },
      'success',
    );
    expect(result.nodes[gateIdOf('triage')]).toEqual({
      state: 'succeeded',
      decision: true,
    });
  });

  it('marks where a failed run stopped, its error line, and what it never reached', () => {
    const result = overlay(
      { inbox: 'ok', triage: 'error', quiet: 'pending', report: 'pending' },
      'failed',
      new Map([
        [
          'triage',
          {
            status: 'error',
            error: 'Model refused the prompt\n  at call',
            effects: [],
          },
        ],
      ]),
    );
    expect(result.nodes.triage).toEqual({
      state: 'failed',
      reason: 'Model refused the prompt',
    });
    // A finished run never comes back for them: not run, not "not yet".
    expect(result.nodes.report).toEqual({ state: 'not-run' });
    expect(result.nodes[END_ID]).toEqual({
      state: 'failed',
      reason: 'Failed at Triage',
    });
  });

  it('keeps nodes ahead of a live run pending, and End too', () => {
    const result = overlay(
      { inbox: 'ok', triage: 'running', quiet: 'pending', report: 'pending' },
      'running',
    );
    expect(result.finished).toBe(false);
    expect(result.nodes.triage).toEqual({ state: 'running' });
    expect(result.nodes.report).toEqual({ state: 'pending' });
    expect(result.nodes[gateIdOf('triage')]).toEqual({
      state: 'succeeded',
      decision: true,
    });
    expect(result.nodes[END_ID]).toEqual({ state: 'pending' });
  });

  it('says why a node whose server stopped is not being worked on', () => {
    const result = overlay(
      {
        inbox: 'interrupted',
        triage: 'pending',
        quiet: 'pending',
        report: 'pending',
      },
      'running',
    );
    expect(result.nodes.inbox).toEqual({
      state: 'pending',
      reason: 'Interrupted here',
    });
  });

  it('reads a stopped run as stopped', () => {
    const result = overlay(
      { inbox: 'ok', triage: 'stopped', quiet: 'pending', report: 'pending' },
      'cancelled',
    );
    expect(result.nodes.triage).toEqual({ state: 'stopped' });
    expect(result.nodes[END_ID]).toEqual({ state: 'stopped' });
  });
});
