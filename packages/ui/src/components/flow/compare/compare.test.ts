import { describe, expect, it } from 'vitest';

import type { FlowTranslate } from '../describe';
import {
  branchFlowGraph,
  branchRunOverlay,
  branchRunOverlayB,
} from '../testing/flow-fixtures';
import {
  flowCompareFaces,
  flowCompareFromOverlays,
  flowCompareLabels,
} from './compare';

/** Echoes the key and its values, so the test reads what was asked for. */
const t: FlowTranslate = (key, options) =>
  options === undefined
    ? key
    : `${key}(${Object.entries(options)
        .map(([name, value]) => `${name}=${String(value)}`)
        .join(', ')})`;

const compared = () =>
  flowCompareFromOverlays(
    branchFlowGraph(),
    branchRunOverlay(),
    branchRunOverlayB(),
  );

describe('flowCompareFromOverlays', () => {
  it('marks the nodes two runs left in different states or decided apart', () => {
    const { nodes } = compared();
    expect(nodes.fetch?.differs).toBe(false);
    expect(nodes.classify?.differs).toBe(false);
    // Urgent was skipped in A and ran in B; its condition decided apart.
    expect(nodes.urgent).toMatchObject({
      differs: true,
      a: { state: 'skipped' },
      b: { state: 'succeeded' },
    });
    expect(nodes['__gate:urgent']).toMatchObject({
      differs: true,
      a: { decision: false },
      b: { decision: true },
    });
    // B never reached Normal: it did not run there.
    expect(nodes.normal?.b?.state).toBe('not-run');
    expect(nodes.normal?.differs).toBe(true);
    expect(nodes.notify?.differs).toBe(true);
  });

  it('says which run took each line', () => {
    const { edges } = compared();
    expect(edges['fetch>classify']).toBe('both');
    expect(edges['__gate:urgent>urgent']).toBe('b');
    expect(edges['fetch>urgent']).toBe('b');
    expect(edges['__gate:urgent>__gate:normal']).toBe('a');
    expect(edges['__gate:normal>normal']).toBe('a');
    expect(edges['__gate:normal>low']).toBe('neither');
  });

  it('takes the host’s word for what else differs, and for nodes a version lacks', () => {
    const { nodes, labels } = flowCompareFromOverlays(
      branchFlowGraph(),
      branchRunOverlay(),
      branchRunOverlayB(),
      {
        labels: { a: 'Run 1', b: 'Run 2' },
        differs: ['merge'],
        absent: { b: ['low'] },
      },
    );
    expect(nodes.merge?.differs).toBe(true);
    // A node one version lacks is absent there, not "different".
    expect(nodes.low).toEqual({
      a: { state: 'skipped', reason: 'Skipped: the condition is false' },
      differs: false,
      absentIn: 'b',
    });
    expect(labels).toEqual({ a: 'Run 1', b: 'Run 2' });
  });
});

describe('flowCompareFaces', () => {
  it('words each run’s side short: what it came to, or why it stopped', () => {
    const faces = flowCompareFaces(branchFlowGraph(), compared(), t);
    expect(faces.get('fetch')).toEqual({
      differs: false,
      a: { state: 'succeeded', text: '390 ms' },
      b: { state: 'succeeded', text: '410 ms' },
    });
    expect(faces.get('notify')).toEqual({
      differs: true,
      a: { state: 'failed', text: 'The mail server refused the message' },
      b: { state: 'succeeded', text: '300 ms' },
    });
    expect(faces.get('__gate:urgent')).toMatchObject({
      a: { text: 'branch.no', decision: false },
      b: { text: 'branch.yes', decision: true },
    });
    expect(faces.get('normal')?.b).toEqual({
      state: 'not-run',
      text: 'state.notRun',
    });
    expect(faces.get('poll')?.b?.text).toBe('1 s');
  });

  it('says which version lacks a node, in the runs’ own names', () => {
    const faces = flowCompareFaces(
      branchFlowGraph(),
      flowCompareFromOverlays(
        branchFlowGraph(),
        branchRunOverlay(),
        branchRunOverlayB(),
        { absent: { b: ['low'] } },
      ),
      t,
    );
    expect(faces.get('low')?.absent).toBe('compare.absent(label=compare.b)');
    expect(faces.get('low')?.b).toBeUndefined();
    expect(flowCompareLabels({ nodes: {}, edges: {} }, t)).toEqual({
      a: 'compare.a',
      b: 'compare.b',
    });
  });
});
