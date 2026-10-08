// @vitest-environment node

import { describe, expect, it } from 'vitest';

import type { Automation, Issue, NodeDef } from '../../types';
import { validate } from '../../validate';

function t(id: string, extra: Partial<NodeDef> = {}): NodeDef {
  return {
    id,
    type: 'transform',
    code: 'return { ok: true, text: "x" };',
    ...extra,
  };
}

/** A node that reads `from` as data. */
function reads(
  id: string,
  from: string,
  extra: Partial<NodeDef> = {},
): NodeDef {
  return t(id, { input: { v: `{{ nodes.${from}.output }}` }, ...extra });
}

function doc(nodes: NodeDef[], output: unknown): Automation {
  return { version: 1, name: 'flow-probe', nodes, output };
}

async function issues(d: Automation, ...codes: string[]): Promise<Issue[]> {
  const { errors, warnings } = await validate(d);
  return [...errors, ...warnings].filter((i) => codes.includes(i.code));
}

const NULL_CODES = ['MAYBE_NULL', 'UNCAUGHT_FAILURE'];

describe('MAYBE_NULL', () => {
  const gated = t('check', { when: '{{ input.go }}' });

  it('a condition that reads a field of a node skipped by its own when', async () => {
    const [issue] = await issues(
      doc(
        [gated, t('next', { when: '{{ nodes.check.output.ok }}' })],
        '{{ nodes.next.output ?? null }}',
      ),
      ...NULL_CODES,
    );
    expect(issue).toMatchObject({
      code: 'MAYBE_NULL',
      nodeId: 'next',
      at: { pointer: '/nodes/1/when', range: [3, 24] },
      params: {
        field: 'when',
        source: 'check',
        reasons: ['when'],
        suggestion: 'nodes.check.output?.ok ?? false',
      },
      related: [{ role: 'source', nodeId: 'check' }],
    });
    expect(issue.message).toContain('fails with a TypeError');
  });

  it.each([
    '{{ nodes.check.output?.ok }}',
    '{{ nodes.check.output && nodes.check.output.ok }}',
    '{{ nodes.check.output ? nodes.check.output.ok : false }}',
    '{{ !nodes.check.output || nodes.check.output.ok }}',
    '{{ nodes.check.output }}',
  ])('a guarded read is fine: %j', async (when) => {
    const found = await issues(
      doc([gated, t('next', { when })], '{{ nodes.next.output ?? null }}'),
      ...NULL_CODES,
    );
    expect(found).toEqual([]);
  });

  it('?? after a member read is no guard — the read throws first', async () => {
    const [issue] = await issues(
      doc(
        [gated, t('next', { when: '{{ nodes.check.output.ok ?? false }}' })],
        '{{ nodes.next.output ?? null }}',
      ),
      ...NULL_CODES,
    );
    expect(issue.code).toBe('MAYBE_NULL');
  });

  it('the output: skipped by an upstream node, and by an elseOf partner', async () => {
    const found = await issues(
      doc(
        [gated, reads('later', 'check'), t('fallback', { elseOf: 'check' })],
        {
          a: '{{ nodes.later.output.ok }}',
          b: '{{ nodes.fallback.output.text }}',
        },
      ),
      ...NULL_CODES,
    );
    expect(found.map((i) => [i.at?.pointer, i.params])).toEqual([
      [
        '/output/a',
        expect.objectContaining({ reasons: ['upstream'], via: 'check' }),
      ],
      [
        '/output/b',
        expect.objectContaining({ reasons: ['else'], partner: 'check' }),
      ],
    ]);
    expect(found[0].message).toContain('building the output then fails');
  });

  it('merged alternatives read in the output are fine', async () => {
    const found = await issues(
      doc([gated, t('fallback', { elseOf: 'check' })], {
        text: '{{ nodes.check.output ? nodes.check.output.text : nodes.fallback.output.text }}',
        also: '{{ nodes.check.output?.text ?? nodes.fallback.output?.text }}',
      }),
      ...NULL_CODES,
    );
    expect(found).toEqual([]);
  });

  it('a skipped output placed whole inside text', async () => {
    const [issue] = await issues(
      doc([t('base'), gated], {
        base: '{{ nodes.base.output }}',
        line: 'Result: {{ nodes.check.output }}',
      }),
      ...NULL_CODES,
    );
    expect(issue.params).toMatchObject({
      suggestion: "nodes.check.output ?? ''",
    });
  });

  it('a reader that needs the node for data only ever sees it run', async () => {
    const found = await issues(
      doc(
        [
          gated,
          reads('next', 'check', { when: '{{ nodes.check.output.ok }}' }),
        ],
        '{{ nodes.next.output ?? null }}',
      ),
      ...NULL_CODES,
    );
    expect(found).toEqual([]);
  });

  it('beyond the enumerated paths the structure still finds it', async () => {
    const gates = Array.from({ length: 13 }, (_, i) =>
      t(`g${i}`, { when: `{{ input.g${i} }}` }),
    );
    const found = await issues(
      doc(gates, { last: '{{ nodes.g12.output.ok }}' }),
      ...NULL_CODES,
    );
    expect(found.map((i) => i.code)).toEqual(['MAYBE_NULL']);
  });
});

