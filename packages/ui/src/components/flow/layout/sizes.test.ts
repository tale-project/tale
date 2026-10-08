import { describe, expect, it } from 'vitest';

import type { FlowEntryNode, FlowExitNode, FlowStepNode } from '../types';
import {
  FLOW_NODE_WIDTH,
  flowEdgeLabelSize,
  flowFrameHeaderSize,
  flowNodeSize,
  visibleRows,
} from './sizes';

const step = (extra: Partial<FlowStepNode> = {}): FlowStepNode => ({
  id: 'a',
  kind: 'step',
  label: 'A',
  ...extra,
});

describe('flowNodeSize', () => {
  it('pins a step at 88, 108, 116 or 136 px by the rows it has', () => {
    expect(flowNodeSize(step())).toEqual({
      width: FLOW_NODE_WIDTH,
      height: 88,
    });
    expect(flowNodeSize(step({ returns: null })).height).toBe(108);
    expect(
      flowNodeSize(step({ returns: { text: 'x', code: true } })).height,
    ).toBe(108);
    expect(
      flowNodeSize(step({ chips: [{ id: 'c', label: 'Continues on error' }] }))
        .height,
    ).toBe(116);
    expect(flowNodeSize(step({ unreachable: true })).height).toBe(116);
    expect(
      flowNodeSize(
        step({
          returns: null,
          chips: [{ id: 'c', label: 'Continues on error' }],
        }),
      ).height,
    ).toBe(136);
  });

  it('never sizes a step by its run, its problems or its words', () => {
    expect(
      flowNodeSize(step({ label: 'A much longer title than fits' })),
    ).toEqual(flowNodeSize(step()));
    expect(flowNodeSize(step({ conditional: true }))).toEqual(
      flowNodeSize(step()),
    );
  });

  it('sums Start from its sections', () => {
    const entry: FlowEntryNode = {
      id: '__start',
      kind: 'entry',
      triggers: [
        { id: 's', label: 'Every day', note: 'Next Thu' },
        { id: 'm', label: 'By hand' },
      ],
      inputs: [
        { id: 'a', label: 'a' },
        { id: 'b', label: 'b' },
      ],
    };
    // 12 + 20 + (8 + 16 + 4 + 36 + 20) + (8 + 16 + 4 + 40) + 12 + 28
    expect(flowNodeSize(entry).height).toBe(224);
    // Five inputs show three and "+2 more": four row slots.
    const many = {
      ...entry,
      inputs: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, label: id })),
    };
    expect(flowNodeSize(many).height).toBe(224 + 40);
    // No inputs: one line of words.
    expect(flowNodeSize({ ...entry, inputs: [] }).height).toBe(224 - 20);
    expect(
      flowNodeSize({ ...entry, notice: { tone: 'warning', text: 'x' } }).height,
    ).toBe(224 + 36);
  });

  it('sums End from its sections', () => {
    const exit: FlowExitNode = {
      id: '__end',
      kind: 'exit',
      outputs: [{ id: 'o', label: 'The output of Report' }],
    };
    // 12 + 20 + (8 + 16 + 4 + 20) + 12 + 28
    expect(flowNodeSize(exit).height).toBe(120);
    expect(flowNodeSize({ ...exit, shape: '{ a: number }' }).height).toBe(140);
    const outcomes = ['ok', 'failed', 'stopped'].map((id) => ({
      id,
      label: id,
    }));
    expect(flowNodeSize({ ...exit, outcomes }).height).toBe(120 + 28 + 60);
  });

  it('sizes a gate to its condition, 160 to 288 px', () => {
    const gate = (condition: string) =>
      flowNodeSize(
        { id: 'g', kind: 'gate', label: 'A', mode: 'only-if', condition },
        (text) => text.length * 10,
      );
    expect(gate('short')).toEqual({ width: 160, height: 40 });
    expect(gate('a condition of thirty chars..')).toEqual({
      width: 288,
      height: 40,
    });
    expect(gate('fifteen chars..').width).toBe(208);
  });
});

describe('labels and frame headers', () => {
  it('pads a label 8 px a side, on the 4-px grid', () => {
    expect(flowEdgeLabelSize('Yes', () => 21)).toEqual({
      width: 40,
      height: 20,
    });
  });

  it('keeps a frame header between 96 and 288 px', () => {
    expect(flowFrameHeaderSize('x', () => 5).width).toBe(96);
    expect(flowFrameHeaderSize('x', () => 1000).width).toBe(288);
    expect(flowFrameHeaderSize('x', () => 150).width).toBe(180);
  });
});

describe('visibleRows', () => {
  it('folds what does not fit into "+n more", within the row budget', () => {
    expect(visibleRows([1, 2, 3], 3)).toEqual({ shown: [1, 2, 3], more: 0 });
    expect(visibleRows([1, 2, 3, 4, 5], 3)).toEqual({ shown: [1, 2], more: 3 });
  });
});
