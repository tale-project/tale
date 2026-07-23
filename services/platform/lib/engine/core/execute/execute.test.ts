import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { nodeVmRunner } from '../../runners/node-vm';
import { memoryStore } from '../../store/memory';
import {
  registerNodeType,
  setCodeRunner,
  setLlmService,
  setStoreAdapter,
} from '../slots';
import type { NodeDef, Workflow } from '../types';
import { execute } from './index';

beforeAll(() => {
  setCodeRunner(nodeVmRunner());
  // A deterministic effectful test connector plus an effect-free sibling.
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
      mock: (input) => ({
        id: `note_${String((input as { text: string }).text.length)}`,
      }),
      live: async (input, ctx) => ({
        id: `live_${(input as { text: string }).text}`,
        key: ctx.idempotencyKey,
        secret: ctx.secrets.get('TOKEN'),
      }),
    },
  });
  registerNodeType({
    type: 'quotes.lookup',
    kind: 'integration',
    outputKind: 'structured',
    description: 'test connector: reads a quote',
    allowedFields: ['input'],
    requiredFields: ['input'],
    integration: {
      name: 'quotes.lookup',
      description: 'read a quote',
      inputSchema: { type: 'object' },
      outputSignature: '{ quote: string }',
      hasEffect: false,
      mock: () => ({ quote: 'stay green' }),
    },
  });
});

beforeEach(() => {
  setStoreAdapter(null as never);
  setLlmService(null as never);
});

function wf(nodes: NodeDef[], extra: Partial<Workflow> = {}): Workflow {
  return { version: 1, name: 'test-flow', nodes, ...extra };
}

