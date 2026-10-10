// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { diffAutomationDocuments } from './automation';
import { changedNodeIds, changeSummaryOf } from './changes';

const before = {
  name: 'billing/dunning',
  description: 'Chases unpaid invoices.',
  inputs: { type: 'object', properties: { invoice: { type: 'string' } } },
  nodes: [
    {
      id: 'load',
      type: 'billing.get_invoice',
      input: { id: '{{ input.invoice }}' },
    },
    {
      id: 'draft',
      type: 'llm',
      prompt: 'Remind about {{ nodes.load.output.number }}',
    },
    {
      id: 'send',
      type: 'gmail.send',
      input: { body: '{{ nodes.draft.output.text }}' },
    },
  ],
  output: '{{ nodes.send.output }}',
  tests: [{ name: 'paid', input: { invoice: 'i1' } }],
};

describe('changeSummaryOf', () => {
  it('says only how many nodes a first version starts with', () => {
    expect(changeSummaryOf(diffAutomationDocuments(null, before))).toEqual({
      first: true,
      nodes: { added: 3, removed: 0, changed: 0 },
    });
  });

  it('marks a version whose document is the one before it', () => {
    const summary = changeSummaryOf(
      diffAutomationDocuments(before, { ...before, ui: { zoom: 2 } }),
    );
    expect(summary).toEqual({
      identical: true,
      nodes: { added: 0, removed: 0, changed: 0 },
    });
  });

  it('counts nodes and flags every other part that changed', () => {
    const after = {
      ...before,
      name: 'billing/dunning-v2',
      description: 'Chases unpaid invoices politely.',
      inputs: { type: 'object', properties: { invoice: { type: 'number' } } },
      nodes: [
        before.nodes[0],
        {
          ...before.nodes[1],
          prompt: 'Kindly remind about {{ nodes.load.output.number }}',
        },
        { id: 'log', type: 'transform', code: 'return 1;' },
      ],
      output: '{{ nodes.log.output }}',
      tests: [],
    };
    expect(
      changeSummaryOf(
        diffAutomationDocuments(before, after, {
          beforePackage: { settings: { folder: 'Setup' } },
          afterPackage: { settings: { folder: 'Config' } },
        }),
      ),
    ).toEqual({
      nodes: { added: 1, removed: 1, changed: 1 },
      inputs: true,
      output: true,
      description: true,
      tests: true,
      other: true,
      package: true,
    });
  });

  it('counts a rename once, its readers and the output folded under it', () => {
    const after = {
      ...before,
      nodes: [
        { ...before.nodes[0], id: 'invoice' },
        {
          ...before.nodes[1],
          prompt: 'Remind about {{ nodes.invoice.output.number }}',
        },
        before.nodes[2],
      ],
    };
    const diff = diffAutomationDocuments(before, after);
    expect(changeSummaryOf(diff)).toEqual({
      nodes: { added: 0, removed: 0, changed: 0, renamed: 1 },
    });
    const outputToo = diffAutomationDocuments(
      { ...before, output: '{{ nodes.load.output }}' },
      { ...after, output: '{{ nodes.invoice.output }}' },
    );
    expect(changeSummaryOf(outputToo)).toEqual({
      nodes: { added: 0, removed: 0, changed: 0, renamed: 1 },
    });
  });

  it('lets the caller say the version is a first one', () => {
    expect(
      changeSummaryOf(diffAutomationDocuments(before, before), { first: true }),
    ).toEqual({ first: true, nodes: { added: 0, removed: 0, changed: 0 } });
  });

  it('holds counts and flags only, never content', () => {
    const after = { ...before, description: 'secret: hunter2' };
    expect(
      JSON.stringify(changeSummaryOf(diffAutomationDocuments(before, after))),
    ).not.toContain('hunter2');
  });
});

describe('changedNodeIds', () => {
  it('names what is new or different in the later version, by its new id', () => {
    const after = {
      ...before,
      nodes: [
        { ...before.nodes[0], id: 'invoice' },
        {
          ...before.nodes[1],
          prompt: 'Remind about {{ nodes.invoice.output.number }}',
        },
        { id: 'log', type: 'transform', code: 'return 1;' },
      ],
    };
    expect([...changedNodeIds(diffAutomationDocuments(before, after))]).toEqual(
      ['invoice', 'draft', 'log'],
    );
  });

  it('names nothing when only ignored keys changed', () => {
    const after = {
      ...before,
      nodes: before.nodes.map((node) => ({ ...node, ui: { x: 1 } })),
    };
    expect(changedNodeIds(diffAutomationDocuments(before, after)).size).toBe(0);
  });
});
