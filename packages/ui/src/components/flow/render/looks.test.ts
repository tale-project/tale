import { describe, expect, it } from 'vitest';

import { flowCompareFromOverlays } from '../compare/compare';
import type { FlowTranslate } from '../describe';
import { flowRunText } from '../describe';
import { highlightForIncident, highlightForNodes } from '../paths/highlight';
import { flowStateFromOverlay } from '../playback/derive-state';
import {
  branchFlowGraph,
  branchRunOverlay,
  branchRunOverlayB,
  triageFlowGraph,
} from '../testing/flow-fixtures';
import { flowFrameCounters, flowLooks, looksSignature } from './looks';

/** Echoes the key and its values, so the test reads what was asked for. */
const t: FlowTranslate = (key, options) =>
  options === undefined
    ? key
    : `${key}(${Object.entries(options)
        .map(([name, value]) => `${name}=${String(value)}`)
        .join(', ')})`;

describe('flowLooks', () => {
  it('rings where two runs compared differ, dashes what a version lacks, and weighs lines by who took them', () => {
    const graph = branchFlowGraph();
    const { nodes, edges } = flowLooks({
      graph,
      run: null,
      compare: flowCompareFromOverlays(
        graph,
        branchRunOverlay(),
        branchRunOverlayB(),
        { absent: { b: ['low'] } },
      ),
      primary: null,
      incident: null,
    });
    expect(nodes.get('urgent')).toEqual({
      state: 'idle',
      quiet: false,
      highlighted: 'none',
      differs: true,
    });
    expect(nodes.get('low')).toMatchObject({ absent: true });
    expect(nodes.get('low')?.differs).toBeUndefined();
    expect(nodes.has('fetch')).toBe(false);
    expect(edges.get('fetch>classify')).toEqual({ look: 'emphasis' });
    expect(edges.has('__gate:urgent>urgent')).toBe(false);
    expect(edges.get('__gate:normal>low')).toEqual({ look: 'quiet' });
  });

  it('leaves a chart with nothing to say plain', () => {
    const { nodes, edges } = flowLooks({
      graph: triageFlowGraph(),
      run: null,
      primary: null,
      incident: null,
    });
    expect(nodes.size).toBe(0);
    expect(edges.size).toBe(0);
  });

  it('steps back from everything outside a highlight, and rings what is in it', () => {
    const graph = branchFlowGraph();
    const { nodes, edges } = flowLooks({
      graph,
      run: null,
      primary: highlightForNodes(graph, ['fetch', 'classify'], {
        tone: 'error',
      }),
      incident: null,
    });
    expect(nodes.get('fetch')).toEqual({
      state: 'idle',
      quiet: false,
      highlighted: 'error',
    });
    expect(nodes.get('merge')?.quiet).toBe(true);
    expect(edges.get('fetch>classify')).toEqual({ look: 'emphasis' });
    expect(edges.get('merge>notify')).toEqual({ look: 'quiet' });
  });

  it('brings a node’s own lines forward without quieting anything', () => {
    const graph = triageFlowGraph();
    const { nodes, edges } = flowLooks({
      graph,
      run: null,
      primary: null,
      incident: highlightForIncident(graph, 'score'),
    });
    expect(nodes.size).toBe(0);
    expect(edges.get('open_issues>score')).toEqual({ look: 'emphasis' });
    expect(edges.get('issues>open_issues')).toBeUndefined();
  });

  it('draws a run: travelled lines, red into the failure, branches taken or not', () => {
    const graph = branchFlowGraph();
    const run = flowStateFromOverlay(graph, branchRunOverlay());
    const { nodes, edges } = flowLooks({
      graph,
      run,
      primary: null,
      incident: null,
    });
    expect(nodes.get('urgent')?.state).toBe('skipped');
    expect(nodes.get('__gate:urgent')?.decision).toBe(false);
    expect(edges.get('fetch>classify')).toEqual({ look: 'travelled' });
    expect(edges.get('merge>notify')).toEqual({ look: 'error' });
    expect(edges.get('__gate:urgent>urgent')).toEqual({
      look: 'quiet',
      taken: false,
    });
    expect(edges.get('__gate:normal>normal')).toEqual({
      look: 'travelled',
      taken: true,
    });
  });

  it('does not ring a failure’s way, whose boxes wear their run frames', () => {
    const graph = branchFlowGraph();
    const run = flowStateFromOverlay(graph, branchRunOverlay());
    const failure = run.failure;
    if (failure === undefined) throw new Error('no failure');
    const { nodes } = flowLooks({
      graph,
      run,
      primary: { nodes: failure.pathNodes, edges: failure.pathEdges },
      incident: null,
      ringPrimary: false,
    });
    expect(nodes.get('merge')?.highlighted).toBe('none');
    expect(nodes.get('urgent')?.quiet).toBe(true);
  });
});

describe('flowFrameCounters and flowRunText', () => {
  it('counts passes on a frame in a run', () => {
    const graph = branchFlowGraph();
    const counters = flowFrameCounters(
      graph,
      flowStateFromOverlay(graph, branchRunOverlay()),
      t,
    );
    expect(counters.get('repeat:poll')).toBe('group.pass(pass=3, max=5)');
    expect(flowFrameCounters(graph, null, t).size).toBe(0);
  });

  it('words a step’s run: the reason or the state, then the detail', () => {
    const graph = branchFlowGraph();
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    const fetch = byId.get('fetch');
    const gate = byId.get('__gate:urgent');
    if (fetch === undefined || gate === undefined) throw new Error('fixture');
    expect(flowRunText(fetch, { state: 'succeeded', detail: '1.2 s' }, t)).toBe(
      'state.succeeded · 1.2 s',
    );
    expect(flowRunText(fetch, { state: 'failed' }, t, true)).toBe(
      'state.failedHere',
    );
    expect(
      flowRunText(fetch, { state: 'running', items: { done: 2, total: 5 } }, t),
    ).toBe('state.running · group.items(done=2, total=5)');
    expect(flowRunText(gate, { state: 'succeeded', decision: true }, t)).toBe(
      'state.decidedYes',
    );
  });

  it('keeps a signature that changes with the looks', () => {
    const a = new Map([['x', { look: 'quiet' }]]);
    const b = new Map([['x', { look: 'quiet' }]]);
    const c = new Map([['x', { look: 'emphasis' }]]);
    expect(looksSignature(a)).toBe(looksSignature(b));
    expect(looksSignature(a)).not.toBe(looksSignature(c));
  });
});
