import { createParser } from 'eventsource-parser';
import { z } from 'zod';

import { externalDepError, preconditionError } from '../../utils/fail';
import { INFERENCE_ADMISSION_SHA } from './admission';
import {
  boundedResponse,
  inferenceRequest,
  verifyInferenceApi,
  verifyInferenceAdmission,
} from './http';
import {
  modelIdentity,
  type InferenceFetch,
  type InferenceModel,
  type InferenceNode,
  type InferenceSpec,
} from './model';

// An inert one-pixel PNG tests the actual vision input path. This is a
// capability check, not an OCR accuracy fixture or customer document.
const image =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=';
const usage = z.object({
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
});
const chunkSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        index: z.literal(0),
        delta: z.object({
          content: z.string().nullable().optional(),
          reasoning_content: z.string().nullable().optional(),
          tool_calls: z
            .array(
              z.object({
                index: z.literal(0),
                id: z.string().min(1).max(256).optional(),
                type: z.literal('function').optional(),
                function: z
                  .object({
                    name: z.string().max(100).optional(),
                    arguments: z.string().max(4096).optional(),
                  })
                  .optional(),
              }),
            )
            .max(1)
            .optional(),
        }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .max(1),
  usage: usage.nullable().optional(),
});

export const capabilityProofSchema = z.strictObject({
  model: z.string(),
  identity: z.string().regex(/^[a-f0-9]{64}$/),
  capability: z.enum(['text', 'vision', 'embedding']),
  completed: z.literal(true),
  durationMs: z.number().nonnegative().finite(),
  firstTokenMs: z.number().nonnegative().finite().nullable(),
  promptTokens: z.number().int().nonnegative().nullable(),
  completionTokens: z.number().int().nonnegative().nullable(),
  endToEndTokensPerSecond: z.number().nonnegative().finite().nullable(),
  embeddingDimensions: z.number().int().positive().nullable(),
  embeddingBatchSize: z.literal(64).nullable(),
  toolCallVerified: z.boolean(),
  toolCallDurationMs: z.number().nonnegative().finite().nullable(),
  coldRequest: z.boolean(),
  queueWaitMs: z.number().nonnegative().finite(),
  coldRequestTotalMs: z.number().nonnegative().finite().nullable(),
});
export type CapabilityProof = z.infer<typeof capabilityProofSchema>;

async function responseAdmission(response: Response) {
  const cold = response.headers.get('x-tale-model-cold');
  const queue = response.headers.get('x-tale-queue-ms');
  const queueWaitMs = Number(queue);
  if (
    response.headers.get('x-tale-admission-sha256') !==
      INFERENCE_ADMISSION_SHA ||
    (cold !== 'true' && cold !== 'false') ||
    queue === null ||
    !Number.isFinite(queueWaitMs) ||
    queueWaitMs < 0
  ) {
    await response.body?.cancel();
    throw preconditionError(
      'Synthetic inference did not pass the exact shared native admission adapter.',
    );
  }
  return { coldRequest: cold === 'true', queueWaitMs };
}

async function chatProbe(
  response: Response,
  model: InferenceModel,
  start: number,
  tool = false,
) {
  if (
    !response.body ||
    !response.headers.get('content-type')?.includes('text/event-stream')
  )
    throw externalDepError(
      'Synthetic inference did not return its requested event stream.',
    );
  let firstTokenMs: number | null = null;
  let tokens: z.infer<typeof usage> | undefined;
  let done = false;
  let stop = false;
  let content = 0;
  let bytes = 0;
  let toolId: string | undefined;
  let toolName = '';
  let toolArguments = '';
  const parser = createParser({
    maxBufferSize: 131072,
    onError: () => {
      throw new Error('Invalid event stream');
    },
    onEvent: (event) => {
      if (done) throw new Error('Events followed stream completion');
      if (event.data === '[DONE]') {
        done = true;
        return;
      }
      const chunk = chunkSchema.parse(JSON.parse(event.data));
      if (chunk.model !== undefined && chunk.model !== model.apiModel)
        throw new Error('Different model responded');
      for (const choice of chunk.choices) {
        const text = choice.delta.content ?? '';
        if (text || choice.delta.reasoning_content)
          firstTokenMs ??= performance.now() - start;
        content += text.length;
        for (const call of choice.delta.tool_calls ?? []) {
          if (
            !tool ||
            stop ||
            (toolId !== undefined &&
              call.id !== undefined &&
              call.id !== toolId)
          )
            throw new Error('Unexpected tool-call identity or ordering');
          toolId ??= call.id;
          toolName += call.function?.name ?? '';
          toolArguments += call.function?.arguments ?? '';
          firstTokenMs ??= performance.now() - start;
          if (toolName.length > 100 || toolArguments.length > 4096)
            throw new Error('Tool-call size exceeded');
        }
        if (choice.finish_reason) {
          if (choice.finish_reason !== (tool ? 'tool_calls' : 'stop'))
            throw new Error('Synthetic output did not finish');
          stop = true;
        }
      }
      if (chunk.usage) tokens = chunk.usage;
    },
  });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > 2_097_152)
        throw new Error('Synthetic stream exceeded byte bound');
      parser.feed(decoder.decode(chunk, { stream: true }));
    }
    parser.feed(decoder.decode());
    parser.reset({ consume: true });
    if (!done || !stop || (!tool && content === 0) || firstTokenMs === null)
      throw new Error('Incomplete synthetic stream');
    if (
      tool &&
      (!toolId ||
        toolName !== 'tale_capability_probe' ||
        !z
          .strictObject({ marker: z.literal('ready') })
          .safeParse(JSON.parse(toolArguments)).success)
    )
      throw new Error(
        'Synthetic tool call did not match its exact inert contract',
      );
  } catch {
    throw externalDepError(
      'Synthetic inference stream was incomplete, malformed or came from another model. It was not retried.',
    );
  }
  return {
    firstTokenMs,
    promptTokens: tokens?.prompt_tokens ?? null,
    completionTokens: tokens?.completion_tokens ?? null,
  };
}