describe('a realistic mock run', () => {
  it('produces trace, effects, and output end to end', async () => {
    const doc = wf(
      [
        {
          id: 'shape',
          type: 'transform',
          input: { names: '{{ input.names }}' },
          code: 'return input.names.map((n) => n.toUpperCase());',
        },
        {
          id: 'quote',
          type: 'quotes.lookup',
          input: {},
        },
        {
          id: 'summary',
          type: 'llm',
          model: 'test-model',
          prompt:
            'Summarize {{ nodes.shape.output }} — {{ nodes.quote.output.quote }}',
        },
        {
          id: 'note',
          type: 'notes.append',
          input: { text: '{{ nodes.summary.output.text }}' },
        },
      ],
      {
        output: {
          upper: '{{ nodes.shape.output }}',
          note: '{{ nodes.note.output.id }}',
        },
      },
    );

    const result = await execute(doc, { input: { names: ['ada', 'grace'] } });
    expect(result.status).toBe('success');
    expect(result.trace.map((t) => [t.node, t.status])).toEqual([
      ['shape', 'ok'],
      ['quote', 'ok'],
      ['summary', 'ok'],
      ['note', 'ok'],
    ]);
    expect(result.effects.map((e) => e.integration)).toEqual([
      'llm',
      'notes.append',
    ]);
    const output = result.output as { upper: string[]; note: string };
    expect(output.upper).toEqual(['ADA', 'GRACE']);
    expect(output.note).toMatch(/^note_/);
  });

  it('is deterministic: two runs of one document are identical', async () => {
    const doc = wf(
      [
        {
          id: 'summary',
          type: 'llm',
          model: 'test-model',
          prompt: 'Hello {{ input.name }}',
        },
      ],
      { output: '{{ nodes.summary.output.text }}' },
    );
    const a = await execute(doc, { input: { name: 'Ada' } });
    const b = await execute(doc, { input: { name: 'Ada' } });
    const data = ({ trace, ...rest }: typeof a) => ({
      ...rest,
      trace: trace.map(({ ms: _ms, ...t }) => t),
    });
    expect(data(a)).toEqual(data(b));
    expect(a.output).toMatch(/^MOCK_LLM_RESPONSE\[test-model:/);
  });
});

describe('when / elseOf', () => {
  const branchy = () =>
    wf(
      [
        {
          id: 'main',
          type: 'transform',
          when: '{{ input.flag }}',
          code: 'return "ran-main";',
        },
        {
          id: 'fallback',
          type: 'transform',
          elseOf: 'main',
          code: 'return "ran-fallback";',
        },
        {
          id: 'reader',
          type: 'transform',
          input: { v: '{{ nodes.main.output }}' },
          code: 'return input.v;',
        },
      ],
      { output: '{{ nodes.fallback.output }}' },
    );

  it('when truthy: main runs, elseOf partner skips', async () => {
    const result = await execute(branchy(), { input: { flag: true } });
    const byNode = new Map(result.trace.map((t) => [t.node, t]));
    expect(byNode.get('main')?.status).toBe('ok');
    expect(byNode.get('fallback')?.status).toBe('skipped');
    expect(byNode.get('reader')?.status).toBe('ok');
  });

  it('when falsy: main skips, elseOf runs, dependents of main skip too', async () => {
    const result = await execute(branchy(), { input: { flag: false } });
    const byNode = new Map(result.trace.map((t) => [t.node, t]));
    expect(byNode.get('main')?.status).toBe('skipped');
    expect(byNode.get('fallback')?.status).toBe('ok');
    expect(byNode.get('reader')?.status).toBe('skipped');
    expect(byNode.get('reader')?.note).toContain('skipped node(s) main');
    expect(result.output).toBe('ran-fallback');
  });
});

describe('forEach', () => {
  it('runs per item with item/index in scope and collects outputs + effects', async () => {
    const doc = wf([
      {
        id: 'fan',
        type: 'notes.append',
        forEach: '{{ input.items }}',
        input: { text: '{{ item }}#{{ index }}' },
      },
    ]);
    const result = await execute(doc, { input: { items: ['a', 'bb', 'ccc'] } });
    expect(result.status).toBe('success');
    const fan = result.trace.find((t) => t.node === 'fan');
    expect(fan?.input).toEqual({ forEach: '3 item(s)' });
    expect(fan?.output).toHaveLength(3);
    expect(result.effects).toHaveLength(3);
    expect(result.effects[1]?.input).toEqual({ text: 'bb#1' });
  });

  it('empty array → zero runs, empty output', async () => {
    const doc = wf([
      {
        id: 'fan',
        type: 'notes.append',
        forEach: '{{ input.items }}',
        input: { text: '{{ item }}' },
      },
    ]);
    const result = await execute(doc, { input: { items: [] } });
    expect(result.status).toBe('success');
    expect(result.trace.find((t) => t.node === 'fan')?.output).toEqual([]);
    expect(result.effects).toHaveLength(0);
  });

  it('non-array → a guided error', async () => {
    const doc = wf([
      {
        id: 'fan',
        type: 'notes.append',
        forEach: '{{ input.items }}',
        input: { text: 'x' },
      },
    ]);
    const result = await execute(doc, { input: { items: 'nope' } });
    expect(result.status).toBe('error');
    expect(result.error?.message).toContain('forEach must resolve to an array');
  });
});

describe('repeatUntil', () => {
  it('polls until the condition sees a converged output', async () => {
    // The polling pattern: a connector whose state advances per call. The
    // closure counter is test-local state standing in for a real pending job.
    let polls = 0;
    registerNodeType({
      type: 'jobs.poll',
      kind: 'integration',
      outputKind: 'structured',
      description: 'test connector: job status',
      allowedFields: ['input'],
      requiredFields: ['input'],
      integration: {
        name: 'jobs.poll',
        description: 'poll a job',
        inputSchema: { type: 'object' },
        outputSignature: '{ status: string }',
        hasEffect: false,
        mock: () => ({ status: ++polls >= 3 ? 'done' : 'pending' }),
      },
    });
    const doc = wf([
      {
        id: 'wait',
        type: 'jobs.poll',
        input: {},
        repeatUntil: '{{ output.status === "done" }}',
        maxRepeats: 10,
      },
    ]);
    const result = await execute(doc, { input: {} });
    expect(result.status).toBe('success');
    const wait = result.trace.find((t) => t.node === 'wait');
    expect(wait?.output).toEqual({ status: 'done' });
    expect(wait?.note).toBe('repeatUntil ran 3x');
  });

  it('cap exhaustion is visible in the note', async () => {
    const doc = wf([
      {
        id: 'never',
        type: 'transform',
        repeatUntil: '{{ false }}',
        maxRepeats: 2,
        code: 'return 1;',
      },
    ]);
    const result = await execute(doc, { input: {} });
    expect(result.status).toBe('success');
    expect(result.trace[0]?.note).toContain('maxRepeats hit');
  });
});

describe('onError', () => {
  const failing: NodeDef = {
    id: 'boom',
    type: 'transform',
    code: 'return input.missing.deep;',
  };

  it('fail (default) halts with nodeId, message, and a property hint', async () => {
    const doc = wf([
      failing,
      { id: 'after', type: 'transform', code: 'return 1;' },
    ]);
    const result = await execute(doc, { input: {} });
    expect(result.status).toBe('error');
    expect(result.error?.nodeId).toBe('boom');
    expect(result.error?.hint).toContain('null/undefined');
    expect(result.trace.find((t) => t.node === 'after')?.status).toBe(
      'not_run',
    );
  });

  it('continue records the error and skips dependents only', async () => {
    const doc = wf(
      [
        { ...failing, onError: 'continue' },
        {
          id: 'dependent',
          type: 'transform',
          input: { v: '{{ nodes.boom.output }}' },
          code: 'return input.v;',
        },
        { id: 'independent', type: 'transform', code: 'return "alive";' },
      ],
      { output: '{{ nodes.independent.output }}' },
    );
    const result = await execute(doc, { input: {} });
    expect(result.status).toBe('success');
    const byNode = new Map(result.trace.map((t) => [t.node, t]));
    expect(byNode.get('boom')?.status).toBe('error');
    expect(byNode.get('dependent')?.status).toBe('skipped');
    expect(byNode.get('independent')?.status).toBe('ok');
    expect(result.output).toBe('alive');
  });
});

describe('subworkflow', () => {
  function installStoreWithChild() {
    const store = memoryStore();
    store.save(
      'child',
      wf(
        [
          {
            id: 'double',
            type: 'transform',
            input: { n: '{{ input.n }}' },
            code: 'return input.n * 2;',
          },
          { id: 'log', type: 'notes.append', input: { text: 'child-ran' } },
        ],
        { name: 'child', output: '{{ nodes.double.output }}' },
      ),
    );
    setStoreAdapter(store);
    return store;
  }

  it('runs the referenced workflow and folds its effects under the parent node', async () => {
    installStoreWithChild();
    const doc = wf(
      [
        {
          id: 'call',
          type: 'subworkflow',
          workflow: 'child',
          input: { n: 21 },
        },
      ],
      { output: '{{ nodes.call.output }}' },
    );
    const result = await execute(doc, { input: {} });
    expect(result.status).toBe('success');
    expect(result.output).toBe(42);
    expect(result.effects).toEqual([
      {
        node: 'call/log',
        integration: 'notes.append',
        input: { text: 'child-ran' },
      },
    ]);
  });

  it('resolves name@version explicitly', async () => {
    const store = installStoreWithChild();
    store.save(
      'child',
      wf([{ id: 'v2', type: 'transform', code: 'return "v2";' }], {
        name: 'child',
        output: '{{ nodes.v2.output }}',
      }),
    );
    const doc = wf(
      [
        {
          id: 'call',
          type: 'subworkflow',
          workflow: 'child@1',
          input: { n: 1 },
        },
      ],
      { output: '{{ nodes.call.output }}' },
    );
    const result = await execute(doc, { input: {} });
    expect(result.output).toBe(2);
  });

  it('missing reference and missing store both fail with guidance', async () => {
    installStoreWithChild();
    const missing = await execute(
      wf([{ id: 'call', type: 'subworkflow', workflow: 'ghost' }]),
      { input: {} },
    );
    expect(missing.status).toBe('error');
    expect(missing.error?.message).toContain('save_workflow it first');

    setStoreAdapter(null as never);
    const storeless = await execute(
      wf([{ id: 'call', type: 'subworkflow', workflow: 'child' }]),
      { input: {} },
    );
    expect(storeless.error?.message).toContain('no workflow store');
  });

  it('caps nesting at three levels', async () => {
    const store = memoryStore();
    store.save(
      'loop',
      wf([{ id: 'again', type: 'subworkflow', workflow: 'loop', input: {} }], {
        name: 'loop',
      }),
    );
    setStoreAdapter(store);
    const result = await execute(
      wf([{ id: 'start', type: 'subworkflow', workflow: 'loop' }]),
      { input: {} },
    );
    expect(result.status).toBe('error');
    expect(result.error?.message).toContain('nest at most 3');
  });
});

describe('llm structured output', () => {
  it('outputSchema in mock mode yields a deterministic schema stub', async () => {
    const doc = wf(
      [
        {
          id: 'extract',
          type: 'llm',
          model: 'test-model',
          prompt: 'Extract from {{ input.text }}',
          outputSchema: {
            type: 'object',
            properties: {
              city: { type: 'string' },
              population: { type: 'integer' },
            },
            required: ['city', 'population'],
          },
        },
      ],
      { output: '{{ nodes.extract.output }}' },
    );
    const result = await execute(doc, { input: { text: 'Zurich' } });
    expect(result.output).toEqual({ city: 'mock', population: 0 });
  });

  it('live mode requires structured replies for schema nodes', async () => {
    setLlmService(async () => ({ text: 'not structured' }));
    const doc = wf([
      {
        id: 'extract',
        type: 'llm',
        model: 'test-model',
        prompt: 'x',
        outputSchema: { type: 'object' },
      },
    ]);
    const result = await execute(doc, { input: {}, mode: 'live' });
    expect(result.status).toBe('error');
    expect(result.error?.message).toContain('structured output was required');
  });

  it('live mode calls the installed service with the node model', async () => {
    const service = vi.fn(async () => ({ text: 'live reply' }));
    setLlmService(service);
    const doc = wf(
      [{ id: 's', type: 'llm', model: 'the-model', prompt: 'p' }],
      { output: '{{ nodes.s.output.text }}' },
    );
    const result = await execute(doc, { input: {}, mode: 'live' });
    expect(result.output).toBe('live reply');
    expect(service).toHaveBeenCalledWith({ model: 'the-model', prompt: 'p' });
  });
});

describe('live integrations', () => {
  /** A host that satisfies the capability contract without touching the
   * network — live execution requires one, so its absence is what makes an
   * unhosted live run fall back to the mock. */
  function testHost() {
    const notFetched = (): never => {
      throw new Error('the test host performs no IO');
    };
    return {
      config: {},
      http: {
        get: notFetched,
        post: notFetched,
        put: notFetched,
        patch: notFetched,
        delete: notFetched,
      },
      base64Encode: (s: string) => Buffer.from(s).toString('base64'),
      base64Decode: (s: string) => Buffer.from(s, 'base64').toString('utf8'),
    };
  }

  it('falls back to the mock when live mode has no integration host', async () => {
    const result = await execute(
      wf([{ id: 'n', type: 'notes.append', input: { text: 'hi' } }]),
      {
        input: {},
        mode: 'live',
      },
    );
    expect(result.status).toBe('success');
    const entry = result.trace.find((t) => t.node === 'n');
    expect(entry?.note).toContain('no integration host supplied');
    // The mock shape, not the live one — nothing reached the network.
    expect(entry?.output).toMatchObject({ id: 'note_2' });
  });

  it('passes per-integration secrets and stable idempotency keys', async () => {
    const doc = wf([
      {
        id: 'fan',
        type: 'notes.append',
        forEach: '{{ input.items }}',
        input: { text: '{{ item }}' },
      },
    ]);
    const result = await execute(doc, {
      input: { items: ['a', 'b'] },
      mode: 'live',
      secrets: { 'notes.append': { TOKEN: 's3cret' } },
      integrationHost: () => testHost(),
    });
    expect(result.status).toBe('success');
    const outs = result.trace.find((t) => t.node === 'fan')?.output as Array<{
      key: string;
      secret: string;
    }>;
    expect(outs[0]?.secret).toBe('s3cret');
    // Keys are unique per item within one run.
    expect(outs[0]?.key).not.toBe(outs[1]?.key);
    expect(outs[0]?.key).toMatch(/:fan:0$/);
  });
});

describe('guards and contracts', () => {
  it('rejects run input that misses the inputs schema', async () => {
    const doc = wf([{ id: 'a', type: 'transform', code: 'return 1;' }], {
      inputs: {
        type: 'object',
        properties: { n: { type: 'number' } },
        required: ['n'],
      },
    });
    const result = await execute(doc, { input: {} });
    expect(result.status).toBe('error');
    expect(result.error?.message).toContain('"inputs" schema');
  });

  it('rejects integration input that misses the connector schema', async () => {
    const doc = wf([
      { id: 'bad', type: 'notes.append', input: { wrong: true } },
    ]);
    const result = await execute(doc, { input: {} });
    expect(result.status).toBe('error');
    expect(result.error?.message).toContain(
      'does not match the notes.append schema',
    );
  });

  it('stops a runaway document at the execution guard', async () => {
    const doc = wf([
      {
        id: 'fan',
        type: 'notes.append',
        forEach: '{{ input.items }}',
        input: { text: 'x' },
      },
    ]);
    const result = await execute(doc, {
      input: { items: Array.from({ length: 20 }, (_, i) => i) },
      maxNodes: 5,
    });
    expect(result.status).toBe('error');
    expect(result.error?.message).toContain('5-execution guard');
  });

  it('transform returning nothing is a guided error', async () => {
    const doc = wf([{ id: 'a', type: 'transform', code: 'const x = 1;' }]);
    const result = await execute(doc, { input: {} });
    expect(result.error?.message).toContain('must return a value');
  });
});