describe('UNCAUGHT_FAILURE', () => {
  it('a tolerated failure read in the output', async () => {
    const [issue] = await issues(
      doc([t('base'), t('fetch', { onError: 'continue' })], {
        base: '{{ nodes.base.output }}',
        rows: '{{ nodes.fetch.output.rows }}',
      }),
      ...NULL_CODES,
    );
    expect(issue).toMatchObject({
      code: 'UNCAUGHT_FAILURE',
      params: { source: 'fetch', failing: 'fetch', reasons: ['error'] },
      related: [
        { role: 'source', nodeId: 'fetch' },
        { role: 'cause', nodeId: 'fetch' },
      ],
    });
  });

  it('a node skipped because an upstream node failed', async () => {
    const [issue] = await issues(
      doc(
        [
          t('base'),
          t('fetch', { onError: 'continue' }),
          reads('shape', 'fetch'),
        ],
        { base: '{{ nodes.base.output }}', n: '{{ nodes.shape.output.ok }}' },
      ),
      ...NULL_CODES,
    );
    expect(issue.params).toMatchObject({ source: 'shape', failing: 'fetch' });
    expect(issue.message).toContain('skipped when "fetch" fails');
  });
});

describe('UNREACHABLE', () => {
  async function causes(nodes: NodeDef[]): Promise<unknown[]> {
    const found = await issues(doc(nodes, null), 'UNREACHABLE');
    return found.map((i) => [i.nodeId, i.params?.cause, i.at?.pointer]);
  }

  it('a when that is always false', async () => {
    expect(await causes([t('a', { when: '{{ 1 > 2 }}' })])).toEqual([
      ['a', 'constant-when', '/nodes/0/when'],
    ]);
  });

  it('an elseOf partner that always runs, or never does', async () => {
    expect(
      await causes([
        t('always', { when: '{{ true }}' }),
        t('alt', { elseOf: 'always' }),
      ]),
    ).toEqual([['alt', 'else-partner-always-runs', '/nodes/1']]);
    expect(
      await causes([
        t('never', { when: '{{ false }}' }),
        reads('gated', 'never', { when: '{{ input.go }}' }),
        t('alt', { elseOf: 'gated' }),
      ]),
    ).toEqual([
      ['never', 'constant-when', '/nodes/0/when'],
      ['gated', 'upstream-unreachable', '/nodes/1'],
      ['alt', 'else-partner-unreachable', '/nodes/2'],
    ]);
  });

  it('a branch that reads its own partner', async () => {
    expect(
      await causes([
        t('a', { when: '{{ input.go }}' }),
        reads('b', 'a', { elseOf: 'a' }),
      ]),
    ).toEqual([['b', 'reads-partner', '/nodes/1']]);
  });

  it('a node that reads both of two exclusive branches', async () => {
    expect(
      await causes([
        t('a', { when: '{{ input.go }}' }),
        t('b', { elseOf: 'a' }),
        t('both', {
          input: { a: '{{ nodes.a.output }}', b: '{{ nodes.b.output }}' },
        }),
      ]),
    ).toEqual([['both', 'exclusive-branches', '/nodes/2']]);
  });

  it('no finding while every node can run', async () => {
    expect(
      await causes([
        t('a', { when: '{{ input.go }}' }),
        t('b', { elseOf: 'a' }),
      ]),
    ).toEqual([]);
  });
});

describe('OUTPUT_MAYBE_EMPTY', () => {
  async function empty(nodes: NodeDef[], output: unknown) {
    return issues(doc(nodes, output), 'OUTPUT_MAYBE_EMPTY');
  }

  it.each<[string, NodeDef[], string, string]>([
    ['its own when', [t('a', { when: '{{ input.go }}' })], 'a', 'when'],
    [
      'its partner running',
      [t('a', { when: '{{ input.go }}' }), t('b', { elseOf: 'a' })],
      'a',
      'else',
    ],
    ['a tolerated failure', [t('a', { onError: 'continue' })], 'a', 'error'],
  ])('empty when %s', async (_, nodes, root, rootReason) => {
    const reader = nodes.at(-1)?.id ?? '';
    const [issue] = await empty(nodes, `{{ nodes.${reader}.output ?? null }}`);
    expect(issue.params).toMatchObject({ root, rootReason });
  });

  it('two exclusive branches merged in the output always give one', async () => {
    expect(
      await empty(
        [t('a', { when: '{{ input.go }}' }), t('b', { elseOf: 'a' })],
        '{{ nodes.a.output ?? nodes.b.output }}',
      ),
    ).toEqual([]);
  });
});

describe('UNUSED_NODE read only by nodes that never run', () => {
  it('names the readers', async () => {
    const found = await issues(
      doc(
        [t('prep'), reads('never', 'prep', { when: '{{ false }}' }), t('main')],
        '{{ nodes.main.output }}',
      ),
      'UNUSED_NODE',
    );
    expect(found.map((i) => [i.nodeId, i.params?.reason])).toEqual([
      ['never', 'unread'],
      ['prep', 'readers-unreachable'],
    ]);
  });
});

describe('OUTPUT_MAYBE_EMPTY and fallbacks', () => {
  const gated = [t('a', { when: '{{ input.go }}' })];

  it('a real fallback keeps the output from being empty', async () => {
    expect(
      await issues(
        doc(gated, {
          text: "{{ nodes.a.output?.text ?? 'nothing to report' }}",
        }),
        'OUTPUT_MAYBE_EMPTY',
      ),
    ).toEqual([]);
  });

  it.each(['null', "''", '[]', '{}', 'undefined'])(
    'an empty fallback (?? %s) still empties it',
    async (fallback) => {
      const found = await issues(
        doc(gated, { text: `{{ nodes.a.output?.text ?? ${fallback} }}` }),
        'OUTPUT_MAYBE_EMPTY',
      );
      expect(found).toHaveLength(1);
    },
  );
});
