import { afterEach, describe, expect, test } from 'bun:test';

import { z } from 'zod';

import { benchmarkCapabilities, probeCapability } from './benchmark';
import { modelIdentity, OMLX_RUNTIME, parseInferenceSpec } from './model';
import {
  inferenceFixture,
  admissionFixture,
  admissionHeaders,
} from './tests/fixture';

const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop(true);
});
function fixture(mode = 'valid') {
  const key = 's'.repeat(32);
  const raw = inferenceFixture();
  let requests = 0;
  let active = 0;
  let peak = 0;
  let tail = Promise.resolve();
  let spec = parseInferenceSpec(raw);
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (request) => {
      const path = new URL(request.url).pathname;
      if (path === '/health') return Response.json({ status: 'healthy' });
      if (request.headers.get('authorization') !== `Bearer ${key}`)
        return new Response(null, { status: 401 });
      if (path === '/api/status')
        return Response.json({
          status: 'ok',
          version: OMLX_RUNTIME.version,
          loaded_models: spec.models.map(modelIdentity),
          models_discovered: 3,
          models_loaded: 3,
          models_loading: 0,
          custom_kernels: { glm_moe_dsa: { available: true } },
          model_memory_used: 1000,
        });
      if (path === '/v1/models')
        return Response.json({
          data: spec.models.map((model) => ({
            id: model.apiModel,
            max_model_len: model.contextTokens,
          })),
        });
      if (path === '/_tale/admission')
        return Response.json(admissionFixture(spec, spec.nodes[0]!));
      requests++;
      const prior = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await prior;
      active++;
      peak = Math.max(peak, active);
      const body = z
        .object({
          model: z.string(),
          dimensions: z.number().optional(),
          input: z.array(z.string()).optional(),
          messages: z.unknown().optional(),
        })
        .passthrough()
        .parse(await request.json());
      expect(body).not.toHaveProperty('password');
      await Bun.sleep(10);
      active--;
      release();
      if (path === '/v1/embeddings') {
        expect(body.dimensions).toBe(1536);
        expect(body.input).toHaveLength(64);
        return Response.json(
          {
            model: body.model,
            data: Array.from({ length: 64 }, (_, index) => ({
              index: mode === 'duplicate-index' ? 0 : index,
              embedding: Array.from(
                { length: mode === 'bad-dimension' ? 1535 : 1536 },
                () => (mode === 'non-finite' ? null : 0.01),
              ),
            })),
            usage: { prompt_tokens: 6 },
          },
          { headers: admissionHeaders },
        );
      }
      if (body.model === 'Example-Vision')
        expect(JSON.stringify(body.messages)).toContain(
          'data:image/png;base64,',
        );
      const model = mode === 'wrong-model' ? 'wrong' : body.model;
      if (body.tools) {
        expect(body.tool_choice).toEqual({
          type: 'function',
          function: { name: 'tale_capability_probe' },
        });
        const tool =
          mode === 'bad-tool' ? 'unrequested_tool' : 'tale_capability_probe';
        return new Response(
          [
            `data: ${JSON.stringify({ model, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'synthetic-tool-id', type: 'function', function: { name: tool, arguments: '{"marker":' } }] }, finish_reason: null }] })}\n\n`,
            `data: ${JSON.stringify({ model, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: mode === 'bad-tool-arguments' ? '"wrong"}' : '"ready"}' } }] }, finish_reason: 'tool_calls' }] })}\n\n`,
            'data: [DONE]\n\n',
          ].join(''),
          {
            headers: {
              'content-type': 'text/event-stream',
              ...admissionHeaders,
            },
          },
        );
      }
      const stream = [
        `data: ${JSON.stringify({ model, choices: [{ index: 0, delta: mode === 'reason-only' ? { reasoning_content: 'private thought' } : { content: 'Grüezi' }, finish_reason: null }] })}\r\n\r\n`,
        `data: ${JSON.stringify({ model, choices: [{ index: 0, delta: {}, finish_reason: mode === 'truncated' ? 'length' : 'stop' }], ...(mode === 'no-usage' ? {} : { usage: { prompt_tokens: 6, completion_tokens: 2 } }) })}\n\n`,
        ...(mode === 'missing-done' ? [] : ['data: [DONE]\n\n']),
      ];
      return new Response(
        new ReadableStream({
          start(controller) {
            const bytes = new TextEncoder().encode(stream.join(''));
            // Split Unicode and event boundaries, as actual network chunks may.
            for (let i = 0; i < bytes.length; i += 7)
              controller.enqueue(bytes.slice(i, i + 7));
            controller.close();
          },
        }),
        {
          headers: { 'content-type': 'text/event-stream', ...admissionHeaders },
        },
      );
    },
  });
  servers.push(server);
  spec = parseInferenceSpec({
    ...raw,
    models: [
      raw.models[0],
      {
        ...raw.models[0],
        key: 'vision',
        apiModel: 'Example-Vision',
        capability: 'vision',
        modelType: 'qwen3_vl',
        requiredKernels: [],
      },
      {
        ...raw.models[0],
        key: 'embedding',
        apiModel: 'Example-Embedding',
        capability: 'embedding',
        modelType: 'qwen3',
        requiredKernels: [],
        embeddingDimensions: 1536,
      },
    ],
    nodes: [
      {
        ...raw.nodes[0],
        address: '127.0.0.1',
        port: server.port,
        models: ['reasoning', 'vision', 'embedding'],
      },
    ],
  });
  return {
    spec,
    node: spec.nodes[0]!,
    key,
    requests: () => requests,
    peak: () => peak,
  };
}
describe('real HTTP with synthetic model responses, not hardware performance', () => {
  test('measures bounded serial and mixed work, without retaining response text or vectors', async () => {
    const f = fixture();
    const proof = await benchmarkCapabilities(f.spec, f.node, f.key);
    expect(f.requests()).toBe(8);
    expect(f.peak()).toBe(1);
    expect(proof.baseline).toHaveLength(3);
    expect(proof.mixed).toHaveLength(3);
    expect(proof.baseline[0]?.completionTokens).toBe(2);
    expect(proof.baseline[0]?.toolCallVerified).toBe(true);
    expect(proof.baseline[0]?.toolCallDurationMs).toBeGreaterThan(0);
    expect(proof.baseline[2]?.embeddingDimensions).toBe(1536);
    expect(proof.baseline[2]?.embeddingBatchSize).toBe(64);
    expect(proof.sampledModelMemoryBytes).toBe(1000);
    expect(proof.memoryPeakMeasured).toBe(false);
    expect(proof.ocrAccuracyMeasured).toBe(false);
    expect(JSON.stringify(proof)).not.toContain('Grüezi');
    expect(JSON.stringify(proof)).not.toContain(f.key);
  });
  test.each(['wrong-model', 'truncated', 'reason-only', 'missing-done'])(
    'refuses %s after one request with no replay',
    async (mode) => {
      const f = fixture(mode);
      await expect(
        probeCapability(f.spec.models[0]!, f.node, f.key),
      ).rejects.toThrow('not retried');
      expect(f.requests()).toBe(1);
    },
  );
  test.each(['bad-dimension', 'non-finite', 'duplicate-index'])(
    'refuses embedding %s instead of declaring the native vector contract ready',
    async (mode) => {
      const f = fixture(mode);
      await expect(
        probeCapability(f.spec.models[2]!, f.node, f.key),
      ).rejects.toThrow('declared dimension');
      expect(f.requests()).toBe(1);
    },
  );
  test.each(['bad-tool', 'bad-tool-arguments'])(
    'refuses %s without executing a tool or retrying the stream',
    async (mode) => {
      const f = fixture(mode);
      await expect(
        probeCapability(f.spec.models[0]!, f.node, f.key),
      ).rejects.toThrow('not retried');
      expect(f.requests()).toBe(2);
    },
  );
  test('keeps missing usage unknown instead of estimating token throughput from characters', async () => {
    const f = fixture('no-usage');
    const result = await probeCapability(f.spec.models[0]!, f.node, f.key);
    expect(result.completionTokens).toBeNull();
    expect(result.endToEndTokensPerSecond).toBeNull();
    expect(result.firstTokenMs).not.toBeNull();
  });
});
