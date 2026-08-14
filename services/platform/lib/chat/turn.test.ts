import { describe, expect, it, vi } from 'vitest';

import { decodeChatError } from '../shared/chat-errors';
import {
  buildHarnessTable,
  type CredentialAuth,
} from '../shared/providers/resolve_execution';
import {
  harnessDefinitionSchema,
  modelCatalogEntrySchema,
  type HarnessDefinition,
} from '../shared/schemas/providers';
import type { GuardrailFilter } from './guardrails';
import type { ChatToolExecutor, ToolCallRequest } from './tools';
import {
  MAX_TOOL_ROUNDS,
  runTurn,
  TURN_STEPS,
  type ModelCall,
  type ModelCallRequest,
  type TurnDeps,
  type TurnRequest,
  type TurnStore,
  type UsageLedgerEntry,
} from './turn';
import type { ChatMessage, MessagePart } from './types';

/**
 * The pipeline's contract is its ORDER and its short-circuits. Every outside
 * dependency is a fake here — no provider, no Convex, no network — so what the
 * tests observe is exactly the sequence of steps and what each one did.
 */

const ORG = 'org_1';

function harness(
  slug: string,
  policy: { managed: boolean; byo: boolean },
): HarnessDefinition {
  return harnessDefinitionSchema.parse({
    slug,
    displayName: slug,
    credentialPolicy: policy,
    credentialEnvKeys: ['TALE_GATEWAY_TOKEN'],
    modelIdDialect: 'vendor-native',
    promptTransport: 'stdin-ndjson',
    capabilities: { planMode: false, steering: false, mcp: false },
    parser: 'hermes-jsonl',
    exec: {
      bin: 'test-harness',
      argv: [{ args: ['--workdir', '${workdir}'] }],
      stdin: { mode: 'json-envelope', envelope: [{ prompt: {} }] },
      ...(policy.managed && {
        env: { managed: { TALE_GATEWAY_TOKEN: '${gateway.token}' } },
      }),
    },
  });
}

const HARNESSES = buildHarnessTable([
  harness('claude-code', { managed: true, byo: true }),
  harness('opencode', { managed: true, byo: false }),
]);

const MODEL = modelCatalogEntrySchema.parse({
  id: 'claude-fable-5',
  provider: 'anthropic',
  tags: ['chat'],
  supportsTools: true,
  supportsVision: true,
  contextWindow: 200_000,
});

const API_KEY_CREDENTIAL: CredentialAuth = { authMethod: 'api-key' };

interface StoreCalls {
  readonly appended: Array<Record<string, unknown>>;
  /** Every streaming-progress write, in order (the full text so far). */
  readonly streamed: Array<{ messageId: string | undefined; text: string }>;
  /** Every settled-parts write, in order (the authoritative parts-so-far). */
  readonly partsWrites: Array<readonly Record<string, unknown>[]>;
  /** Every settle write into the placeholder. */
  readonly finalized: Array<Record<string, unknown>>;
  readonly generations: string[];
  /** The messageId each beginGeneration carried. */
  readonly generationMessageIds: Array<string | undefined>;
}

function fakeStore(options: { cancelAfterStreamWrites?: number } = {}): {
  store: TurnStore;
  calls: StoreCalls;
} {
  const calls: StoreCalls = {
    appended: [],
    streamed: [],
    partsWrites: [],
    finalized: [],
    generations: [],
    generationMessageIds: [],
  };
  return {
    calls,
    store: {
      appendMessage(message) {
        calls.appended.push(message);
        return Promise.resolve({
          id: `msg_${calls.appended.length}`,
          sequence: calls.appended.length,
        });
      },
      streamProgress(update) {
        calls.streamed.push({
          messageId: update.messageId,
          text: update.text,
        });
        const cancelAt = options.cancelAfterStreamWrites;
        return Promise.resolve({
          cancelRequested:
            cancelAt !== undefined && calls.streamed.length >= cancelAt,
        });
      },
      updateAssistantParts(update) {
        calls.partsWrites.push(
          update.parts.map((part) => ({ ...part }) as Record<string, unknown>),
        );
        return Promise.resolve();
      },
      finalizeAssistantMessage(message) {
        calls.finalized.push(message);
        return Promise.resolve();
      },
      beginGeneration(generation) {
        calls.generations.push('begin');
        calls.generationMessageIds.push(generation.messageId);
        return Promise.resolve();
      },
      endGeneration() {
        calls.generations.push('end');
        return Promise.resolve();
      },
    },
  };
}

function streamingModel(chunks: readonly string[]): ModelCall {
  return async function* stream() {
    for (const text of chunks) yield { text };
  };
}

function request(overrides: Partial<TurnRequest> = {}): TurnRequest {
  return {
    organizationId: ORG,
    userId: 'user_1',
    threadId: 'thread_1',
    userText: 'how do I return a printer?',
    history: [],
    locale: 'en',
    agent: { slug: 'assistant', instructions: 'Help with support questions.' },
    mandatoryInstructions: 'Never promise a delivery date.',
    model: MODEL,
    credential: API_KEY_CREDENTIAL,
    executionMode: 'direct',
    ...overrides,
  };
}

function deps(overrides: Partial<TurnDeps> = {}): {
  deps: TurnDeps;
  store: StoreCalls;
  usage: UsageLedgerEntry[];
  chunks: string[];
} {
  const { store, calls } = fakeStore();
  const usage: UsageLedgerEntry[] = [];
  const chunks: string[] = [];
  return {
    store: calls,
    usage,
    chunks,
    deps: {
      harnesses: HARNESSES,
      model: streamingModel(['Return it ', 'within 30 days.']),
      store,
      usage: {
        record(entry) {
          usage.push(entry);
          return Promise.resolve();
        },
      },
      now: () => new Date('2026-07-22T09:00:00.000Z'),
      onChunk: (text) => chunks.push(text),
      ...overrides,
    },
  };
}

