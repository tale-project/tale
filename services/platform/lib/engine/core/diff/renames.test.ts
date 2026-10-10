// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  canonicalBody,
  findRenames,
  MAX_RENAME_TRIALS,
  nodeReferences,
  outputReferences,
  renamesRead,
  rewriteNode,
  rewriteReferences,
} from './renames';

const RENAME = new Map([['old', 'fresh']]);

/** The text of `prompt` once every reference to `old` reads `fresh`. */
function rewrittenPrompt(prompt: string): unknown {
  const node = { id: 'a', type: 'llm', prompt };
  const out = rewriteNode(node, nodeReferences(node), RENAME);
  return out === null ? null : out.prompt;
}

describe('rewriting references', () => {
  it('rewrites the id in every spelling of a reference', () => {
    expect(rewrittenPrompt('{{ nodes.old.output }}')).toBe(
      '{{ nodes.fresh.output }}',
    );
    expect(rewrittenPrompt('{{ nodes?.old?.output }}')).toBe(
      '{{ nodes?.fresh?.output }}',
    );
    expect(rewrittenPrompt("{{ nodes['old'].output }}")).toBe(
      "{{ nodes['fresh'].output }}",
    );
    expect(rewrittenPrompt('{{ nodes?.["old"].output }}')).toBe(
      '{{ nodes?.["fresh"].output }}',
    );
    expect(rewrittenPrompt('{{ nodes[`old`].output }}')).toBe(
      '{{ nodes[`fresh`].output }}',
    );
    expect(rewrittenPrompt('{{ nodes /* why */ . old . output }}')).toBe(
      '{{ nodes /* why */ . fresh . output }}',
    );
  });

  it('rewrites every reference of a field and nothing else', () => {
    expect(
      rewrittenPrompt(
        'nodes.old says {{ nodes.old.output.a }} and {{ nodes.other.output + nodes.old.output.b }}',
      ),
    ).toBe(
      'nodes.old says {{ nodes.fresh.output.a }} and {{ nodes.other.output + nodes.fresh.output.b }}',
    );
  });

  it('leaves comments, strings, keys and shadowing locals alone', () => {
    const node = {
      id: 'a',
      type: 'transform',
      code: [
        '// nodes.old is read below',
        'const label = "nodes.old";',
        'const shape = { nodes: 1, old: 2 };',
        'const list = [1].map((nodes) => nodes.old);',
        'return nodes.old.output;',
      ].join('\n'),
    };
    const out = rewriteNode(node, nodeReferences(node), RENAME);
    expect(out?.code).toBe(
      [
        '// nodes.old is read below',
        'const label = "nodes.old";',
        'const shape = { nodes: 1, old: 2 };',
        'const list = [1].map((nodes) => nodes.old);',
        'return nodes.fresh.output;',
      ].join('\n'),
    );
  });

  it('rewrites an id named like a keyword', () => {
    const node = { id: 'a', type: 'llm', prompt: '{{ nodes.new.output }}' };
    const out = rewriteNode(
      node,
      nodeReferences(node),
      new Map([['new', 'created']]),
    );
    expect(out?.prompt).toBe('{{ nodes.created.output }}');
  });

  it('refuses an id spelled through an escape, rather than guess', () => {
    expect(rewrittenPrompt('{{ nodes.\\u006fld.output }}')).toBeNull();
    expect(rewrittenPrompt("{{ nodes['\\x6fld'].output }}")).toBeNull();
  });

  it('refuses a new id the old spelling cannot hold', () => {
    const node = { id: 'a', type: 'llm', prompt: '{{ nodes.old.output }}' };
    expect(
      rewriteNode(node, nodeReferences(node), new Map([['old', 'new-id']])),
    ).toBeNull();
    const bracket = {
      id: 'a',
      type: 'llm',
      prompt: "{{ nodes['old'].output }}",
    };
    expect(
      rewriteNode(
        bracket,
        nodeReferences(bracket),
        new Map([['old', 'new-id']]),
      )?.prompt,
    ).toBe("{{ nodes['new-id'].output }}");
  });

  it('rewrites the references of a draft whose code does not parse yet', () => {
    expect(rewrittenPrompt('{{ nodes.old.output.( }}')).toBe(
      '{{ nodes.fresh.output.( }}',
    );
  });

  it('reaches into input and files, conditions and elseOf', () => {
    const node = {
      id: 'a',
      type: 'agent',
      input: { list: ['plain', '{{ nodes.old.output }}'] },
      files: { brief: '{{ nodes.old.output.path }}' },
      when: 'nodes.old.output.ok',
      forEach: '{{ nodes.old.output.items }}',
      repeatUntil: '{{ output.done || nodes.old.output.stop }}',
      elseOf: 'old',
    };
    const index = nodeReferences(node);
    expect([...index.reads]).toEqual(['old']);
    expect(rewriteNode(node, index, RENAME)).toEqual({
      id: 'a',
      type: 'agent',
      input: { list: ['plain', '{{ nodes.fresh.output }}'] },
      files: { brief: '{{ nodes.fresh.output.path }}' },
      when: 'nodes.fresh.output.ok',
      forEach: '{{ nodes.fresh.output.items }}',
      repeatUntil: '{{ output.done || nodes.fresh.output.stop }}',
      elseOf: 'fresh',
    });
    expect(renamesRead(index, RENAME, 'elseOf')).toEqual([
      { from: 'old', to: 'fresh' },
    ]);
    expect(renamesRead(index, RENAME, 'files')).toEqual([
      { from: 'old', to: 'fresh' },
    ]);
    expect(renamesRead(index, RENAME, 'prompt')).toEqual([]);
    // The node itself is left as it was.
    expect(node.input.list[1]).toBe('{{ nodes.old.output }}');
  });

  it('rewrites the document output at its own pointers', () => {
    const output = { total: '{{ nodes.old.output.n }}', fixed: 1 };
    const index = outputReferences(output);
    expect(rewriteReferences(output, index, RENAME)).toEqual({
      total: '{{ nodes.fresh.output.n }}',
      fixed: 1,
    });
    expect(
      rewriteReferences(
        '{{ nodes.old.output }}',
        outputReferences('{{ nodes.old.output }}'),
        RENAME,
      ),
    ).toBe('{{ nodes.fresh.output }}');
  });

  it('returns the value itself when it reads no renamed node', () => {
    const node = { id: 'a', type: 'llm', prompt: '{{ nodes.other.output }}' };
    expect(rewriteNode(node, nodeReferences(node), RENAME)).toBe(node);
  });
});

