import { describe, expect, it } from 'vitest';

import type { Automation, NodeDef } from '@/lib/engine/core/types';
import type { WireAutomationIssue } from '@/lib/shared/schemas/automation-issues';
import { i18n } from '@/tests/utils/i18n-all-languages';

import {
  fieldIssueMessage,
  formatIssueLocation,
  issueCountsByNode,
  issueNavigation,
  sortIssues,
  toIssueView,
  withIssueIds,
} from './issues';

const DOC: Automation = {
  version: 1,
  name: 'support/triage',
  nodes: [
    { id: 'fetch_issues', type: 'transform', code: 'return [];' },
    {
      id: 'draft_reply',
      type: 'llm',
      prompt: 'Summarize {{ nodes.nope.output }}',
      model: 'openai/gpt-4o',
      input: { to: '{{ input.email }}' },
    },
  ],
  output: '{{ nodes.draft_reply.output }}',
};

/** The inspector's text boxes for every node in these tests. */
const controlsOf = (node: NodeDef): ReadonlySet<string> =>
  new Set(
    node.type === 'llm'
      ? ['prompt', 'system', 'outputSchema', 'input', 'when']
      : ['code', 'input', 'when'],
  );

function issue(
  overrides: Partial<WireAutomationIssue> & Pick<WireAutomationIssue, 'code'>,
): WireAutomationIssue {
  return { level: 'error', message: 'engine sentence', ...overrides };
}

const t = i18n.getFixedT('en', 'automations');