function blockingFilter(name: GuardrailFilter['name']): GuardrailFilter {
  return {
    name,
    run() {
      return { kind: 'blocked', categoryIds: ['policy'], matchCount: 1 };
    },
  };
}

function passFilter(name: GuardrailFilter['name'] = 'pii'): GuardrailFilter {
  return {
    name,
    run() {
      return { kind: 'pass' };
    },
  };
}

describe('runTurn — the happy path', () => {
  it('runs every step, in the contracted order', async () => {
    const d = deps();
    const outcome = await runTurn(request(), d.deps);

    expect(outcome.status).toBe('completed');
    expect(outcome.steps).toEqual([...TURN_STEPS]);
  });

  it('streams the answer through and records what it cost', async () => {
    const d = deps();
    const outcome = await runTurn(request(), d.deps);

    expect(outcome).toMatchObject({
      status: 'completed',
      text: 'Return it within 30 days.',
    });
    expect(d.chunks.join('')).toBe('Return it within 30 days.');
    expect(d.usage).toEqual([
      {
        organizationId: ORG,
        userId: 'user_1',
        agentSlug: 'assistant',
        model: 'claude-fable-5',
        provider: 'anthropic',
        inputTokens: expect.any(Number),
        outputTokens: expect.any(Number),
        totalTokens: expect.any(Number),
      },
    ]);
  });

  it('opens the generation row before streaming and always closes it', async () => {
    const d = deps();
    await runTurn(request(), d.deps);

    expect(d.store.generations).toEqual(['begin', 'end']);
    // The streaming-progress writes double as the turn's heartbeat.
    expect(d.store.streamed.length).toBeGreaterThan(0);
  });

  it('records what the provider reported instead of its own estimate', async () => {
    const reporting: ModelCall = async function* stream() {
      yield { text: 'answer' };
      yield {
        text: '',
        usage: { inputTokens: 111, outputTokens: 22, totalTokens: 133 },
      };
    };
    const d = deps({ model: reporting });

    const outcome = await runTurn(request(), d.deps);

    expect(outcome).toMatchObject({
      status: 'completed',
      usage: { inputTokens: 111, outputTokens: 22, totalTokens: 133 },
    });
    expect(d.usage[0]).toMatchObject({ inputTokens: 111, totalTokens: 133 });
  });

  it('carries reported cache and reasoning counts, and never invents them', async () => {
    const reporting: ModelCall = async function* stream() {
      yield { text: 'answer' };
      yield {
        text: '',
        usage: {
          inputTokens: 111,
          outputTokens: 22,
          totalTokens: 133,
          cachedInputTokens: 100,
          reasoningTokens: 9,
        },
      };
    };
    const d = deps({ model: reporting });

    const outcome = await runTurn(request(), d.deps);

    expect(outcome).toMatchObject({
      status: 'completed',
      usage: { cachedInputTokens: 100, reasoningTokens: 9 },
    });
    expect(d.store.finalized[0]).toMatchObject({
      usage: expect.objectContaining({
        cachedInputTokens: 100,
        reasoningTokens: 9,
      }),
    });

    // A provider that reports no such counts leaves the fields absent —
    // hidden by the info panel, not rendered as zero.
    const bare = deps();
    const plain = await runTurn(request(), bare.deps);
    if (plain.status !== 'completed') throw new Error('expected completion');
    expect(plain.usage.cachedInputTokens).toBeUndefined();
    expect(plain.usage.reasoningTokens).toBeUndefined();
  });

  it('stamps the cost estimate only when the catalog prices the model', async () => {
    const pricedModel = modelCatalogEntrySchema.parse({
      id: 'claude-fable-5',
      provider: 'anthropic',
      tags: ['chat'],
      supportsTools: true,
      supportsVision: true,
      contextWindow: 200_000,
      pricing: { inputCentsPerMillion: 300, outputCentsPerMillion: 1500 },
    });
    const reporting: ModelCall = async function* stream() {
      yield {
        text: 'answer',
        usage: { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 },
      };
    };
    const d = deps({ model: reporting });

    const outcome = await runTurn(request({ model: pricedModel }), d.deps);

    if (outcome.status !== 'completed') throw new Error('expected completion');
    // 1000 in at 300¢/M plus 200 out at 1500¢/M — fractional cents kept.
    expect(outcome.usage.costEstimateCents).toBeCloseTo(0.6, 10);
    expect(d.store.finalized[0]).toMatchObject({
      usage: expect.objectContaining({
        costEstimateCents: outcome.usage.costEstimateCents,
      }),
    });

    // The default model publishes no pricing: no cost claim at all.
    const bare = deps();
    const unpriced = await runTurn(request(), bare.deps);
    if (unpriced.status !== 'completed') throw new Error('expected completion');
    expect(unpriced.usage.costEstimateCents).toBeUndefined();
  });

  it('closes the generation row even when the model call throws', async () => {
    const failing: ModelCall = () => {
      throw new Error('provider exploded');
    };
    const d = deps({ model: failing });

    // A stream failure settles as a REFUSED outcome (surfaced to the user as
    // an error reply), never as an unhandled rejection out of the turn.
    await expect(runTurn(request(), d.deps)).resolves.toMatchObject({
      status: 'refused',
      step: 'stream',
      reason: 'provider exploded',
    });
    expect(d.store.generations).toEqual(['begin', 'end']);
  });

  it('persists the user message, then settles the answer into the placeholder', async () => {
    const d = deps();
    await runTurn(request(), d.deps);

    // The assistant row exists BEFORE the stream (empty placeholder)…
    expect(d.store.appended.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(d.store.appended[1]).toMatchObject({ parts: [] });
    // …the generation row names it…
    expect(d.store.generationMessageIds).toEqual(['msg_2']);
    // …and the settle write carries the answer and its attribution.
    expect(d.store.finalized).toEqual([
      expect.objectContaining({
        organizationId: ORG,
        threadId: 'thread_1',
        messageId: 'msg_2',
        text: 'Return it within 30 days.',
        model: 'claude-fable-5',
        providerSlug: 'anthropic',
      }),
    ]);
  });

  it('streams the growing text into the placeholder as chunks clear', async () => {
    // Empty-filter emit plus a flush persist of the accumulated text.
    const first = 'a'.repeat(150);
    const second = 'b'.repeat(150);
    const d = deps({ model: streamingModel([first, second]) });
    await runTurn(request(), d.deps);

    expect(d.store.streamed.map((w) => w.text)).toEqual([
      first,
      first + second,
      first + second,
    ]);
    expect(new Set(d.store.streamed.map((w) => w.messageId))).toEqual(
      new Set(['msg_2']),
    );
  });

  it('persists a short reply on the first chunk, then again after flush', async () => {
    const short = 'x'.repeat(40);
    const d = deps({ model: streamingModel([short]) });
    await runTurn(request(), d.deps);

    expect(d.store.streamed.map((w) => w.text)).toEqual([short, short]);
  });

  it('skips empty persist writes so they cannot eat the next non-empty window', async () => {
    const short = 'x'.repeat(40);
    const d = deps({
      model: async function* stream() {
        yield { text: '' };
        yield { text: short };
      },
    });
    await runTurn(request(), d.deps);

    expect(d.store.streamed.map((w) => w.text)).toEqual([short, short]);
  });

  it('stamps duration and time-to-first-token into the usage it records', async () => {
    // A clock that advances 100 ms per reading, so the stamps are non-zero
    // and ordered: TTFT is read at the first provider text SSE, duration at
    // settle, both anchored at runTurn start.
    let tick = 0;
    const d = deps({
      now: () => new Date(1_700_000_000_000 + 100 * tick++),
    });

    const outcome = await runTurn(request(), d.deps);

    if (outcome.status !== 'completed') throw new Error('expected completion');
    const { durationMs, timeToFirstTokenMs } = outcome.usage;
    if (durationMs === undefined || timeToFirstTokenMs === undefined) {
      throw new Error('expected both timing stamps');
    }
    expect(durationMs).toBeGreaterThan(0);
    expect(timeToFirstTokenMs).toBeGreaterThan(0);
    expect(timeToFirstTokenMs).toBeLessThanOrEqual(durationMs);
    expect(d.store.finalized[0]).toMatchObject({
      usage: expect.objectContaining({
        durationMs: outcome.usage.durationMs,
        timeToFirstTokenMs: outcome.usage.timeToFirstTokenMs,
      }),
    });
  });

  it('stamps the TTFT breakdown anchors — setup, first reasoning, first token', async () => {
    let tick = 0;
    const d = deps({
      now: () => new Date(1_700_000_000_000 + 100 * tick++),
      model: async function* stream() {
        yield { text: '', reasoning: 'thinking hard' };
        yield { text: 'Return it within 30 days.' };
      },
    });

    const outcome = await runTurn(request(), d.deps);

    if (outcome.status !== 'completed') throw new Error('expected completion');
    const { setupMs, timeToFirstReasoningMs, timeToFirstTokenMs, durationMs } =
      outcome.usage;
    if (
      setupMs === undefined ||
      timeToFirstReasoningMs === undefined ||
      timeToFirstTokenMs === undefined ||
      durationMs === undefined
    ) {
      throw new Error('expected the full timing breakdown');
    }
    // The anchors are ordered: setup precedes the first reasoning delta,
    // which precedes the first provider text SSE, all inside the duration.
    expect(setupMs).toBeGreaterThan(0);
    expect(setupMs).toBeLessThanOrEqual(timeToFirstReasoningMs);
    expect(timeToFirstReasoningMs).toBeLessThanOrEqual(timeToFirstTokenMs);
    expect(timeToFirstTokenMs).toBeLessThanOrEqual(durationMs);
  });

  it('stamps TTFT on the first provider text SSE even when filters buffer', async () => {
    let tick = 0;
    const d = deps({
      now: () => new Date(1_700_000_000_000 + 100 * tick++),
      outputFilters: [passFilter()],
      model: async function* stream() {
        yield { text: 'short' };
        yield { text: 'x'.repeat(200) };
      },
    });

    const outcome = await runTurn(request(), d.deps);

    if (outcome.status !== 'completed') throw new Error('expected completion');
    const { setupMs, timeToFirstTokenMs, durationMs } = outcome.usage;
    if (
      setupMs === undefined ||
      timeToFirstTokenMs === undefined ||
      durationMs === undefined
    ) {
      throw new Error('expected timing stamps');
    }
    expect(setupMs).toBeLessThanOrEqual(timeToFirstTokenMs);
    expect(timeToFirstTokenMs).toBeLessThanOrEqual(durationMs);
    expect(timeToFirstTokenMs).toBeLessThan(durationMs);
  });

  it('leaves the reasoning anchor absent when the turn never reasoned', async () => {
    let tick = 0;
    const d = deps({
      now: () => new Date(1_700_000_000_000 + 100 * tick++),
    });

    const outcome = await runTurn(request(), d.deps);

    if (outcome.status !== 'completed') throw new Error('expected completion');
    expect(outcome.usage.timeToFirstReasoningMs).toBeUndefined();
    expect(outcome.usage.setupMs).toBeGreaterThan(0);
  });

  it('resend mode re-runs the prompt without persisting it twice', async () => {
    const d = deps();
    const outcome = await runTurn(
      request({ appendUserMessage: false }),
      d.deps,
    );

    if (outcome.status !== 'completed') throw new Error('expected completion');
    // Only the assistant placeholder was appended — no second user row.
    expect(d.store.appended.map((m) => m.role)).toEqual(['assistant']);
    // The prompt still reached the model as the newest turn.
    expect(outcome.context.messages.at(-1)).toEqual({
      role: 'user',
      parts: [{ type: 'text', text: 'how do I return a printer?' }],
    });
  });

  it('settles a mid-stream failure into the placeholder without erasing partial text', async () => {
    const failing: ModelCall = async function* stream() {
      yield { text: 'partial ' };
      throw new Error('provider exploded');
    };
    const d = deps({ model: failing });

    await expect(runTurn(request(), d.deps)).resolves.toMatchObject({
      status: 'refused',
      step: 'stream',
    });
    // No `text` on the settle write: the row keeps what streamed in. The
    // error lands as the structured envelope carrying a classified code.
    expect(d.store.finalized).toEqual([
      expect.objectContaining({ messageId: 'msg_2' }),
    ]);
    const decoded = decodeChatError(
      d.store.finalized[0]?.error as string | undefined,
    );
    expect(decoded.code).toBeDefined();
    expect(decoded.raw).toBe('provider exploded');
    expect(d.store.finalized[0]).not.toHaveProperty('text');
  });

  it('resolves the sampling once and hands it to the model call', async () => {
    const seen: Array<unknown> = [];
    const capturing: ModelCall = (call) => {
      seen.push(call.sampling);
      return (async function* () {
        yield { text: 'ok' };
      })();
    };
    const d = deps({ model: capturing });

    // No effort on a plain model: today's defaults, unchanged.
    await runTurn(request(), d.deps);
    expect(seen[0]).toEqual({ maxTokens: 4096, temperature: 0.7 });

    // An effort on a reasoning model rides the call as the resolved control.
    const reasoningModel = modelCatalogEntrySchema.parse({
      id: 'claude-fable-5',
      provider: 'anthropic',
      tags: ['chat'],
      supportsTools: true,
      supportsVision: true,
      contextWindow: 200_000,
      maxOutputTokens: 64_000,
      reasoning: { knob: 'budget-tokens' },
    });
    await runTurn(
      request({ model: reasoningModel, reasoningEffort: 'medium' }),
      d.deps,
    );
    expect(seen[1]).toEqual({
      maxTokens: 8192 + 4096,
      reasoning: { kind: 'thinking', budgetTokens: 8192 },
    });
  });

  it('assembles the context from the one contract', async () => {
    const d = deps();
    const outcome = await runTurn(request(), d.deps);

    if (outcome.status !== 'completed') throw new Error('expected completion');
    expect(outcome.context.blocks.map((block) => block.id)).toEqual([
      'mandatory-instructions',
      'agent-instructions',
      'untrusted-content-rules',
      'cache-breakpoint',
      'runtime-directives',
      'message-history',
    ]);
    // The user's message is the newest entry the model sees.
    expect(outcome.context.messages.at(-1)).toEqual({
      role: 'user',
      parts: [{ type: 'text', text: 'how do I return a printer?' }],
    });
  });
});

describe('runTurn — input guardrails', () => {
  it('short-circuits: nothing after the refusal runs', async () => {
    const model = vi.fn();
    const d = deps({
      model: model as unknown as ModelCall,
      inputFilters: [blockingFilter('chat_filter')],
    });

    const outcome = await runTurn(request(), d.deps);

    expect(outcome.status).toBe('refused');
    expect(outcome.steps).toEqual(['input-guardrails']);
    expect(model).not.toHaveBeenCalled();
    expect(d.usage).toEqual([]);
    expect(d.store.generations).toEqual([]);
  });

  it('records the refusal on the thread so the UI can explain it', async () => {
    const d = deps({ inputFilters: [blockingFilter('chat_filter')] });
    await runTurn(request(), d.deps);

    expect(d.store.appended).toEqual([
      expect.objectContaining({
        role: 'assistant',
        blockedReason: expect.stringContaining('chat_filter'),
      }),
    ]);
  });

  it('sends the model the rewritten text when a filter masked something', async () => {
    const seen: ChatMessage[][] = [];
    const capturing: ModelCall = (call) => {
      seen.push([...call.messages]);
      return (async function* () {
        yield { text: 'ok' };
      })();
    };
    const d = deps({
      model: capturing,
      inputFilters: [
        {
          name: 'pii',
          run: (text) => ({
            kind: 'modified',
            text: text.replace('a@b.com', '[EMAIL]'),
            categoryIds: ['email'],
            matchCount: 1,
          }),
        },
      ],
    });

    await runTurn(request({ userText: 'mail me at a@b.com' }), d.deps);

    expect(JSON.stringify(seen[0])).toContain('[EMAIL]');
    expect(JSON.stringify(seen[0])).not.toContain('a@b.com');
  });
});

describe('runTurn — execution resolution', () => {
  it('refuses before the model call when the credential forbids the mode', async () => {
    const model = vi.fn();
    const d = deps({ model: model as unknown as ModelCall });

    const outcome = await runTurn(
      request({
        credential: {
          authMethod: 'subscription-key',
          constraints: { execution: 'sandbox', harness: 'claude-code' },
        },
        executionMode: 'direct',
      }),
      d.deps,
    );

    expect(outcome).toMatchObject({
      status: 'refused',
      step: 'resolve-execution',
    });
    expect(outcome.steps).toEqual(['input-guardrails', 'resolve-execution']);
    expect(model).not.toHaveBeenCalled();
  });

  it('forces the harness a subscription credential is bound to', async () => {
    const d = deps();
    const outcome = await runTurn(
      request({
        credential: {
          authMethod: 'subscription-key',
          constraints: { execution: 'sandbox', harness: 'claude-code' },
        },
        executionMode: 'sandbox',
        harness: 'claude-code',
      }),
      d.deps,
    );

    if (outcome.status !== 'completed') throw new Error('expected completion');
    expect(outcome.execution).toMatchObject({ mode: 'sandbox' });
  });

  it('refuses a sandbox harness the credential is not bound to', async () => {
    const d = deps();
    const outcome = await runTurn(
      request({
        credential: {
          authMethod: 'subscription-key',
          constraints: { execution: 'sandbox', harness: 'claude-code' },
        },
        executionMode: 'sandbox',
        harness: 'opencode',
      }),
      d.deps,
    );

    expect(outcome).toMatchObject({
      status: 'refused',
      step: 'resolve-execution',
    });
  });
});

describe('runTurn — output guardrails', () => {
  it('filters mid-stream: the client never sees the unfiltered text', async () => {
    const d = deps({
      model: streamingModel(['reach me at a@b.com right away']),
      outputFilters: [
        {
          name: 'pii',
          run: (text) => ({
            kind: 'modified',
            text: text.replace('a@b.com', '[EMAIL]'),
            categoryIds: ['email'],
            matchCount: 1,
          }),
        },
      ],
    });

    const outcome = await runTurn(request(), d.deps);

    expect(outcome).toMatchObject({
      status: 'completed',
      text: 'reach me at [EMAIL] right away',
    });
    expect(d.chunks.join('')).not.toContain('a@b.com');
  });

  it('stops the stream on a refusal and still records the usage it spent', async () => {
    const d = deps({
      model: streamingModel(['a'.repeat(200), 'more text']),
      outputFilters: [blockingFilter('moderation_provider')],
    });

    const outcome = await runTurn(request(), d.deps);

    expect(outcome).toMatchObject({
      status: 'refused',
      step: 'output-guardrails',
    });
    expect(outcome.steps).toEqual([
      'input-guardrails',
      'resolve-execution',
      'assemble-context',
      'stream',
      'output-guardrails',
      'usage-ledger',
    ]);
    expect(d.chunks).toEqual([]);
    expect(d.usage).toHaveLength(1);
    // The refusal settles into the placeholder the turn streamed into.
    expect(d.store.finalized.at(-1)).toMatchObject({
      blockedReason: expect.stringContaining('moderation_provider'),
    });
    expect(d.store.generations).toEqual(['begin', 'end']);
  });
});

describe('runTurn — the tool loop', () => {
  function fakeExecutor(output: unknown = { status: 'ok', results: [] }): {
    executor: ChatToolExecutor;
    executed: ToolCallRequest[];
  } {
    const executed: ToolCallRequest[] = [];
    return {
      executed,
      executor: {
        wireTools: [
          {
            name: 'rag_search',
            description: 'Search the knowledge.',
            parameters: { type: 'object' },
          },
        ],
        execute(call) {
          executed.push(call);
          return Promise.resolve(output);
        },
      },
    };
  }

  /** Round 1 answers with a tool call, round 2 with the final text. */
  function oneToolRoundModel(): {
    model: ModelCall;
    requests: ModelCallRequest[];
  } {
    const requests: ModelCallRequest[] = [];
    return {
      requests,
      model: async function* stream(modelRequest) {
        requests.push(modelRequest);
        if (requests.length === 1) {
          yield { text: 'Let me check. ' };
          yield {
            text: '',
            usage: {
              inputTokens: 100,
              outputTokens: 10,
              totalTokens: 110,
              cachedInputTokens: 60,
            },
            toolCalls: [
              { id: 'call_1', name: 'rag_search', input: { query: 'returns' } },
            ],
          };
          return;
        }
        yield { text: 'Found it: 30 days.' };
        yield {
          text: '',
          usage: {
            inputTokens: 150,
            outputTokens: 8,
            totalTokens: 158,
            cachedInputTokens: 40,
          },
        };
      },
    };
  }

  it('executes the calls, settles parts in order, and answers', async () => {
    const { model, requests } = oneToolRoundModel();
    const { executor, executed } = fakeExecutor({ status: 'ok', hits: 3 });
    const d = deps({ model, tools: executor });

    const outcome = await runTurn(request(), d.deps);

    expect(outcome).toMatchObject({
      status: 'completed',
      text: 'Found it: 30 days.',
    });
    expect(executed).toEqual([
      { id: 'call_1', name: 'rag_search', input: { query: 'returns' } },
    ]);
    // The tool-round tail reset still writes empty text with flush — it
    // must not be skipped as an empty persistProgress.
    expect(d.store.streamed.some((write) => write.text === '')).toBe(true);
    // Round 1 settled its text and call BEFORE the tool ran; the result
    // followed; the finalize carried the whole ordered record.
    expect(d.store.partsWrites[0]).toEqual([
      { type: 'text', text: 'Let me check. ' },
      {
        type: 'tool-call',
        callId: 'call_1',
        capabilityId: 'rag_search',
        input: { query: 'returns' },
      },
    ]);
    expect(d.store.partsWrites[1]?.at(-1)).toMatchObject({
      type: 'tool-result',
      callId: 'call_1',
      output: { status: 'ok', hits: 3 },
      structured: true,
    });
    const finalParts = d.store.finalized[0]?.parts as MessagePart[];
    expect(finalParts.map((part) => part.type)).toEqual([
      'text',
      'tool-call',
      'tool-result',
      'text',
    ]);
    // Both rounds were billed; the ledger carries the sum — cache reads
    // included — and a turn that stayed inside the round budget carries no
    // step-limit mark.
    expect(outcome.status === 'completed' && outcome.usage).toMatchObject({
      inputTokens: 250,
      outputTokens: 18,
      totalTokens: 268,
      cachedInputTokens: 100,
    });
    expect(
      outcome.status === 'completed' && outcome.usage.stepLimitHit,
    ).toBeUndefined();
    // Round 2 replayed the settled parts as the turn's own transcript tail.
    const roundTwoTail = requests[1]?.messages.at(-1);
    expect(roundTwoTail?.role).toBe('assistant');
    expect(roundTwoTail?.parts.map((part) => part.type)).toEqual([
      'text',
      'tool-call',
      'tool-result',
    ]);
  });

  it('offers no tools when the lane equips none', async () => {
    const { model, requests } = oneToolRoundModel();
    const d = deps({ model });

    await runTurn(request(), d.deps);

    expect(requests[0]?.tools).toBeUndefined();
  });

  it('withholds the tools once the round budget is spent', async () => {
    const requests: ModelCallRequest[] = [];
    const alwaysCalling: ModelCall = async function* stream(req) {
      requests.push(req);
      if (req.tools !== undefined && req.tools.length > 0) {
        yield {
          text: '',
          toolCalls: [
            {
              id: `call_${requests.length}`,
              name: 'rag_search',
              input: { query: 'again' },
            },
          ],
        };
        return;
      }
      yield { text: 'Final answer without tools.' };
    };
    const { executor, executed } = fakeExecutor();
    const d = deps({ model: alwaysCalling, tools: executor });

    const outcome = await runTurn(request(), d.deps);

    expect(outcome).toMatchObject({
      status: 'completed',
      text: 'Final answer without tools.',
    });
    expect(executed).toHaveLength(MAX_TOOL_ROUNDS);
    expect(requests).toHaveLength(MAX_TOOL_ROUNDS + 1);
    expect(requests.at(-1)?.tools).toBeUndefined();
    // The spent budget is stamped on the usage (`stepLimitHit` is the UI's
    // contract for the "stopped at the cap" notice), on the outcome and the
    // settled message both.
    expect(outcome.status === 'completed' && outcome.usage.stepLimitHit).toBe(
      true,
    );
    expect(d.store.finalized[0]).toMatchObject({
      usage: expect.objectContaining({ stepLimitHit: true }),
    });
  });

  /** A model that asks a question and — if it were ever called again —
   *  would carry straight on. Round 2 existing at all is the regression. */
  function askingModel(): { model: ModelCall; requests: ModelCallRequest[] } {
    const requests: ModelCallRequest[] = [];
    let round = 0;
    return {
      requests,
      model: async function* stream(req) {
        requests.push(req);
        round += 1;
        if (round === 1) {
          yield {
            text: '',
            toolCalls: [
              {
                id: 'call_q',
                name: 'ask_question',
                input: { questions: [{ id: 'purpose', question: 'Why?' }] },
              },
            ],
          };
          return;
        }
        yield { text: 'Assuming you meant the first one.' };
      },
    };
  }

  function pausingExecutor(output: unknown): {
    executor: ChatToolExecutor;
    executed: ToolCallRequest[];
  } {
    const executed: ToolCallRequest[] = [];
    return {
      executed,
      executor: {
        wireTools: [
          {
            name: 'ask_question',
            description: 'Ask the person something.',
            parameters: { type: 'object' },
          },
        ],
        execute(call) {
          executed.push(call);
          return Promise.resolve(output);
        },
      },
    };
  }

  it('settles the turn on a question instead of answering its own', async () => {
    const { model, requests } = askingModel();
    const { executor } = pausingExecutor({
      status: 'awaiting-answer',
      requestId: 'approval_1',
      question: 'Why are you writing?',
    });
    const d = deps({ model, tools: executor });

    const outcome = await runTurn(request(), d.deps);

    // The model was called ONCE. A second round is the v0.2.91 regression:
    // the gate being retried straight past into acting on a guess.
    expect(requests).toHaveLength(1);
    expect(outcome).toMatchObject({ status: 'completed', paused: true });
    expect(outcome.status === 'completed' && outcome.text).toBe('');
  });

  it('records the pending question beside the call it came from', async () => {
    const { model } = askingModel();
    const { executor } = pausingExecutor({
      status: 'awaiting-answer',
      requestId: 'approval_1',
      question: 'Why are you writing?',
    });
    const d = deps({ model, tools: executor });

    await runTurn(request(), d.deps);

    const parts = d.store.finalized[0]?.parts as MessagePart[];
    expect(parts).toEqual([
      {
        type: 'tool-call',
        callId: 'call_q',
        capabilityId: 'ask_question',
        input: { questions: [{ id: 'purpose', question: 'Why?' }] },
      },
      expect.objectContaining({ type: 'tool-result' }),
      {
        type: 'human-input',
        requestId: 'approval_1',
        question: 'Why are you writing?',
      },
    ]);
  });

  // The reproducing case for the doubled paragraph: the model says something
  // BEFORE it asks. That text is settled with the round, and the finalize used
  // to append it again because `streamed` still pointed at the settled round.
  // My first pause test used empty pre-tool text, which is exactly why it
  // missed this.
  it('settles pre-question text exactly once', async () => {
    const intro = 'I searched the knowledge base and found nothing. ';
    const requests: ModelCallRequest[] = [];
    const model: ModelCall = async function* stream(req) {
      requests.push(req);
      yield { text: intro };
      yield {
        text: '',
        toolCalls: [
          { id: 'call_q', name: 'ask_question', input: { questions: [] } },
        ],
      };
    };
    const { executor } = pausingExecutor({
      status: 'awaiting-answer',
      requestId: 'approval_1',
      question: 'Who are they to you?',
    });
    const d = deps({ model, tools: executor });

    await runTurn(request(), d.deps);

    const parts = d.store.finalized[0]?.parts as MessagePart[];
    const texts = parts.filter((part) => part.type === 'text');
    expect(texts).toEqual([{ type: 'text', text: intro }]);
  });

  // A call the boundary REJECTED must not pause the turn — the model has to
  // get the error back and either fix the call or answer without asking.
  // Pausing on a rejected call would strand the thread with no question
  // pending and no reply coming.
  it('does not pause when the question was rejected', async () => {
    const { model, requests } = askingModel();
    const { executor } = pausingExecutor({
      status: 'invalid_args',
      message: 'Every question needs at least two options.',
    });
    const d = deps({ model, tools: executor });

    const outcome = await runTurn(request(), d.deps);

    expect(requests).toHaveLength(2);
    expect(outcome).toMatchObject({
      status: 'completed',
      text: 'Assuming you meant the first one.',
    });
    expect(outcome.status === 'completed' && outcome.paused).toBeUndefined();
    const parts = d.store.finalized[0]?.parts as MessagePart[];
    expect(parts.some((part) => part.type === 'human-input')).toBe(false);
  });

  it('deduplicates identical same-round calls, settling a result for every callId', async () => {
    const requests: ModelCallRequest[] = [];
    const model: ModelCall = async function* stream(req) {
      requests.push(req);
      if (requests.length === 1) {
        yield {
          text: '',
          toolCalls: [
            {
              id: 'call_a',
              name: 'rag_search',
              input: { query: 'returns', limit: 8 },
            },
            // Same arguments, different key order — still the same call.
            {
              id: 'call_b',
              name: 'rag_search',
              input: { limit: 8, query: 'returns' },
            },
            { id: 'call_c', name: 'rag_search', input: { query: 'shipping' } },
          ],
        };
        return;
      }
      yield { text: 'Done.' };
    };
    const executed: ToolCallRequest[] = [];
    const executor: ChatToolExecutor = {
      wireTools: [
        {
          name: 'rag_search',
          description: 'Search.',
          parameters: { type: 'object' },
        },
      ],
      execute(call) {
        executed.push(call);
        return Promise.resolve({ status: 'ok', echo: call.input });
      },
    };
    const d = deps({ model, tools: executor });

    const outcome = await runTurn(request(), d.deps);

    expect(outcome.status).toBe('completed');
    // Two distinct argument sets → two executions; three settled results.
    expect(executed).toHaveLength(2);
    const finalParts = d.store.finalized[0]?.parts as MessagePart[];
    const results = finalParts.filter(
      (part) => part.type === 'tool-result',
    ) as Array<{ callId: string; output: unknown }>;
    expect(results.map((part) => part.callId)).toEqual([
      'call_a',
      'call_b',
      'call_c',
    ]);
    // The duplicates share the one execution's output; the distinct call
    // keeps its own.
    expect(results[0]?.output).toBe(results[1]?.output);
    expect(results[2]?.output).not.toBe(results[0]?.output);
  });

  it('runs distinct same-round calls concurrently, results in call order', async () => {
    const requests: ModelCallRequest[] = [];
    const model: ModelCall = async function* stream(req) {
      requests.push(req);
      if (requests.length === 1) {
        yield {
          text: '',
          toolCalls: [
            { id: 'call_1', name: 'rag_search', input: { query: 'a' } },
            { id: 'call_2', name: 'rag_fetch', input: { ref: 'b' } },
          ],
        };
        return;
      }
      yield { text: 'Done.' };
    };
    let release!: () => void;
    const bothStarted = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = 0;
    const executor: ChatToolExecutor = {
      wireTools: [
        {
          name: 'rag_search',
          description: 'Search.',
          parameters: { type: 'object' },
        },
        {
          name: 'rag_fetch',
          description: 'Fetch.',
          parameters: { type: 'object' },
        },
      ],
      async execute(call) {
        started += 1;
        if (started === 2) release();
        // Each call waits for the OTHER to have started: sequential
        // execution would never release this gate and time the test out.
        await bothStarted;
        return { status: 'ok', tool: call.name };
      },
    };
    const d = deps({ model, tools: executor });

    const outcome = await runTurn(request(), d.deps);

    expect(outcome.status).toBe('completed');
    const finalParts = d.store.finalized[0]?.parts as MessagePart[];
    const results = finalParts.filter(
      (part) => part.type === 'tool-result',
    ) as Array<{ capabilityId: string }>;
    expect(results.map((part) => part.capabilityId)).toEqual([
      'rag_search',
      'rag_fetch',
    ]);
  }, 10_000);

  it('stops when the store reports a cancel and keeps what streamed', async () => {
    const { store, calls } = fakeStore({ cancelAfterStreamWrites: 1 });
    const short = 'x'.repeat(40);
    const endless: ModelCall = async function* stream() {
      yield { text: short };
      yield { text: 'Second chunk. ' };
      yield { text: 'Third chunk. ' };
    };
    const d = deps({ model: endless, store });

    const outcome = await runTurn(request(), d.deps);

    expect(outcome.status).toBe('completed');
    // The settle carried the short reply that had already cleared.
    const finalParts = calls.finalized[0]?.parts as MessagePart[];
    const text = finalParts.find((part) => part.type === 'text');
    expect(text).toEqual({ type: 'text', text: short });
    expect(calls.generations).toEqual(['begin', 'end']);
  });

  it('persists a short partial so a throw can still rescue streamText', async () => {
    const short = 'x'.repeat(40);
    const failing: ModelCall = async function* stream() {
      yield { text: short };
      throw new Error('provider died mid-answer');
    };
    const d = deps({ model: failing });

    await expect(runTurn(request(), d.deps)).resolves.toMatchObject({
      status: 'refused',
      step: 'stream',
    });
    expect(d.store.streamed.map((w) => w.text)).toContain(short);
  });

  it('answers a Stop within one poll interval while the provider is between bytes', async () => {
    // The very first poll write reports the cancel — the model never
    // produces a byte and never honors the abort, and the turn must still
    // settle instead of waiting for a chunk that will never come.
    const { store, calls } = fakeStore({ cancelAfterStreamWrites: 1 });
    const stalled: ModelCall = async function* stream() {
      await new Promise(() => undefined);
      yield { text: 'never' };
    };
    const d = deps({ model: stalled, store });

    const outcome = await runTurn(request(), d.deps);

    expect(outcome.status).toBe('completed');
    expect(calls.generations).toEqual(['begin', 'end']);
    // Nothing streamed; the settle is the empty stop, not a hang.
    expect(calls.finalized).toHaveLength(1);
  }, 10_000);
});

describe('runTurn — image attachments', () => {
  const ATTACHMENT = {
    fileId: 'blob1',
    fileName: 'shot.png',
    fileType: 'image/png',
    fileSize: 4096,
  };

  it('persists the attachment part on the user turn and replays it in context', async () => {
    const seen: ModelCallRequest[] = [];
    const recorder: ModelCall = async function* recorder(call) {
      seen.push(call);
      yield { text: 'A screenshot.' };
    };
    const d = deps({ model: recorder });
    await runTurn(request({ attachments: [ATTACHMENT] }), d.deps);

    expect(d.store.appended[0]).toMatchObject({
      role: 'user',
      parts: [
        { type: 'text', text: 'how do I return a printer?' },
        {
          type: 'attachment',
          name: 'shot.png',
          mediaType: 'image/png',
          fileId: 'blob1',
          sizeBytes: 4096,
        },
      ],
    });
    // Images share one derivation between the store and the model wire.
    const newest = seen[0]?.messages.at(-1);
    expect(newest?.parts).toEqual(d.store.appended[0]?.parts);
  });

  it('keeps the transcript appendix off the stored bubble and on the model wire', async () => {
    const { buildAudioTranscriptAppendix } = await import('./audio-transcript');
    const appendix = buildAudioTranscriptAppendix([
      {
        fileName: 'clip.m4a',
        status: 'completed',
        transcript: 'We made some modifications.',
        durationSec: 12,
      },
    ]);
    const audio = {
      fileId: 'blob_audio',
      fileName: 'clip.m4a',
      fileType: 'audio/mp4',
      fileSize: 2048,
    };
    const seen: ModelCallRequest[] = [];
    const recorder: ModelCall = async function* recorder(call) {
      seen.push(call);
      yield { text: 'Summary.' };
    };
    const d = deps({ model: recorder });
    await runTurn(
      request({
        userText: 'summarize this',
        attachments: [audio],
        audioTranscriptAppendix: appendix,
      }),
      d.deps,
    );

    expect(d.store.appended[0]).toMatchObject({
      role: 'user',
      parts: [
        { type: 'text', text: 'summarize this' },
        {
          type: 'attachment',
          name: 'clip.m4a',
          mediaType: 'audio/mp4',
          fileId: 'blob_audio',
        },
      ],
    });
    const newest = seen[0]?.messages.at(-1);
    expect(newest?.parts).toEqual([
      { type: 'text', text: `summarize this${appendix}` },
      {
        type: 'attachment',
        name: 'clip.m4a',
        mediaType: 'audio/mp4',
        fileId: 'blob_audio',
        sizeBytes: 2048,
      },
    ]);
  });

  it('hands the model call the catalog vision flag, both ways', async () => {
    const seen: ModelCallRequest[] = [];
    const recorder: ModelCall = async function* recorder(call) {
      seen.push(call);
      yield { text: 'ok' };
    };
    await runTurn(request(), deps({ model: recorder }).deps);
    expect(seen[0]?.vision).toBe(true);

    const blindModel = modelCatalogEntrySchema.parse({
      id: 'text-only',
      provider: 'anthropic',
      tags: ['chat'],
      supportsTools: true,
      supportsVision: false,
      contextWindow: 200_000,
    });
    await runTurn(
      request({ model: blindModel }),
      deps({ model: recorder }).deps,
    );
    expect(seen[1]?.vision).toBe(false);
  });
});
