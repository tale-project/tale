import { describe, expect, it } from 'vitest';

import { setCodeRunner } from '../engine/core/runner';
import { nodeVmRunner } from '../engine/runners/node-vm';
import type { ExpressionScope, StepOutputKind } from './expression';
import { translateExpression, translateTemplate } from './expression';

setCodeRunner(nodeVmRunner());

function scope(
  overrides: Partial<ExpressionScope> & {
    steps?: Record<string, StepOutputKind>;
    vars?: Record<string, string>;
  } = {},
): ExpressionScope {
  const steps = overrides.steps ?? {};
  return {
    nodeIds: new Map(Object.keys(steps).map((slug) => [slug, slug])),
    outputKinds: new Map(Object.entries(steps)),
    variables: new Map(Object.entries(overrides.vars ?? {})),
    constantsNodeId: 'constants',
    constants: new Set(['maxLoops']),
    iterating: overrides.iterating ?? false,
    itemVariable: overrides.itemVariable,
    perItemOutputs: overrides.perItemOutputs,
  };
}

describe('reference roots are re-rooted onto the engine scope', () => {
  const cases: Array<{
    name: string;
    source: string;
    scope: ExpressionScope;
    text: string;
    issues?: RegExp[];
  }> = [
    {
      name: 'a connector result loses the step-runner envelope and is flagged',
      source: 'steps.list_issues.output.data.result.data',
      scope: scope({ steps: { list_issues: 'integration' } }),
      text: 'nodes.list_issues.output',
      issues: [/connector actions now return their own shape/],
    },
    {
      name: 'a structured model reply keeps its field path',
      source: 'steps.score.output.data.actionable == true',
      scope: scope({ steps: { score: 'llm-json' } }),
      text: 'nodes.score.output?.actionable == true',
    },
    {
      name: 'a plain text reply resolves to .text',
      source: 'steps.judge.output.data',
      scope: scope({ steps: { judge: 'llm-text' } }),
      text: 'nodes.judge.output?.text',
    },
    {
      name: 'the run input passes through',
      source: "input.owner + '/' + input.repo",
      scope: scope(),
      text: "input.owner + '/' + input.repo",
    },
    {
      name: 'a loop item becomes the iteration variable',
      source: 'loop.item.number',
      scope: scope({ iterating: true }),
      text: 'item.number',
    },
    {
      name: "a loop's own item name resolves too",
      source: 'issue.title',
      scope: scope({ iterating: true, itemVariable: 'issue' }),
      text: 'item.title',
    },
    {
      name: 'a variable resolves to the node that set it',
      source: 'variables.threadId',
      scope: scope({ vars: { threadId: 'set_thread' } }),
      text: 'nodes.set_thread.output.threadId',
    },
    {
      name: 'a declared constant resolves to the constants node',
      source: 'variables.reworkTier < config.maxLoops',
      scope: scope({ vars: { reworkTier: 'tier' } }),
      text: 'nodes.tier.output.reworkTier < nodes.constants.output.maxLoops',
    },
    {
      name: 'a sibling iterating the same list is read by index',
      source: 'steps.fetch_diff.output.data.result.data',
      scope: scope({
        steps: { fetch_diff: 'integration' },
        iterating: true,
        perItemOutputs: new Set(['fetch_diff']),
      }),
      text: 'nodes.fetch_diff.output[index]',
      issues: [/connector actions now return their own shape/],
    },
    {
      name: 'member access stays null-tolerant',
      source: 'steps.get_task.output.data.task.labels',
      scope: scope({ steps: { get_task: 'data' } }),
      text: 'nodes.get_task.output?.task?.labels',
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = translateExpression(testCase.source, testCase.scope);
      expect(result.text).toBe(testCase.text);
      for (const issue of testCase.issues ?? []) {
        expect(result.issues.join('\n')).toMatch(issue);
      }
      if (testCase.issues === undefined) expect(result.issues).toEqual([]);
    });
  }
});

