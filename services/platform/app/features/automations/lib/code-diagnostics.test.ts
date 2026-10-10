import { describe, expect, it } from 'vitest';

import type { Automation, NodeDef } from '@/lib/engine/core/types';
import type { WireAutomationIssue } from '@/lib/shared/schemas/automation-issues';
import { i18n } from '@/tests/utils/i18n-all-languages';

import { fieldDiagnostics } from './code-diagnostics';
import { toIssueView, withIssueIds, type AutomationIssueView } from './issues';

/**
 * A field's problems on the characters they are about: the engine's range
 * inside a string as is, a pointer deeper inside a JSON value found in the
 * text the reader edits (escapes included), and the engine's did-you-mean
 * as a fix that rewrites exactly the misspelled name.
 */

const prompt =
  'Summarize {{ nodes.fetch_isues.output.items }} for {{ input.emial }}';
const input = {
  to: '{{ input.email }}',
  note: 'say "hi"\n{{ nodes.fetch.output.ttle }}',
};

const DOC: Automation = {
  name: 'support/triage',
  nodes: [
    { id: 'fetch', type: 'transform', code: 'return { title: 1 };' },
    { id: 'reply', type: 'llm', prompt, input },
  ],
};

const controlsOf = (_node: NodeDef): ReadonlySet<string> =>
  new Set(['prompt', 'input', 'code']);

const t = i18n.getFixedT('en', 'automations');

function views(issues: WireAutomationIssue[]): AutomationIssueView[] {
  return withIssueIds(issues).map((issue) =>
    toIssueView(issue, DOC, { locale: 'en', t, controlsOf }),
  );
}

describe('a string field', () => {
  const [unknownNode, unknownKey, whole] = views([
    {
      level: 'error',
      code: 'REF_UNKNOWN_NODE',
      message: 'node "reply" references nodes.fetch_isues …',
      at: { pointer: '/nodes/1/prompt', range: [13, 43] },
      params: {
        node: 'reply',
        field: 'prompt',
        ref: 'fetch_isues',
        suggestion: 'fetch',
        known: ['fetch', 'reply'],
      },
    },
    {
      level: 'warning',
      code: 'INPUT_KEY_UNKNOWN',
      message: 'node "reply" uses input.emial …',
      at: { pointer: '/nodes/1/prompt', range: [54, 65] },
      params: {
        node: 'reply',
        field: 'prompt',
        key: 'emial',
        suggestion: 'email',
        declared: ['email'],
      },
    },
    {
      level: 'warning',
      code: 'TEMPLATE_UNTERMINATED',
      message: 'whole field',
      at: { pointer: '/nodes/1/prompt' },
      params: { node: 'reply', field: 'prompt' },
    },
  ]);

  const marks = fieldDiagnostics({
    views: [unknownNode, unknownKey, whole].flatMap((view) =>
      view === undefined ? [] : [view],
    ),
    fieldPointer: '/nodes/1/prompt',
    text: prompt,
    kind: 'string',
    t,
  });

  it("marks the engine's range as is, with the field's words and code", () => {
    expect(marks[0]).toMatchObject({
      id: unknownNode?.issue.id,
      severity: 'error',
      range: [13, 43],
      code: 'REF_UNKNOWN_NODE',
      message: unknownNode === undefined ? '' : unknownNode.item.cause,
    });
    expect(prompt.slice(13, 43)).toBe('nodes.fetch_isues.output.items');
  });

  it('rewrites exactly the misspelled name to the one the engine suggests', () => {
    expect(marks[0]?.fixes).toEqual([
      {
        label: 'Replace with fetch',
        changes: [{ range: [19, 30], insert: 'fetch' }],
      },
    ]);
    expect(marks[1]?.fixes?.[0]?.changes).toEqual([
      { range: [60, 65], insert: 'email' },
    ]);
    expect(prompt.slice(60, 65)).toBe('emial');
  });

  it('marks a problem with the field as a whole without a range', () => {
    expect(marks[2]).toMatchObject({ severity: 'warning' });
    expect(marks[2]?.range).toBeUndefined();
    expect(marks[2]?.fixes).toBeUndefined();
  });

  it('marks the whole field when the range no longer fits its text', () => {
    const [late] = fieldDiagnostics({
      views: unknownNode === undefined ? [] : [unknownNode],
      fieldPointer: '/nodes/1/prompt',
      text: 'short',
      kind: 'string',
      t,
    });
    expect(late?.range).toBeUndefined();
    expect(late?.fixes).toBeUndefined();
  });
});

describe('a JSON field', () => {
  const text = JSON.stringify(input, null, 2);
  const [deep] = views([
    {
      level: 'warning',
      code: 'REF_UNKNOWN_FIELD',
      message: 'nodes.fetch.output.ttle …',
      at: { pointer: '/nodes/1/input/note', range: [12, 35] },
      params: {
        node: 'reply',
        field: 'input',
        ref: 'nodes.fetch.output.ttle',
        root: 'nodes',
        source: 'fetch',
        key: 'ttle',
        suggestion: 'title',
        known: ['title'],
        closed: true,
        listWrapped: false,
      },
    },
  ]);

  it('finds a pointer inside the value in the text, past escapes', () => {
    expect(input.note.slice(12, 35)).toBe('nodes.fetch.output.ttle');
    const [mark] = fieldDiagnostics({
      views: deep === undefined ? [] : [deep],
      fieldPointer: '/nodes/1/input',
      text,
      kind: 'json',
      t,
    });
    const range = mark?.range;
    expect(range).toBeDefined();
    if (range === undefined) return;
    expect(text.slice(range[0], range[1])).toBe('nodes.fetch.output.ttle');
    const change = mark?.fixes?.[0]?.changes[0];
    expect(change?.insert).toBe('title');
    if (change === undefined) return;
    expect(text.slice(change.range[0], change.range[1])).toBe('ttle');
  });

  it('marks the whole field when the pointer names nothing in the text', () => {
    const [mark] = fieldDiagnostics({
      views: deep === undefined ? [] : [deep],
      fieldPointer: '/nodes/1/input',
      text: '{ "to": 1 }',
      kind: 'json',
      t,
    });
    expect(mark?.range).toBeUndefined();
  });
});
