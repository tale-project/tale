import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { nodeVmRunner } from '../../runners/node-vm';
import { memoryStore } from '../../store/memory';
import { registerNodeType, setCodeRunner, setStoreAdapter } from '../slots';
import type { Automation, Issue, NodeDef } from '../types';
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
  const noop: Automation = {
    version: 1,
    name: 'send-digest',
    nodes: [{ id: 'noop', type: 'transform', code: 'return input;' }],
  };
  store.save('send-digest', noop);
  store.save('send-digest', noop);
  store.save('weekly-report', { ...noop, name: 'weekly-report' });
  setStoreAdapter(store);
});

function automationDoc(
  nodes: NodeDef[],
  extra: Partial<Automation> = {},
): Automation {
  return { version: 1, name: 'test-flow', nodes, ...extra };
}

const codesOf = (issues: Issue[]) => issues.map((i) => i.code);

describe('a realistic valid document', () => {
  it('validates a 5-node automation with zero issues', async () => {
    const doc = automationDoc(
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
          type: 'subautomation',
          automation: 'send-digest@2',
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
    const doc = automationDoc(
      [{ id: 'main', type: 'transform', code: 'return 1;' }],
      {
        inputs: { $id: 'https://tale.test/automation-inputs', type: 'object' },
        output: '{{ nodes.main.output }}',
      },
    );
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
      expect(codesOf(errors)).toEqual(['AUTOMATION_NOT_OBJECT']);
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
        automationDoc(
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

    const prose = automationDoc(
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
    const doc = automationDoc(
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

describe('agent nodes', () => {
  it('accepts the full field surface', async () => {
    const doc = automationDoc(
      [
        {
          id: 'work',
          type: 'agent',
          model: 'test-model',
          prompt: 'Extract {{ input.quarter }}',
          system: 'Be precise.',
          harness: 'claude-code',
          skills: ['swiss-vat-return'],
          connectors: ['github'],
          files: { setup: '{{ input.setupFolderId }}' },
          input: { quarter: '{{ input.quarter }}' },
        },
      ],
      {
        inputs: {
          type: 'object',
          properties: {
            quarter: { type: 'string' },
            setupFolderId: { type: 'string' },
          },
        },
        output: '{{ nodes.work.output.text }}',
      },
    );
    const { errors } = await validate(doc);
    expect(errors).toEqual([]);
  });

  it('requires prompt and model', async () => {
    const { errors } = await validate(
      automationDoc([{ id: 'a', type: 'agent' }], {
        output: '{{ nodes.a.output.text }}',
      }),
    );
    expect(codesOf(errors)).toEqual([
      'NODE_MISSING_FIELD',
      'NODE_MISSING_FIELD',
    ]);
  });

  it('refuses outputSchema — the envelope is fixed', async () => {
    const { errors } = await validate(
      automationDoc(
        [
          {
            id: 'a',
            type: 'agent',
            model: 'm',
            prompt: 'p',
            outputSchema: { type: 'object' },
          },
        ],
        { output: '{{ nodes.a.output.text }}' },
      ),
    );
    expect(codesOf(errors)).toEqual(['NODE_UNKNOWN_FIELD']);
  });

  it('type-checks the capability lists and the files map', async () => {
    const { errors } = await validate(
      automationDoc(
        [
          {
            id: 'a',
            type: 'agent',
            model: 'm',
            prompt: 'p',
            skills: 'swiss-vat-return' as never,
            files: ['not', 'a', 'map'] as never,
          },
        ],
        { output: '{{ nodes.a.output.text }}' },
      ),
    );
    expect(codesOf(errors)).toEqual(['NODE_FIELD_TYPE', 'NODE_FIELD_TYPE']);
  });

  it('lets references path into the structured envelope', async () => {
    const doc = automationDoc(
      [
        { id: 'a', type: 'agent', model: 'm', prompt: 'p' },
        {
          id: 'b',
          type: 'transform',
          input: { files: '{{ nodes.a.output.files }}' },
          code: 'return input.files.length;',
        },
      ],
      { output: '{{ nodes.b.output }}' },
    );
    const { errors } = await validate(doc);
    expect(errors).toEqual([]);
  });
});

describe('references', () => {
  it('suggests the closest node id on unknown references', async () => {
    const doc = automationDoc(
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
    const doc = automationDoc(
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
    const doc = automationDoc(
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
    const doc = automationDoc(
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
    const doc = automationDoc(
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
    const doc = automationDoc(
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
    const open = automationDoc([node], {
      inputs: {
        type: 'object',
        properties: { city: { type: 'string' } },
        additionalProperties: true,
      },
      output: '{{ nodes.main.output.text }}',
    });
    const bare = automationDoc([node], {
      output: '{{ nodes.main.output.text }}',
    });
    expect(codesOf((await validate(open)).warnings)).not.toContain(
      'INPUT_KEY_UNKNOWN',
    );
    expect(codesOf((await validate(bare)).warnings)).not.toContain(
      'INPUT_KEY_UNKNOWN',
    );
  });

  it('does not check transform-code input keys against the automation inputs schema', async () => {
    // In code, `input` is the node's own input mapping — not the run input.
    const doc = automationDoc(
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
    const templated = automationDoc(
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

    const literal = automationDoc(
      [{ id: 'w', type: 'weather.current', input: { city: 42 } }],
      { output: '{{ nodes.w.output }}' },
    );
    const { errors } = await validate(literal);
    expect(codesOf(errors)).toContain('INTEGRATION_INPUT_INVALID');
  });

  it('always reports missing required integration fields', async () => {
    const doc = automationDoc(
      [{ id: 'w', type: 'weather.current', input: { units: 'metric' } }],
      { output: '{{ nodes.w.output }}' },
    );
    const { errors } = await validate(doc);
    const issue = errors.find((i) => i.code === 'INTEGRATION_INPUT_INVALID');
    expect(issue?.message).toContain("must have required property 'city'");
  });

  it('treats an llm node with outputSchema as structured', async () => {
    const doc = automationDoc(
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
        (
          await validate(
            automationDoc(nodes, { output: '{{ nodes.main.output }}' }),
          )
        ).errors,
      ),
    ).not.toContain('REF_UNSTRUCTURED_PATH');

    const bad = automationDoc(
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
    const doc = automationDoc(
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
    const doc = automationDoc(
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

  it('skips subautomation resolution without a store, but still checks the reference syntax', async () => {
    setStoreAdapter(null as never);
    const doc = automationDoc(
      [
        { id: 'ok', type: 'subautomation', automation: 'ghost-flow' },
        { id: 'bad', type: 'subautomation', automation: 'Ghost Flow@next' },
      ],
      { output: '{{ nodes.bad.output }}' },
    );
    const { errors } = await validate(doc);
    expect(codesOf(errors)).not.toContain('SUBAUTOMATION_NOT_FOUND');
    expect(codesOf(errors)).toContain('SUBAUTOMATION_REF_INVALID');
  });

  it('survives a store whose list() rejects', async () => {
    setStoreAdapter({
      list: async () => {
        throw new Error('backend down');
      },
      get: async () => null,
      deployedVersion: async () => null,
    });
    const doc = automationDoc(
      [{ id: 'sub', type: 'subautomation', automation: 'ghost-flow' }],
      { output: '{{ nodes.sub.output }}' },
    );
    const { errors } = await validate(doc);
    expect(codesOf(errors)).not.toContain('SUBAUTOMATION_NOT_FOUND');
  });
});
