import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { nodeVmRunner } from '../../runners/node-vm';
import { memoryStore } from '../../store/memory';
import { registerNodeType, setCodeRunner, setStoreAdapter } from '../slots';
import type { Issue, NodeDef, Workflow } from '../types';
import { validate } from './index';

beforeAll(() => {
  registerNodeType({
    type: 'weather.current',
    kind: 'integration',
    outputKind: 'structured',
    description: 'test connector: current weather',
    allowedFields: ['input'],
    requiredFields: ['input'],
    integration: {
      name: 'weather.current',
      description: 'current weather for a city',
      inputSchema: {
        type: 'object',
        properties: {
          city: { type: 'string' },
          units: { type: 'string', enum: ['metric', 'imperial'] },
          days: { type: 'integer' },
        },
        required: ['city'],
        additionalProperties: false,
      },
      outputSignature: '{ tempC: number }',
      hasEffect: false,
      mock: () => ({ tempC: 21 }),
    },
  });
  registerNodeType({
    type: 'web.fetch_text',
    kind: 'integration',
    outputKind: 'unstructured',
    description: 'test connector: fetch a page as text',
    allowedFields: ['input'],
    requiredFields: ['input'],
    integration: {
      name: 'web.fetch_text',
      description: 'fetch a page as plain text',
      inputSchema: {
        type: 'object',
        properties: { url: { type: 'string' } },
        required: ['url'],
        additionalProperties: false,
      },
      outputSignature: '{ text: string }',
      hasEffect: false,
      mock: () => ({ text: 'page text' }),
    },
  });
  registerNodeType({
    type: 'notes.append',
    kind: 'integration',
    outputKind: 'structured',
    description: 'test connector: appends a note',
    allowedFields: ['input'],
    requiredFields: ['input'],
    integration: {
      name: 'notes.append',
      description: 'append a note',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: false,
      },
      outputSignature: '{ id: string }',
      hasEffect: true,
      mock: () => ({ id: 'note_1' }),
    },
  });
});

beforeEach(() => {
  setCodeRunner(nodeVmRunner());
  const store = memoryStore();
  const noop: Workflow = {
    version: 1,
    name: 'send-digest',
    nodes: [{ id: 'noop', type: 'transform', code: 'return input;' }],
  };
  store.save('send-digest', noop);
  store.save('send-digest', noop);
  store.save('weekly-report', { ...noop, name: 'weekly-report' });
  setStoreAdapter(store);
});

function wf(nodes: NodeDef[], extra: Partial<Workflow> = {}): Workflow {
  return { version: 1, name: 'test-flow', nodes, ...extra };
}

const codesOf = (issues: Issue[]) => issues.map((i) => i.code);

describe('a realistic valid document', () => {
  it('validates a 5-node workflow with zero issues', async () => {
    const doc = wf(
      [
        {
          id: 'fetch',
          type: 'weather.current',
          input: { city: '{{ input.city }}' },
        },
        {
          id: 'summarize',
          type: 'llm',
          model: 'test-model',
          prompt: 'Summarize {{ nodes.fetch.output }} for {{ input.city }}',
          outputSchema: {
            type: 'object',
            properties: { headline: { type: 'string' } },
          },
        },
        {
          id: 'format',
          type: 'transform',
          input: { headline: '{{ nodes.summarize.output.headline }}' },
          code: 'return { text: input.headline.toUpperCase() };',
        },
        {
          id: 'notify',
          type: 'notes.append',
          input: { text: '{{ nodes.format.output.text }}' },
        },
        {
          id: 'archive',
          type: 'subworkflow',
          workflow: 'send-digest@2',
          input: { digest: '{{ nodes.format.output.text }}' },
        },
      ],
      {
        inputs: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
        output: '{{ nodes.format.output.text }}',
      },
    );
    await expect(validate(doc)).resolves.toEqual({ errors: [], warnings: [] });
  });

  it('is idempotent across repeated runs of the same document (schema $id reuse)', async () => {
    const doc = wf([{ id: 'main', type: 'transform', code: 'return 1;' }], {
      inputs: { $id: 'https://tale.test/wf-inputs', type: 'object' },
      output: '{{ nodes.main.output }}',
    });
    const first = await validate(doc);
    const second = await validate(doc);
    expect(first.errors).toEqual([]);
    expect(second.errors).toEqual([]);
  });
});