describe('pipe transforms are translated only where the result is reproducible', () => {
  const translated: Array<[string, string]> = [
    ['items | length', '(items || []).length'],
    ['items|first', '(items || [])[0]'],
    ["labels | map('name')", '(labels || []).map((entry) => entry?.name)'],
    ["parts|join(', ')", "(parts || []).join(', ')"],
    ['a|concat(b)', '(a || []).concat(b)'],
    ['tags|unique', '[...new Set(tags || [])]'],
    ['rows|flatten', '(rows || []).flat()'],
    ['version|string', "String(version ?? '')"],
  ];

  for (const [source, expected] of translated) {
    it(`translates ${source}`, () => {
      // The identifiers are unknown roots on purpose: this asserts the shape
      // of the transform, not the rooting.
      const result = translateExpression(source, scope());
      expect(result.text).toContain(expected);
    });
  }

  const flagged = [
    'at|isoDate',
    'at|epochSeconds',
    'a|hasOverlap(b)',
    'a|nope',
  ];
  for (const source of flagged) {
    it(`refuses to guess ${source}`, () => {
      const result = translateExpression(source, scope());
      expect(result.issues.join('\n')).toMatch(
        /has no equivalent whose result can be reproduced exactly/,
      );
      // The author's own text survives so the fix is obvious.
      expect(result.text).toContain(source.slice(source.indexOf('|') + 1));
    });
  }
});

describe('constructs that cannot be translated are reported, never rewritten', () => {
  it('flags the membership operator instead of emitting the JavaScript one', () => {
    const result = translateExpression(
      "'yes' in steps.judge.output.data",
      scope({ steps: { judge: 'llm-text' } }),
    );
    expect(result.issues.join('\n')).toMatch(/"in" operator has no equivalent/);
  });

  it('flags the clock', () => {
    const result = translateExpression('now', scope());
    expect(result.issues.join('\n')).toMatch(/"now" is not available/);
  });

  it('flags secrets', () => {
    const result = translateExpression('secrets.API_TOKEN', scope());
    expect(result.issues.join('\n')).toMatch(/secrets are injected/);
  });

  it('flags an item read outside iteration', () => {
    const result = translateExpression('loop.item.id', scope());
    expect(result.issues.join('\n')).toMatch(
      /only in scope on a node that iterates/,
    );
  });

  it('flags a reference to a step that has no node', () => {
    const result = translateExpression('steps.gone.output.data', scope());
    expect(result.issues.join('\n')).toMatch(
      /has no node in the converted document/,
    );
  });

  it('flags an expression it cannot read and keeps the original text', () => {
    const result = translateExpression('items[.active == true]', scope());
    expect(result.text).toBe('items[.active == true]');
    expect(result.issues.join('\n')).toMatch(/could not be read/);
  });

  it('flags an unknown reference root', () => {
    const result = translateExpression('mystery.value', scope());
    expect(result.issues.join('\n')).toMatch(
      /is not one of the values an expression can read/,
    );
  });
});

describe('literal text keeps its meaning across the two grammars', () => {
  it('escapes a real newline inside a string literal', () => {
    const result = translateExpression("'first' + '\n\n' + 'second'", scope());
    expect(result.text).toBe("'first' + '\\n\\n' + 'second'");
    expect(result.issues).toEqual([]);
  });

  it('escapes a backslash that stood for itself', () => {
    const result = translateExpression(String.raw`'a\nb'`, scope());
    expect(result.text).toBe(String.raw`'a\\nb'`);
  });
});

describe('templates keep the text around their expressions', () => {
  it('rewrites every span and leaves the rest alone', () => {
    const result = translateTemplate(
      'Issue #{{loop.item.number}}: {{loop.item.title}}',
      scope({ iterating: true }),
    );
    expect(result.text).toBe('Issue #{{ item.number }}: {{ item.title }}');
  });

  it('reads an unescaped span the same way', () => {
    const result = translateTemplate('{{{ input.body }}}', scope());
    expect(result.text).toBe('{{ input.body }}');
  });

  it('leaves a plain string untouched', () => {
    const result = translateTemplate('no expressions here', scope());
    expect(result.text).toBe('no expressions here');
    expect(result.issues).toEqual([]);
  });
});