/** Validate the OpenAI tool-call wire contract without executing any function.
 * The inert request is separate from text throughput so timing stays honest. */
async function probeToolCall(
  model: InferenceModel,
  node: InferenceNode,
  key: string,
  fetchImpl: InferenceFetch,
  timeoutMs: number,
): Promise<number> {
  const start = performance.now();
  const response = await inferenceRequest(
    node,
    '/v1/chat/completions',
    key,
    fetchImpl,
    {
      timeoutMs,
      body: {
        model: model.apiModel,
        max_tokens: 1024,
        temperature: 0,
        stream: true,
        messages: [
          {
            role: 'user',
            content:
              'Call tale_capability_probe once with marker ready. This synthetic tool has no effects.',
          },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'tale_capability_probe',
              description: 'Return an inert synthetic readiness marker.',
              parameters: {
                type: 'object',
                properties: { marker: { type: 'string', enum: ['ready'] } },
                required: ['marker'],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: {
          type: 'function',
          function: { name: 'tale_capability_probe' },
        },
      },
    },
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw externalDepError(
      'The declared text model refused its synthetic tool-call contract. It was not retried.',
    );
  }
  await responseAdmission(response);
  await chatProbe(response, model, start, true);
  return performance.now() - start;
}

/** A bounded real capability invocation. No prompt, answer, vector or provider
 * body is returned in receipts. Timing is observed; token counts are reported
 * only when the endpoint actually supplies usage, never estimated from bytes. */
export async function probeCapability(
  model: InferenceModel,
  node: InferenceNode,
  key: string,
  fetchImpl: InferenceFetch = fetch,
  timeoutMs = 3610000,
): Promise<CapabilityProof> {
  const start = performance.now();
  const embedding = model.capability === 'embedding';
  const response = await inferenceRequest(
    node,
    embedding ? '/v1/embeddings' : '/v1/chat/completions',
    key,
    fetchImpl,
    {
      // The native knowledge caller sends up to 64 inputs with a 60s budget.
      // Readiness must exercise that shape, including any shared-node queue.
      timeoutMs: embedding ? Math.min(timeoutMs, 60_000) : timeoutMs,
      body: embedding
        ? {
            model: model.apiModel,
            input: Array.from(
              { length: 64 },
              (_, index) => `Synthetic Tale capability check ${index}.`,
            ),
            dimensions: model.embeddingDimensions,
            encoding_format: 'float',
          }
        : {
            model: model.apiModel,
            max_tokens: 256,
            temperature: 0,
            stream: true,
            stream_options: { include_usage: true },
            messages: [
              {
                role: 'user',
                content:
                  model.capability === 'vision'
                    ? [
                        {
                          type: 'text',
                          text: 'Briefly describe this synthetic image in one sentence.',
                        },
                        { type: 'image_url', image_url: { url: image } },
                      ]
                    : 'Reply with only the word READY.',
              },
            ],
          },
    },
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw externalDepError(
      'The declared model refused its bounded synthetic capability request. No request was retried.',
    );
  }
  const admission = await responseAdmission(response);
  let observed = {
    firstTokenMs: null as number | null,
    promptTokens: null as number | null,
    completionTokens: null as number | null,
  };
  if (embedding) {
    const result = z
      .object({
        model: z.literal(model.apiModel),
        data: z
          .array(
            z.object({
              index: z.number().int().min(0).max(63),
              embedding: z
                .array(z.number().finite())
                .length(model.embeddingDimensions ?? 0),
            }),
          )
          .length(64),
        usage: z
          .object({ prompt_tokens: z.number().int().nonnegative() })
          .optional(),
      })
      .safeParse(
        await boundedResponse(
          response,
          64 * (model.embeddingDimensions ?? 0) * 32 + 65_536,
        ),
      );
    if (
      !result.success ||
      result.data.data.some(
        (entry, index) =>
          entry.index !== index ||
          entry.embedding.every((value) => value === 0),
      )
    )
      throw preconditionError(
        'Embedding capability did not produce 64 ordered, finite, nonzero vectors of the declared dimension and model.',
      );
    observed.promptTokens = result.data.usage?.prompt_tokens ?? null;
  } else observed = await chatProbe(response, model, start);
  const durationMs = performance.now() - start;
  if (embedding && durationMs >= 60_000)
    throw preconditionError(
      'Embedding ingestion exceeded the native 60-second deadline, including queue time.',
    );
  const toolCallDurationMs =
    model.capability === 'text'
      ? await probeToolCall(model, node, key, fetchImpl, timeoutMs)
      : null;
  return {
    model: model.apiModel,
    identity: modelIdentity(model),
    capability: model.capability,
    completed: true,
    durationMs,
    ...observed,
    endToEndTokensPerSecond:
      observed.completionTokens === null
        ? null
        : observed.completionTokens / Math.max(durationMs / 1000, 0.001),
    embeddingDimensions: model.embeddingDimensions ?? null,
    embeddingBatchSize: embedding ? 64 : null,
    toolCallVerified: model.capability === 'text',
    toolCallDurationMs,
    ...admission,
    // This observed wall time includes queue, cold load and generation. It is
    // not a standalone disk/load microbenchmark or simultaneous-residency claim.
    coldRequestTotalMs: admission.coldRequest ? durationMs : null,
  };
}

async function probeCapabilities(
  spec: InferenceSpec,
  node: InferenceNode,
  key: string,
  fetchImpl: InferenceFetch = fetch,
): Promise<CapabilityProof[]> {
  const results: CapabilityProof[] = [];
  for (const model of spec.models.filter((entry) =>
    node.models.includes(entry.key),
  ))
    results.push(
      await probeCapability(
        model,
        node,
        key,
        fetchImpl,
        (spec.limits.queueTimeoutSeconds + spec.limits.requestTimeoutSeconds) *
          1000 +
          10000,
      ),
    );
  return results;
}

export async function benchmarkCapabilities(
  spec: InferenceSpec,
  node: InferenceNode,
  key: string,
  fetchImpl: InferenceFetch = fetch,
) {
  const models = spec.models.filter((model) => node.models.includes(model.key));
  if (
    models.length > 3 ||
    new Set(models.map((model) => model.capability)).size !== models.length
  )
    throw preconditionError(
      'The bounded mixed benchmark requires at most one text, one vision and one embedding model per selected node.',
    );
  const initial = await verifyInferenceApi(spec, node, key, fetchImpl);
  if (
    initial.admission.phase !== 'idle' ||
    initial.admission.queued ||
    initial.admission.preparing
  )
    throw preconditionError(
      'The bounded benchmark requires a drained native inference gate.',
    );
  const baseline = await probeCapabilities(spec, node, key, fetchImpl);
  // Competing role requests use the same on-target FIFO as production traffic.
  // Models may unload/reload between them; simultaneous residency is not needed.
  const mixed = await Promise.all(
    models.map((model) =>
      probeCapability(
        model,
        node,
        key,
        fetchImpl,
        (spec.limits.queueTimeoutSeconds + spec.limits.requestTimeoutSeconds) *
          1000 +
          10000,
      ),
    ),
  );
  const settled = await verifyInferenceAdmission(spec, node, key, fetchImpl);
  if (settled.phase !== 'idle' || settled.queued || settled.preparing)
    throw preconditionError(
      'The native inference gate did not settle after the bounded benchmark.',
    );
  const memoryResponse = await inferenceRequest(
    node,
    '/api/status',
    key,
    fetchImpl,
  );
  const memory = memoryResponse.ok
    ? z
        .object({ model_memory_used: z.number().nonnegative().finite() })
        .safeParse(await boundedResponse(memoryResponse))
    : undefined;
  if (!memoryResponse.ok) await memoryResponse.body?.cancel();
  return {
    profile: 'bounded-serialized-on-demand-baseline-and-mixed',
    residency: 'evictable-on-demand' as const,
    maximumConcurrentRoles: 1 as const,
    maximumObservedActive: settled.maximumObservedActive,
    loadedRoles: settled.models
      .filter((model) => model.loaded)
      .map((model) => model.key),
    simultaneousResidencyRequired: false as const,
    baseline,
    mixed,
    slowdown: mixed.map((sample, index) => ({
      model: sample.model,
      ratio: sample.durationMs / Math.max(baseline[index].durationMs, 0.001),
    })),
    sampledModelMemoryBytes: memory?.success
      ? memory.data.model_memory_used
      : null,
    memoryPeakMeasured: false,
    sustainedLoadMeasured: false,
    ocrAccuracyMeasured: false,
    syntheticRequestCount:
      (models.length +
        models.filter((model) => model.capability === 'text').length) *
      2,
    measuredAt: new Date().toISOString(),
  };
}