describe('withIssueIds', () => {
  it('names an issue by what and where it is, the same on every check', () => {
    const found = issue({
      code: 'REF_UNKNOWN_NODE',
      at: { pointer: '/nodes/1/prompt', range: [10, 32] },
    });
    const [first] = withIssueIds([found]);
    const [again] = withIssueIds([{ ...found }]);
    expect(first?.id).toBe(again?.id);
  });

  it('tells apart two issues that share code and place', () => {
    const twin = issue({ code: 'UNUSED_NODE', at: { pointer: '/nodes/0' } });
    const ids = withIssueIds([twin, twin]).map((entry) => entry.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('sortIssues', () => {
  it('lists errors first, then in the order the document reads', () => {
    const sorted = sortIssues([
      issue({ code: 'A', level: 'warning', at: { pointer: '/nodes/0' } }),
      issue({ code: 'B', at: { pointer: '/output' } }),
      issue({ code: 'C', at: { pointer: '/nodes/10/prompt' } }),
      issue({ code: 'D', at: { pointer: '/nodes/2/prompt', range: [9, 12] } }),
      issue({ code: 'E', at: { pointer: '/nodes/2/prompt', range: [1, 4] } }),
      issue({ code: 'F', at: { pointer: '/version' } }),
      issue({ code: 'G', at: { pointer: '/tests/0' } }),
    ]);
    expect(sorted.map((entry) => entry.code)).toEqual([
      'F',
      'E',
      'D',
      'C',
      'B',
      'G',
      'A',
    ]);
  });
});

describe('issueCountsByNode', () => {
  it('counts errors and warnings per node, by pointer or by node id', () => {
    const counts = issueCountsByNode(
      [
        issue({ code: 'A', at: { pointer: '/nodes/1/prompt' } }),
        issue({ code: 'B', level: 'warning', at: { pointer: '/nodes/1' } }),
        issue({ code: 'C', level: 'warning', nodeId: 'fetch_issues' }),
        // About the output, even though it names the node it reads.
        issue({ code: 'D', nodeId: 'draft_reply', at: { pointer: '/output' } }),
      ],
      DOC,
    );
    expect(counts.get('draft_reply')).toEqual({ errors: 1, warnings: 1 });
    expect(counts.get('fetch_issues')).toEqual({ errors: 0, warnings: 1 });
  });
});

describe('issueNavigation', () => {
  it('goes to the field with the range of the offending text', () => {
    expect(
      issueNavigation(
        issue({
          code: 'REF_UNKNOWN_NODE',
          at: { pointer: '/nodes/1/prompt', range: [10, 32] },
        }),
        DOC,
        controlsOf,
      ),
    ).toEqual({
      kind: 'field',
      nodeId: 'draft_reply',
      nodeIndex: 1,
      field: 'prompt',
      anchor: '/nodes/1/prompt',
      range: [10, 32],
    });
  });

  it('goes to the field that holds a key inside it', () => {
    expect(
      issueNavigation(
        issue({ code: 'X', at: { pointer: '/nodes/1/input/to' } }),
        DOC,
        controlsOf,
      ),
    ).toMatchObject({
      kind: 'field',
      field: 'input',
      anchor: '/nodes/1/input/to',
    });
  });

  it('goes to the node for a field without a box of its own', () => {
    expect(
      issueNavigation(
        issue({
          code: 'LLM_MODEL_UNAVAILABLE',
          at: { pointer: '/nodes/1/model' },
        }),
        DOC,
        controlsOf,
      ),
    ).toEqual({ kind: 'node', nodeId: 'draft_reply', nodeIndex: 1 });
  });

  it('goes to the node for an unknown field and for the node as a whole', () => {
    expect(
      issueNavigation(
        issue({
          code: 'X',
          at: { pointer: '/nodes/0/prompt', subject: 'key' },
        }),
        DOC,
        controlsOf,
      ),
    ).toEqual({ kind: 'node', nodeId: 'fetch_issues', nodeIndex: 0 });
    expect(
      issueNavigation(
        issue({ code: 'UNUSED_NODE', at: { pointer: '/nodes/0' } }),
        DOC,
        controlsOf,
      ),
    ).toEqual({ kind: 'node', nodeId: 'fetch_issues', nodeIndex: 0 });
  });

  it('cannot go to a place the editor does not edit', () => {
    for (const pointer of ['/output', '/inputs', '/tests/0', '/name', '']) {
      expect(
        issueNavigation(issue({ code: 'X', at: { pointer } }), DOC, controlsOf),
      ).toEqual({ kind: 'unavailable' });
    }
    // A pointer past the nodes of the document on screen (an older check).
    expect(
      issueNavigation(
        issue({ code: 'X', at: { pointer: '/nodes/7/code' } }),
        DOC,
        controlsOf,
      ),
    ).toEqual({ kind: 'unavailable' });
  });
});

describe('formatIssueLocation', () => {
  const ctx = { locale: 'en', t };

  it("names the node, the field's label and the key inside it", () => {
    expect(
      formatIssueLocation(
        issue({ code: 'X', at: { pointer: '/nodes/1/input/to' } }),
        DOC,
        ctx,
      ),
    ).toBe('draft reply › Input › to');
  });

  it('names places outside the nodes by their own name', () => {
    expect(
      formatIssueLocation(
        issue({ code: 'X', at: { pointer: '/output/summary' } }),
        DOC,
        ctx,
      ),
    ).toBe('Output › summary');
    expect(
      formatIssueLocation(
        issue({ code: 'X', at: { pointer: '/tests/0/input' } }),
        DOC,
        ctx,
      ),
    ).toBe('Tests › 1 › input');
    expect(formatIssueLocation(issue({ code: 'X' }), DOC, ctx)).toBe(
      'Automation',
    );
  });

  it('reads the place names in the reader’s language', () => {
    expect(
      formatIssueLocation(
        issue({ code: 'X', at: { pointer: '/output' } }),
        DOC,
        { locale: 'de', t: i18n.getFixedT('de', 'automations') },
      ),
    ).not.toBe('Output');
  });
});

describe('toIssueView', () => {
  it('reads an issue in words, with the engine sentence as technical detail', () => {
    const [found] = withIssueIds([
      issue({
        code: 'REF_UNKNOWN_NODE',
        message: 'nodes.nope does not exist',
        hint: 'reference one of: fetch_issues',
        at: { pointer: '/nodes/1/prompt', range: [10, 32] },
        params: {
          node: 'draft_reply',
          field: 'prompt',
          ref: 'nope',
          available: ['fetch_issues'],
        },
      }),
    ]);
    if (found === undefined) throw new Error('no issue');
    const view = toIssueView(found, DOC, { locale: 'en', t, controlsOf });
    expect(view.item).toMatchObject({
      id: found.id,
      severity: 'error',
      code: 'REF_UNKNOWN_NODE',
      location: 'draft reply › Prompt',
      technical: 'nodes.nope does not exist\nreference one of: fetch_issues',
    });
    expect(view.item.title).not.toBe('');
    expect(view.item.unavailableReason).toBeUndefined();
  });

  it('says why a problem outside the nodes cannot be gone to', () => {
    const [found] = withIssueIds([
      issue({ code: 'OUTPUT_MISSING', at: { pointer: '/output' } }),
    ]);
    if (found === undefined) throw new Error('no issue');
    const view = toIssueView(found, DOC, { locale: 'en', t, controlsOf });
    expect(view.navigation).toEqual({ kind: 'unavailable' });
    expect(view.item.unavailableReason).toBe(t('problems.notEditableHere'));
  });
});

describe('fieldIssueMessage', () => {
  it('leads with the key inside the field the problem is about', () => {
    const [found] = withIssueIds([
      issue({
        code: 'REF_UNKNOWN_NODE',
        at: { pointer: '/nodes/1/input/to' },
        params: { node: 'draft_reply', field: 'input', ref: 'nope' },
      }),
    ]);
    if (found === undefined) throw new Error('no issue');
    const view = toIssueView(found, DOC, { locale: 'en', t, controlsOf });
    const message = fieldIssueMessage(view, t);
    expect(message.startsWith('to: ')).toBe(true);
    const cause = view.item.cause;
    expect(typeof cause).toBe('string');
    expect(message).toContain(typeof cause === 'string' ? cause : '');
  });

  it('does not lead with the key when the cause already names it', () => {
    const [found] = withIssueIds([
      issue({
        code: 'TYPE_MISMATCH',
        at: { pointer: '/nodes/1/input/to' },
        params: {
          node: 'draft_reply',
          consumer: 'connector',
          property: 'to',
          expr: '{{ input.count }}',
          expected: 'string',
          actual: 'number',
        },
      }),
    ]);
    if (found === undefined) throw new Error('no issue');
    const view = toIssueView(found, DOC, { locale: 'en', t, controlsOf });
    expect(fieldIssueMessage(view, t)).toBe(view.item.cause);
  });

  it('reads the generic explanation for a code this build does not know', () => {
    const [found] = withIssueIds([
      issue({
        code: 'SOMETHING_NEWER',
        message: 'node "draft_reply": something the server learned later',
        at: { pointer: '/nodes/1/prompt' },
        params: { node: 'draft_reply' },
      }),
    ]);
    if (found === undefined) throw new Error('no issue');
    const view = toIssueView(found, DOC, { locale: 'en', t, controlsOf });
    expect(view.item.cause).toBeUndefined();
    expect(view.item.fix).toBeUndefined();
    expect(view.item.technical).toContain('something the server learned');
    expect(fieldIssueMessage(view, t)).toBe(view.item.explanation);
  });

  it('is the cause alone for a problem with the field itself', () => {
    const [found] = withIssueIds([
      issue({
        code: 'REF_UNKNOWN_NODE',
        at: { pointer: '/nodes/1/prompt', range: [10, 32] },
        params: { node: 'draft_reply', field: 'prompt', ref: 'nope' },
      }),
    ]);
    if (found === undefined) throw new Error('no issue');
    const view = toIssueView(found, DOC, { locale: 'en', t, controlsOf });
    expect(fieldIssueMessage(view, t)).toBe(view.item.cause);
  });
});