describe('document shape', () => {
  it('rejects non-object documents', async () => {
    for (const doc of [42, 'flow', null, ['nodes']]) {
      const { errors } = await validate(doc);
      expect(codesOf(errors)).toEqual(['WF_NOT_OBJECT']);
    }
  });

  it('flags every credential pattern, but never ordinary prose', async () => {
    const pem = ['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' ');
    const secrets = [
      'xoxb-0000000000-0000000000',
      'ghp_00000000000000000000',
      'AKIA000000000000',
      pem,
    ];
    for (const secret of secrets) {
      const { errors } = await validate(
        wf(
          [
            {
              id: 'main',
              type: 'llm',
              model: 'test-model',
              prompt: `use ${secret}`,
            },
          ],
          { output: '{{ nodes.main.output.text }}' },
        ),
      );
      expect(codesOf(errors)).toContain('SECRET_IN_DOCUMENT');
    }

    const prose = wf(
      [
        {
          id: 'main',
          type: 'llm',
          model: 'test-model',
          prompt:
            'Ask the user for their API key and never store it. The risk-assessment task-force meets today; Bearer of good news welcome.',
        },
      ],
      { output: '{{ nodes.main.output.text }}' },
    );
    const { errors } = await validate(prose);
    expect(codesOf(errors)).not.toContain('SECRET_IN_DOCUMENT');
  });

  it('does not flag template values under credential-named keys', async () => {
    const doc = wf(
      [
        {
          id: 'main',
          type: 'transform',
          input: { token: '{{ input.token }}' },
          code: 'return input.token;',
        },
      ],
      { output: '{{ nodes.main.output }}' },
    );
    const { errors } = await validate(doc);
    expect(codesOf(errors)).not.toContain('SECRET_IN_DOCUMENT');
  });
});

describe('references', () => {
  it('suggests the closest node id on unknown references', async () => {
    const doc = wf(
      [
        { id: 'fetch', type: 'transform', code: 'return 1;' },
        {
          id: 'main',
          type: 'transform',
          code: 'return nodes.fetch.output + nodes.fetc.output;',
        },
      ],
      { output: '{{ nodes.main.output }}' },
    );
    const { errors } = await validate(doc);
    const issue = errors.find((i) => i.code === 'REF_UNKNOWN_NODE');
    expect(issue?.hint).toContain('did you mean "fetch"?');
  });

  it('accepts a diamond dependency shape (no false cycle)', async () => {
    const doc = wf(
      [
        { id: 'a', type: 'transform', code: 'return 1;' },
        { id: 'b', type: 'transform', code: 'return nodes.a.output + 1;' },
        { id: 'c', type: 'transform', code: 'return nodes.a.output + 2;' },
        {
          id: 'd',
          type: 'transform',
          code: 'return nodes.b.output + nodes.c.output;',
        },
      ],
      { output: '{{ nodes.d.output }}' },
    );
    const { errors } = await validate(doc);
    expect(codesOf(errors)).not.toContain('REF_CYCLE');
  });

  it('names the cycle path, including cycles through control-flow fields', async () => {
    const doc = wf(
      [
        {
          id: 'a',
          type: 'transform',
          code: 'return 1;',
          when: '{{ nodes.c.output }}',
        },
        { id: 'b', type: 'transform', code: 'return nodes.a.output;' },
        { id: 'c', type: 'transform', code: 'return nodes.b.output;' },
      ],
      { output: '{{ nodes.c.output }}' },
    );
    const { errors } = await validate(doc);
    const cycle = errors.find((i) => i.code === 'REF_CYCLE');
    // The path walks dependency edges: a reads c, c reads b, b reads a.
    expect(cycle?.message).toBe(
      'circular reference between nodes: a → c → b → a',
    );
  });

  it("allows reading the node's own output in repeatUntil", async () => {
    const doc = wf(
      [
        {
          id: 'main',
          type: 'transform',
          code: 'return 1;',
          repeatUntil: '{{ nodes.main.output === 1 }}',
        },
      ],
      { output: '{{ nodes.main.output }}' },
    );
    const { errors } = await validate(doc);
    expect(codesOf(errors)).not.toContain('REF_SELF');
    expect(codesOf(errors)).not.toContain('REF_CYCLE');
  });

  it('accepts item/index under forEach and does not confuse input.index with the loop variable', async () => {
    const doc = wf(
      [
        { id: 'list', type: 'transform', code: 'return [1, 2];' },
        {
          id: 'each',
          type: 'llm',
          model: 'test-model',
          prompt: 'Item {{ item }} at {{ index }} (page {{ input.index }})',
          forEach: '{{ nodes.list.output }}',
        },
      ],
      { output: '{{ nodes.each.output }}' },
    );
    const { warnings } = await validate(doc);
    expect(codesOf(warnings)).not.toContain('ITEM_WITHOUT_FOREACH');
  });

  it('warns on index without forEach', async () => {
    const doc = wf(
      [
        {
          id: 'main',
          type: 'llm',
          model: 'test-model',
          prompt: 'At {{ index }}',
        },
      ],
      { output: '{{ nodes.main.output.text }}' },
    );
    const { warnings } = await validate(doc);
    expect(codesOf(warnings)).toContain('ITEM_WITHOUT_FOREACH');
  });

  it('stays silent on input keys when the schema is open or absent', async () => {
    const node: NodeDef = {
      id: 'main',
      type: 'llm',
      model: 'test-model',
      prompt: 'Weather for {{ input.town }}',
    };
    const open = wf([node], {
      inputs: {
        type: 'object',
        properties: { city: { type: 'string' } },
        additionalProperties: true,
      },
      output: '{{ nodes.main.output.text }}',
    });
    const bare = wf([node], { output: '{{ nodes.main.output.text }}' });
    expect(codesOf((await validate(open)).warnings)).not.toContain(
      'INPUT_KEY_UNKNOWN',
    );
    expect(codesOf((await validate(bare)).warnings)).not.toContain(
      'INPUT_KEY_UNKNOWN',
    );
  });

  it('does not check transform-code input keys against the workflow inputs schema', async () => {
    // In code, `input` is the node's own input mapping — not the run input.
    const doc = wf(
      [
        {
          id: 'main',
          type: 'transform',
          input: { headline: 'static' },
          code: 'return input.headline;',
        },
      ],
      {
        inputs: { type: 'object', properties: { city: { type: 'string' } } },
        output: '{{ nodes.main.output }}',
      },
    );
    const { warnings } = await validate(doc);
    expect(codesOf(warnings)).not.toContain('INPUT_KEY_UNKNOWN');
  });
});

describe('contracts', () => {
  it('skips value checks on template-valued fields, keeps them on literals', async () => {
    const templated = wf(
      [
        {
          id: 'w',
          type: 'weather.current',
          input: { city: '{{ input.city }}', units: '{{ input.units }}' },
        },
      ],
      { output: '{{ nodes.w.output }}' },
    );
    expect(codesOf((await validate(templated)).errors)).not.toContain(
      'INTEGRATION_INPUT_INVALID',
    );

    const literal = wf(
      [{ id: 'w', type: 'weather.current', input: { city: 42 } }],
      { output: '{{ nodes.w.output }}' },
    );
    const { errors } = await validate(literal);
    expect(codesOf(errors)).toContain('INTEGRATION_INPUT_INVALID');
  });

  it('always reports missing required integration fields', async () => {
    const doc = wf(
      [{ id: 'w', type: 'weather.current', input: { units: 'metric' } }],
      { output: '{{ nodes.w.output }}' },
    );
    const { errors } = await validate(doc);
    const issue = errors.find((i) => i.code === 'INTEGRATION_INPUT_INVALID');
    expect(issue?.message).toContain("must have required property 'city'");
  });

  it('treats an llm node with outputSchema as structured', async () => {
    const doc = wf(
      [
        {
          id: 'gen',
          type: 'llm',
          model: 'test-model',
          prompt: 'Summarize',
          outputSchema: {
            type: 'object',
            properties: { summary: { type: 'string' } },
          },
        },
        {
          id: 'main',
          type: 'transform',
          code: 'return nodes.gen.output.summary;',
        },
      ],
      { output: '{{ nodes.main.output }}' },
    );
    const { errors } = await validate(doc);
    expect(codesOf(errors)).not.toContain('REF_UNSTRUCTURED_PATH');
  });

  it('allows .output.text on unstructured nodes and rejects other paths', async () => {
    const nodes: NodeDef[] = [
      { id: 'gen', type: 'llm', model: 'test-model', prompt: 'Summarize' },
      { id: 'main', type: 'transform', code: 'return nodes.gen.output.text;' },
    ];
    expect(
      codesOf(
        (await validate(wf(nodes, { output: '{{ nodes.main.output }}' })))
          .errors,
      ),
    ).not.toContain('REF_UNSTRUCTURED_PATH');

    const bad = wf(
      [
        {
          id: 'page',
          type: 'web.fetch_text',
          input: { url: 'https://example.com' },
        },
        {
          id: 'main',
          type: 'transform',
          code: 'return nodes.page.output.title;',
        },
      ],
      { output: '{{ nodes.main.output }}' },
    );
    const { errors } = await validate(bad);
    const issue = errors.find((i) => i.code === 'REF_UNSTRUCTURED_PATH');
    expect(issue?.hint).toContain(
      'bridge through an llm node with an outputSchema',
    );
  });

  it('exempts effectful integrations, elseOf partners, and the final node from UNUSED_NODE', async () => {
    const doc = wf(
      [
        // Effectful: exempt even though nobody reads it.
        { id: 'notify', type: 'notes.append', input: { text: 'hi' } },
        // elseOf partner: structurally load-bearing.
        {
          id: 'gate',
          type: 'transform',
          code: 'return 1;',
          when: '{{ input.go }}',
        },
        {
          id: 'fallback',
          type: 'transform',
          code: 'return 2;',
          elseOf: 'gate',
        },
        // Genuinely dead.
        { id: 'stale', type: 'transform', code: 'return 3;' },
        // Final node: conventionally feeds the output.
        { id: 'main', type: 'transform', code: 'return 4;' },
      ],
      { output: 'done' },
    );
    const { warnings } = await validate(doc);
    const unused = warnings.filter((i) => i.code === 'UNUSED_NODE');
    expect(unused.map((i) => i.nodeId)).toEqual(['fallback', 'stale']);
  });
});

describe('degrading without optional backends', () => {
  it('skips syntax checks silently when no runner is installed', async () => {
    setCodeRunner(null as never);
    const doc = wf(
      [
        {
          id: 'main',
          type: 'transform',
          code: 'return nodes.ghost.output +;',
          when: '{{ (( }}',
        },
      ],
      { output: '{{ nodes.main.output }}' },
    );
    const { errors } = await validate(doc);
    expect(codesOf(errors)).not.toContain('CODE_SYNTAX');
    expect(codesOf(errors)).not.toContain('EXPR_SYNTAX');
    // Pure reference checks still run.
    expect(codesOf(errors)).toContain('REF_UNKNOWN_NODE');
  });

  it('skips subworkflow resolution without a store, but still checks the reference syntax', async () => {
    setStoreAdapter(null as never);
    const doc = wf(
      [
        { id: 'ok', type: 'subworkflow', workflow: 'ghost-flow' },
        { id: 'bad', type: 'subworkflow', workflow: 'Ghost Flow@next' },
      ],
      { output: '{{ nodes.bad.output }}' },
    );
    const { errors } = await validate(doc);
    expect(codesOf(errors)).not.toContain('SUBWORKFLOW_NOT_FOUND');
    expect(codesOf(errors)).toContain('SUBWORKFLOW_REF_INVALID');
  });

  it('survives a store whose list() rejects', async () => {
    setStoreAdapter({
      list: async () => {
        throw new Error('backend down');
      },
      get: async () => null,
      deployedVersion: async () => null,
    });
    const doc = wf(
      [{ id: 'sub', type: 'subworkflow', workflow: 'ghost-flow' }],
      { output: '{{ nodes.sub.output }}' },
    );
    const { errors } = await validate(doc);
    expect(codesOf(errors)).not.toContain('SUBWORKFLOW_NOT_FOUND');
  });
});