describe('findRenames', () => {
  const reader = (id: string, reads: string) => ({
    id,
    node: {
      id,
      type: 'transform',
      input: { x: `{{ nodes.${reads}.output }}` },
    },
  });

  it('pairs a node that only changed its id', () => {
    expect(
      findRenames(
        [{ id: 'old', node: { id: 'old', type: 'llm', prompt: 'Hi' } }],
        [{ id: 'fresh', node: { id: 'fresh', type: 'llm', prompt: 'Hi' } }],
      ),
    ).toEqual(new Map([['old', 'fresh']]));
  });

  it('never pairs nodes of another type or another body', () => {
    expect(
      findRenames(
        [{ id: 'old', node: { id: 'old', type: 'llm', prompt: 'Hi' } }],
        [
          { id: 'a', node: { id: 'a', type: 'agent', prompt: 'Hi' } },
          { id: 'b', node: { id: 'b', type: 'llm', prompt: 'Hello' } },
        ],
      ).size,
    ).toBe(0);
  });

  it('ignores ui when it compares bodies', () => {
    expect(
      findRenames(
        [
          {
            id: 'old',
            node: { id: 'old', type: 'llm', prompt: 'Hi', ui: { x: 1 } },
          },
        ],
        [{ id: 'fresh', node: { id: 'fresh', type: 'llm', prompt: 'Hi' } }],
      ),
    ).toEqual(new Map([['old', 'fresh']]));
  });

  it('pairs a reader once the node it reads is paired, in either order', () => {
    const removed = [
      reader('b', 'a'),
      { id: 'a', node: { id: 'a', type: 'llm', prompt: 'Hi' } },
    ];
    const added = [
      { id: 'a2', node: { id: 'a2', type: 'llm', prompt: 'Hi' } },
      reader('b2', 'a2'),
    ];
    expect(findRenames(removed, added)).toEqual(
      new Map([
        ['a', 'a2'],
        ['b', 'b2'],
      ]),
    );
  });

  it('takes the first match in order when several fit, the same every time', () => {
    const removed = [
      { id: 'x', node: { id: 'x', type: 'llm', prompt: 'Hi' } },
      { id: 'y', node: { id: 'y', type: 'llm', prompt: 'Hi' } },
    ];
    const added = [
      { id: 'p', node: { id: 'p', type: 'llm', prompt: 'Hi' } },
      { id: 'q', node: { id: 'q', type: 'llm', prompt: 'Hi' } },
    ];
    const first = findRenames(removed, added);
    expect(first).toEqual(
      new Map([
        ['x', 'p'],
        ['y', 'q'],
      ]),
    );
    expect(findRenames(removed, added)).toEqual(first);
  });

  it('stops trying past its budget and answers what it paired', () => {
    // Every node here shares one shape, so each removed node is tried
    // against every added one; only `z` has a match, the last one added.
    const misses = (count: number) =>
      Array.from({ length: count }, (_, at) => reader(`r${at}`, `gone${at}`));
    const added = [
      ...Array.from({ length: 47 }, (_, at) => reader(`n${at}`, `other${at}`)),
      reader('z2', 'keep'),
    ];
    expect(findRenames([...misses(10), reader('z', 'keep')], added)).toEqual(
      new Map([['z', 'z2']]),
    );
    // 47 misses spend 47 × 48 > MAX_RENAME_TRIALS trials before `z`'s turn.
    expect(47 * added.length).toBeGreaterThan(MAX_RENAME_TRIALS);
    expect(findRenames([...misses(47), reader('z', 'keep')], added).size).toBe(
      0,
    );
  });
});

describe('canonicalBody', () => {
  it('leaves out id and ui and sorts keys', () => {
    expect(
      canonicalBody({ type: 'llm', id: 'a', ui: { x: 1 }, prompt: 'Hi' }),
    ).toBe(canonicalBody({ prompt: 'Hi', type: 'llm', id: 'b' }));
  });
});
