import {
  harnessDefinitionSchema,
  modelCatalogEntrySchema,
  type HarnessDefinition,
} from '@tale/shared/schemas/providers';
import { describe, expect, it, vi } from 'vitest';

import { decodeChatError } from '../shared/chat-errors';
import {
  buildHarnessTable,
  type CredentialAuth,
} from '../shared/providers/resolve_execution';
import type { GuardrailFilter } from './guardrails';
import type { ChatToolExecutor, ToolCallRequest } from './tools';
import {
  CAP_CUT_CALL_OUTPUT,
  CAP_WITHHELD_CALL_OUTPUT,
  estimateCostCents,
  fixedLocaleNotice,
  LAST_TOOL_ROUND_NOTICE,
  MAX_TOOL_ROUNDS,
  runTurn,
  ThreadBusyError,
  TOOL_BUDGET_SPENT_NOTICE,
  TOOL_CALL_STOPPED_OUTPUT,
  TURN_STEPS,
  type ModelCall,
  type ModelCallRequest,
  type TurnDeps,
  type TurnRequest,
  type TurnStore,
  type UsageLedgerEntry,
} from './turn';
import {
  estimateJsonTokens,
  type ChatMessage,
  type MessagePart,
} from './types';

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
  /** The placeholder messageId each turn-open carried. */
  readonly generationMessageIds: Array<string | undefined>;
  /** Every store call, in order — the setup-cost contract asserts on this. */
  readonly ops: string[];
}

function fakeStore(
  options: {
    cancelAfterStreamWrites?: number;
    /** Report the Stop on the tool-round boundary flush — a cancel that
     *  landed while the round streamed its calls, before the tools ran. */
    cancelOnToolBoundary?: boolean;
    /** Report the Stop on the post-batch verdict read — a cancel that landed
     *  while the tools were executing. */
    cancelOnToolVerdict?: boolean;
  } = {},
): {
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
    ops: [],
  };
  return {
    calls,
    store: {
      beginTurn(setup) {
        calls.ops.push('beginTurn');
        // Record the merged open as the row appends it commits, so ordering
        // assertions read the same ledger as before the merge.
        const appendRow = (row: Record<string, unknown>) => {
          calls.appended.push(row);
          return {
            id: `msg_${calls.appended.length}`,
            sequence: calls.appended.length,
          };
        };
        const userMessage =
          setup.userParts !== undefined
            ? appendRow({
                organizationId: setup.organizationId,
                threadId: setup.threadId,
                role: 'user',
                parts: setup.userParts,
              })
            : undefined;
        const assistantMessage = appendRow({
          organizationId: setup.organizationId,
          threadId: setup.threadId,
          role: 'assistant',
          parts: [],
          ...(setup.truncation !== undefined
            ? { truncation: setup.truncation }
            : {}),
        });
        calls.generations.push('begin');
        calls.generationMessageIds.push(assistantMessage.id);
        return Promise.resolve({
          ...(userMessage !== undefined ? { userMessage } : {}),
          assistantMessage,
        });
      },
      appendMessage(message) {
        calls.ops.push('appendMessage');
        calls.appended.push(message);
        return Promise.resolve({
          id: `msg_${calls.appended.length}`,
          sequence: calls.appended.length,
        });
      },
      streamProgress(update) {
        calls.ops.push('streamProgress');
        calls.streamed.push({
          messageId: update.messageId,
          text: update.text,
        });
        const cancelAt = options.cancelAfterStreamWrites;
        // The tool-round boundary is the only write that is both flushed and
        // empty; the post-batch verdict is the only empty, unflushed one.
        const isEmpty = update.text === '';
        const atBoundary =
          options.cancelOnToolBoundary === true &&
          isEmpty &&
          update.flush === true;
        const atVerdict =
          options.cancelOnToolVerdict === true && isEmpty && !update.flush;
        return Promise.resolve({
          cancelRequested:
            atBoundary ||
            atVerdict ||
            (cancelAt !== undefined && calls.streamed.length >= cancelAt),
        });
      },
      updateAssistantParts(update) {
        calls.ops.push('updateAssistantParts');
        calls.partsWrites.push(update.parts.map((part) => ({ ...part })));
        return Promise.resolve();
      },
      finalizeAssistantMessage(message) {
        calls.ops.push('finalizeAssistantMessage');
        calls.finalized.push(message);
        return Promise.resolve();
      },
      endGeneration() {
        calls.ops.push('endGeneration');
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

describe('runTurn — the at-most-one-turn claim', () => {
  it('propagates a busy refusal from the open and never closes the other turn', async () => {
    const { store, calls } = fakeStore();
    const held: TurnStore = {
      ...store,
      beginTurn() {
        calls.ops.push('beginTurn');
        return Promise.reject(new ThreadBusyError('thread_1'));
      },
    };
    const d = deps({ store: held });

    await expect(runTurn(request(), d.deps)).rejects.toBeInstanceOf(
      ThreadBusyError,
    );

    // The generation row belongs to the turn that won it: the loser runs no
    // endGeneration (which would close the winner's turn), appends no
    // refusal row, and never dispatches the model.
    expect(calls.ops).toEqual(['beginTurn']);
    expect(d.chunks).toEqual([]);
    expect(d.usage).toEqual([]);
  });
});

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

  it('books the usage against the API key that authenticated the turn', async () => {
    const d = deps();
    await runTurn(request({ apiKeyId: 'key_1' }), d.deps);

    expect(d.usage).toEqual([
      expect.objectContaining({ userId: 'user_1', apiKeyId: 'key_1' }),
    ]);
  });

  it('opens the generation row before streaming and always closes it', async () => {
    const d = deps();
    await runTurn(request(), d.deps);

    expect(d.store.generations).toEqual(['begin', 'end']);
    // The streaming-progress writes double as the turn's heartbeat.
    expect(d.store.streamed.length).toBeGreaterThan(0);
  });

  it('opens the turn with ONE store write before the model dispatches', async () => {
    const { store, calls } = fakeStore();
    let opsAtDispatch: readonly string[] | undefined;
    const model: ModelCall = async function* stream() {
      opsAtDispatch = [...calls.ops];
      yield { text: 'ok' };
    };
    const d = deps({ model, store });
    await runTurn(request(), d.deps);

    // The setup wait is per-syscall: each store round-trip before the first
    // model dispatch is an authenticated callback the backend re-validates
    // one by one. The whole open — user message, placeholder, generation row
    // — must stay ONE call; a second pre-dispatch write is a setup-latency
    // regression.
    expect(opsAtDispatch).toEqual(['beginTurn']);
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
    // The full declared 64k ceiling rides the wire — the answer keeps what
    // the 8192 thinking budget leaves of it, not a 4096-token constant.
    expect(seen[1]).toEqual({
      maxTokens: 64_000,
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

  it('records the user message and the refusal on the thread so the UI can explain it', async () => {
    const d = deps({ inputFilters: [blockingFilter('chat_filter')] });
    await runTurn(request(), d.deps);

    // The transcript shows what was refused: the user's row first, then
    // the blocked reply — never a refusal answering a message that is not
    // there.
    expect(d.store.appended).toEqual([
      expect.objectContaining({
        role: 'user',
        parts: [{ type: 'text', text: 'how do I return a printer?' }],
      }),
      expect.objectContaining({
        role: 'assistant',
        blockedReason: expect.stringContaining('chat_filter'),
      }),
    ]);
    expect(d.store.generations).toEqual([]);
  });

  it('persists the text as the chain left it when a later step blocks', async () => {
    const masking: GuardrailFilter = {
      name: 'pii',
      run: (text) => ({
        kind: 'modified',
        text: text.replace('printer', '[ITEM]'),
        categoryIds: ['item'],
        matchCount: 1,
      }),
    };
    const d = deps({
      inputFilters: [masking, blockingFilter('moderation_provider')],
    });
    await runTurn(request(), d.deps);

    expect(d.store.appended[0]).toMatchObject({
      role: 'user',
      parts: [{ type: 'text', text: 'how do I return a [ITEM]?' }],
    });
  });

  it('appends only the refusal on a regenerate — the user row already exists', async () => {
    const d = deps({ inputFilters: [blockingFilter('chat_filter')] });
    await runTurn(request({ appendUserMessage: false }), d.deps);

    expect(d.store.appended.map((m) => m.role)).toEqual(['assistant']);
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
    // The budget is steered, not silent. The last offered round tells the
    // model to spend its remaining calls in parallel; the forced round
    // tells it the budget is gone — withheld tools are invisible on the
    // wire, and an uninformed model narrates its next lookup instead of
    // answering.
    const lastOffered = requests[MAX_TOOL_ROUNDS - 1];
    expect(lastOffered?.tools).toBeDefined();
    expect(lastOffered?.messages.at(-1)).toEqual({
      role: 'user',
      parts: [{ type: 'text', text: LAST_TOOL_ROUND_NOTICE }],
    });
    expect(requests.at(-1)?.messages.at(-1)).toEqual({
      role: 'user',
      parts: [{ type: 'text', text: TOOL_BUDGET_SPENT_NOTICE }],
    });
    // Earlier rounds carry no notice at all, and neither notice is ever
    // persisted — the notices ride the wire only.
    const textsOf = (parts: readonly MessagePart[]): string[] =>
      parts.flatMap((part) => (part.type === 'text' ? [part.text] : []));
    for (const req of requests.slice(0, MAX_TOOL_ROUNDS - 1)) {
      const texts = req.messages.flatMap((m) => textsOf(m.parts));
      expect(texts).not.toContain(LAST_TOOL_ROUND_NOTICE);
      expect(texts).not.toContain(TOOL_BUDGET_SPENT_NOTICE);
    }
    const storedTexts = textsOf(
      (d.store.finalized[0]?.parts ?? []) as MessagePart[],
    );
    expect(storedTexts).not.toContain(LAST_TOOL_ROUND_NOTICE);
    expect(storedTexts).not.toContain(TOOL_BUDGET_SPENT_NOTICE);
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

  // The two Stop paths #2962 named. Both break AFTER the round settles its
  // text, so the finalize would append `streamed` a second time without the
  // `roundSettled` guard. The pre-tool text has to be NON-EMPTY: a model that
  // says nothing before calling passes straight through the bug, which is why
  // it went unnoticed.
  const introducingModel = (intro: string): ModelCall =>
    async function* stream() {
      yield { text: intro };
      yield {
        text: '',
        toolCalls: [
          { id: 'call_1', name: 'rag_search', input: { query: 'returns' } },
        ],
      };
    };

  const searchExecutor = (): ChatToolExecutor => ({
    wireTools: [
      {
        name: 'rag_search',
        description: 'Search.',
        parameters: { type: 'object' },
      },
    ],
    execute: () => Promise.resolve({ status: 'ok' }),
  });

  it('settles pre-tool text once when Stop lands before the tools run', async () => {
    const intro = 'Let me look that up. ';
    const { store, calls } = fakeStore({ cancelOnToolBoundary: true });
    const executed: ToolCallRequest[] = [];
    const executor = searchExecutor();
    const d = deps({
      model: introducingModel(intro),
      tools: {
        ...executor,
        execute: (call) => {
          executed.push(call);
          return Promise.resolve({ status: 'ok' });
        },
      },
      store,
    });

    await runTurn(request(), d.deps);

    // The Stop landed at the boundary, so the tools never started...
    expect(executed).toEqual([]);
    // ...and the intro is recorded exactly once.
    const parts = calls.finalized[0]?.parts as MessagePart[];
    expect(parts.filter((part) => part.type === 'text')).toEqual([
      { type: 'text', text: intro },
    ]);
    // ...and the call the model made is still ANSWERED on the record — an
    // unanswered call would fail every later turn on the thread at the
    // provider.
    expect(parts.filter((part) => part.type !== 'text')).toEqual([
      {
        type: 'tool-call',
        callId: 'call_1',
        capabilityId: 'rag_search',
        input: { query: 'returns' },
      },
      {
        type: 'tool-result',
        callId: 'call_1',
        capabilityId: 'rag_search',
        output: TOOL_CALL_STOPPED_OUTPUT,
        structured: true,
      },
    ]);
  });

  it('never settles a round of tool calls for a Stop the final flush already reported', async () => {
    // The cancel lands on the round's last progress write — after the
    // model's text but before the tool calls settle. The round must report
    // it, so the loop ends without running the tools.
    const { store, calls } = fakeStore({ cancelAfterStreamWrites: 1 });
    const executed: ToolCallRequest[] = [];
    const executor = searchExecutor();
    const d = deps({
      model: introducingModel('Looking. '),
      tools: {
        ...executor,
        execute: (call) => {
          executed.push(call);
          return Promise.resolve({ status: 'ok' });
        },
      },
      store,
    });

    const outcome = await runTurn(request(), d.deps);

    expect(outcome.status).toBe('completed');
    expect(executed).toEqual([]);
    const parts = calls.finalized[0]?.parts as MessagePart[];
    expect(parts.some((part) => part.type === 'tool-call')).toBe(false);
  });

  it('settles pre-tool text once when Stop lands while the tools run', async () => {
    const intro = 'Searching now. ';
    const { store, calls } = fakeStore({ cancelOnToolVerdict: true });
    const d = deps({
      model: introducingModel(intro),
      tools: searchExecutor(),
      store,
    });

    await runTurn(request(), d.deps);

    const parts = calls.finalized[0]?.parts as MessagePart[];
    expect(parts.filter((part) => part.type === 'text')).toEqual([
      { type: 'text', text: intro },
    ]);
    // The batch that finished keeps its record — the Stop ends the loop, it
    // does not erase the round.
    expect(parts.some((part) => part.type === 'tool-result')).toBe(true);
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

    expect(outcome).toMatchObject({ status: 'completed', cancelled: true });
    // The settle carried the short reply that had already cleared — as a
    // stop, never as a complete reply.
    expect(calls.finalized[0]).toMatchObject({ cancelled: true });
    const finalParts = calls.finalized[0]?.parts as MessagePart[];
    const text = finalParts.find((part) => part.type === 'text');
    expect(text).toEqual({ type: 'text', text: short });
    expect(calls.generations).toEqual(['begin', 'end']);
  });

  /**
   * A reply the output cap cut short settled `complete` with nothing marking
   * it, and a cancelled turn's usage was the platform's guess minus the
   * assistant's whole tool preamble — ~63% under what the same prompt had
   * just billed. The stamp now carries why the model stopped and whether
   * the counts are an estimate; the estimate charges the tools.
   */
  it('stamps the reason the model stopped — stop, or length when the cap cut the reply', async () => {
    for (const reason of ['stop', 'length'] as const) {
      const reporting: ModelCall = async function* stream() {
        yield { text: '1\n2\n' };
        yield {
          text: '',
          usage: { inputTokens: 100, outputTokens: 64, totalTokens: 164 },
          finishReason: reason,
        };
      };
      const d = deps({ model: reporting });
      const outcome = await runTurn(request(), d.deps);
      expect(outcome).toMatchObject({
        status: 'completed',
        usage: { finishReason: reason },
      });
      expect(outcome).not.toMatchObject({ usage: { estimated: true } });
      expect(d.store.finalized[0]).not.toHaveProperty('cancelled');
      expect(d.store.finalized[0]).toMatchObject({
        usage: expect.objectContaining({ finishReason: reason }),
      });
    }
  });

  it('stamps cancelled, and estimates what the abort lost — the offered tools charged', async () => {
    const { store, calls } = fakeStore({ cancelAfterStreamWrites: 1 });
    const endless: ModelCall = async function* stream() {
      yield { text: 'x'.repeat(400) };
      yield { text: 'Second chunk. ' };
      yield { text: 'Third chunk. ' };
    };
    const wireTools = [
      {
        name: 'rag_search',
        description: 'Search the workspace knowledge for passages.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'What to look for' },
            limit: { type: 'integer' },
          },
          required: ['query'],
        },
      },
    ];
    const executor: ChatToolExecutor = {
      wireTools,
      execute: () => Promise.resolve({ status: 'ok', results: [] }),
    };
    const d = deps({ model: endless, store, tools: executor });
    const outcome = await runTurn(request(), d.deps);
    if (outcome.status !== 'completed') throw new Error('expected completion');
    expect(outcome.cancelled).toBe(true);
    expect(outcome.usage.finishReason).toBe('cancelled');
    expect(outcome.usage.estimated).toBe(true);
    // The same turn, tools withheld: the difference is the tools' schema
    // at the JSON rate — the share the old estimate silently dropped.
    const bare = fakeStore({ cancelAfterStreamWrites: 1 });
    const plain = deps({ model: endless, store: bare.store, tools: undefined });
    const withoutTools = await runTurn(request(), plain.deps);
    if (withoutTools.status !== 'completed')
      throw new Error('expected completion');
    expect(outcome.usage.inputTokens - withoutTools.usage.inputTokens).toBe(
      estimateJsonTokens(wireTools),
    );
    // The ledger books the same figures the message carries.
    expect(d.usage[0]).toMatchObject({
      inputTokens: outcome.usage.inputTokens,
      outputTokens: outcome.usage.outputTokens,
    });
    expect(calls.finalized[0]).toMatchObject({
      cancelled: true,
      usage: expect.objectContaining({
        finishReason: 'cancelled',
        estimated: true,
      }),
    });
  });

  it('keeps a cancelled round’s reported input (an Anthropic message_start) and estimates only the output', async () => {
    const { store } = fakeStore({ cancelAfterStreamWrites: 1 });
    const anthropicLike: ModelCall = async function* stream() {
      yield {
        text: '',
        usage: {
          inputTokens: 2711,
          outputTokens: 0,
          totalTokens: 2711,
          cachedInputTokens: 512,
        },
      };
      yield { text: 'y'.repeat(400) };
      yield { text: 'more' };
    };
    const d = deps({ model: anthropicLike, store });
    const outcome = await runTurn(request(), d.deps);
    if (outcome.status !== 'completed') throw new Error('expected completion');
    expect(outcome.usage).toMatchObject({
      inputTokens: 2711,
      cachedInputTokens: 512,
      finishReason: 'cancelled',
      estimated: true,
    });
    expect(outcome.usage.outputTokens).toBeGreaterThan(0);
  });

  it('marks a round the provider never counted as estimated, and one it counted as not', async () => {
    const guessed = await runTurn(request(), deps().deps);
    if (guessed.status !== 'completed') throw new Error('expected completion');
    expect(guessed.usage.estimated).toBe(true);
    expect(guessed.usage.finishReason).toBeUndefined();

    const reporting: ModelCall = async function* stream() {
      yield {
        text: 'counted',
        usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
      };
    };
    const counted = await runTurn(request(), deps({ model: reporting }).deps);
    if (counted.status !== 'completed') throw new Error('expected completion');
    expect(counted.usage.estimated).toBeUndefined();
  });

  it('settles a reply nobody stopped as complete, with no cancelled flag', async () => {
    const { store, calls } = fakeStore();
    const d = deps({ store });
    const outcome = await runTurn(request(), d.deps);
    expect(outcome.status).toBe('completed');
    expect(outcome).not.toHaveProperty('cancelled');
    expect(calls.finalized[0]).not.toHaveProperty('cancelled');
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

/**
 * The REST send's `locale` reached the prompt as the app's own directive,
 * which lets the prompt's language win — the field read as doing nothing on
 * an English prompt. `localeFixed` rides the request into the context
 * contract, where the directive names the reply language; and because a
 * reasoning model on a short prompt still slipped past one sentence at the
 * end of the system prompt, the same instruction rides the newest user
 * message on the wire — never the store. A request without the flag (the
 * app lane) keeps the directive it always had, and no notice.
 */
describe('runTurn — the reply language', () => {
  const typed = 'how do I return a printer?';

  it('names the reply language on the system prompt and the newest message when the caller fixed it, and lets the prompt win otherwise', async () => {
    const seen: ModelCallRequest[] = [];
    const capturing: ModelCall = async function* stream(call) {
      seen.push(call);
      yield { text: 'Klar.' };
    };
    const fixed = deps({ model: capturing });
    await runTurn(request({ locale: 'de', localeFixed: true }), fixed.deps);
    const open = deps({ model: capturing });
    await runTurn(request({ locale: 'de' }), open.deps);

    // The system prompt names the language in words, the tag beside it.
    expect(seen[0]?.system).toContain(
      "Reply language: German (de). Write the whole reply in German, whatever language the user writes in — the caller fixed the reply language; do not switch to the user's language.",
    );
    // The newest user message ends with the notice on the wire …
    const notice = fixedLocaleNotice('de');
    expect(notice).toContain('German (de)');
    const newest = seen[0]?.messages.at(-1);
    expect(newest?.role).toBe('user');
    expect(newest?.parts).toEqual([{ type: 'text', text: typed + notice }]);
    // … and never in the store: the row keeps what the person typed.
    expect(fixed.store.appended[0]).toMatchObject({
      role: 'user',
      parts: [{ type: 'text', text: typed }],
    });
    expect(JSON.stringify(fixed.store.finalized)).not.toContain(
      'the caller fixed the reply language',
    );

    // The app lane keeps its directive and gets no notice.
    expect(seen[1]?.system).toContain("Respond in the user's language (de).");
    expect(seen[1]?.system).not.toContain(
      'the caller fixed the reply language',
    );
    expect(seen[1]?.messages.at(-1)?.parts).toEqual([
      { type: 'text', text: typed },
    ]);
  });

  it('keeps the notice on the message through every tool round', async () => {
    const requests: ModelCallRequest[] = [];
    const calling: ModelCall = async function* stream(call) {
      requests.push(call);
      if (requests.length === 1) {
        yield {
          text: '',
          toolCalls: [
            { id: 'call_1', name: 'rag_search', input: { query: 'returns' } },
          ],
        };
        return;
      }
      yield { text: 'Dreißig Tage.' };
    };
    const executor: ChatToolExecutor = {
      wireTools: [
        {
          name: 'rag_search',
          description: 'Search the knowledge.',
          parameters: { type: 'object' },
        },
      ],
      execute: () => Promise.resolve({ status: 'ok', results: [] }),
    };
    await runTurn(
      request({ locale: 'de', localeFixed: true }),
      deps({ model: calling, tools: executor }).deps,
    );

    expect(requests).toHaveLength(2);
    const notice = fixedLocaleNotice('de');
    for (const req of requests) {
      const userTexts = req.messages
        .filter((message) => message.role === 'user')
        .flatMap((message) =>
          message.parts.flatMap((part) =>
            part.type === 'text' ? [part.text] : [],
          ),
        );
      expect(userTexts).toContain(typed + notice);
    }
  });
});

/**
 * `maxOutputTokens` documented a per-TURN cap, and the pipeline resolved it
 * once and handed the same ceiling to every model round — a tool-calling
 * turn could spend it several times over (134 tokens on a cap of 120 in the
 * evaluation), and a round the cap cut mid-call still ran the truncated
 * call and let the next round settle `stop`. The cap is now a budget the
 * rounds share: a later round gets what the earlier ones left, a round that
 * would start with nothing left is not run, a cut round marks the whole turn
 * `length` however the final round ended, and the calls of a cut round are
 * not executed — their arguments are what the cap truncated.
 */
describe('runTurn — the per-turn output cap', () => {
  function capturingExecutor(): {
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
          return Promise.resolve({ status: 'ok', results: [] });
        },
      },
    };
  }

  /** Round 1 spends `outputTokens` and ends on a tool call with the given
   *  finish reason; round 2 answers and stops. */
  function twoRoundModel(round1: {
    outputTokens: number;
    finishReason: 'stop' | 'length';
    /** Round 1's call as the wire decoded it; the default parsed whole. */
    call?: { id: string; name: string; input: unknown; rawInput?: string };
  }): { model: ModelCall; requests: ModelCallRequest[] } {
    const requests: ModelCallRequest[] = [];
    return {
      requests,
      model: async function* stream(call) {
        requests.push(call);
        if (requests.length === 1) {
          yield { text: 'Let me check. ' };
          yield {
            text: '',
            usage: {
              inputTokens: 100,
              outputTokens: round1.outputTokens,
              totalTokens: 100 + round1.outputTokens,
            },
            toolCalls: [
              round1.call ?? {
                id: 'call_1',
                name: 'rag_search',
                input: { query: 'returns' },
              },
            ],
            finishReason: round1.finishReason,
          };
          return;
        }
        yield { text: 'Found it: 30 days.' };
        yield {
          text: '',
          usage: { inputTokens: 150, outputTokens: 8, totalTokens: 158 },
          finishReason: 'stop',
        };
      },
    };
  }

  it('hands a later round what the earlier rounds left of the cap', async () => {
    const { model, requests } = twoRoundModel({
      outputTokens: 100,
      finishReason: 'stop',
    });
    const { executor, executed } = capturingExecutor();
    const outcome = await runTurn(
      request({ maxOutputTokens: 120 }),
      deps({ model, tools: executor }).deps,
    );

    expect(requests).toHaveLength(2);
    expect(requests[0]?.sampling.maxTokens).toBe(120);
    expect(requests[1]?.sampling.maxTokens).toBe(20);
    expect(executed).toHaveLength(1);
    expect(outcome).toMatchObject({
      status: 'completed',
      text: 'Found it: 30 days.',
      usage: { outputTokens: 108, finishReason: 'stop' },
    });
  });

  it('does not run a round that would start with nothing left, and settles the turn as cut', async () => {
    // Round 1 reports the whole cap spent and a clean stop of its own: the
    // budget alone ends the turn — no second model call, `length` stamped.
    const { model, requests } = twoRoundModel({
      outputTokens: 120,
      finishReason: 'stop',
    });
    const { executor, executed } = capturingExecutor();
    const d = deps({ model, tools: executor });
    const outcome = await runTurn(request({ maxOutputTokens: 120 }), d.deps);

    expect(requests).toHaveLength(1);
    expect(executed).toHaveLength(1);
    expect(outcome).toMatchObject({
      status: 'completed',
      usage: { outputTokens: 120, finishReason: 'length' },
    });
    // The settled record is the round's text, its call and its result — no
    // second text part, since the final round never ran.
    const parts = d.store.finalized[0]?.parts as MessagePart[];
    expect(parts.map((part) => part.type)).toEqual([
      'text',
      'tool-call',
      'tool-result',
    ]);
    expect(d.store.finalized[0]).toMatchObject({
      usage: expect.objectContaining({ finishReason: 'length' }),
    });
    expect(d.store.finalized[0]).not.toHaveProperty('cancelled');
  });

  it('marks the whole turn length when an earlier round was cut, and does not run the cut round’s calls', async () => {
    // No caller cap: the model's own ceiling cut round 1 mid-call. Round 2
    // ends cleanly — the reply is still a cut reply, and the truncated call
    // settled without running.
    const { model, requests } = twoRoundModel({
      outputTokens: 64,
      finishReason: 'length',
    });
    const { executor, executed } = capturingExecutor();
    const d = deps({ model, tools: executor });
    const outcome = await runTurn(request(), d.deps);

    expect(requests).toHaveLength(2);
    expect(executed).toHaveLength(0);
    expect(outcome).toMatchObject({
      status: 'completed',
      text: 'Found it: 30 days.',
      usage: { finishReason: 'length' },
    });
    const parts = d.store.finalized[0]?.parts as MessagePart[];
    expect(parts).toEqual([
      { type: 'text', text: 'Let me check. ' },
      {
        type: 'tool-call',
        callId: 'call_1',
        capabilityId: 'rag_search',
        input: { query: 'returns' },
      },
      {
        type: 'tool-result',
        callId: 'call_1',
        capabilityId: 'rag_search',
        // The call's arguments parsed whole — the cap fell AFTER them — so
        // the record says the round ended and the call was withheld, not
        // that the arguments were cut (2026-09-14 evaluation, g6-3).
        output: CAP_WITHHELD_CALL_OUTPUT,
        structured: true,
      },
      { type: 'text', text: 'Found it: 30 days.' },
    ]);
    // The model read the refusal on the wire, paired with its call.
    const fedBack = requests[1]?.messages.at(-1);
    expect(fedBack?.role).toBe('assistant');
    expect(fedBack?.parts).toContainEqual(
      expect.objectContaining({
        type: 'tool-result',
        callId: 'call_1',
        output: CAP_WITHHELD_CALL_OUTPUT,
      }),
    );
  });

  it('says the arguments were cut when the cap fell inside them', async () => {
    // The wire kept the raw text because it no longer parsed: the cap
    // truncated the call itself, and the record says so — the sibling of
    // the withheld case above (2026-09-14 evaluation, g6-3).
    const { model } = twoRoundModel({
      outputTokens: 64,
      finishReason: 'length',
      call: {
        id: 'call_1',
        name: 'rag_search',
        input: {},
        rawInput: '{"query": "ret',
      },
    });
    const { executor, executed } = capturingExecutor();
    const d = deps({ model, tools: executor });
    await runTurn(request(), d.deps);

    expect(executed).toHaveLength(0);
    const parts = d.store.finalized[0]?.parts as MessagePart[];
    expect(parts).toContainEqual({
      type: 'tool-result',
      callId: 'call_1',
      capabilityId: 'rag_search',
      output: CAP_CUT_CALL_OUTPUT,
      structured: true,
    });
    expect(parts).not.toContainEqual(
      expect.objectContaining({ output: CAP_WITHHELD_CALL_OUTPUT }),
    );
  });

  it('leaves the sampling alone across rounds when the caller set no cap', async () => {
    const { model, requests } = twoRoundModel({
      outputTokens: 100,
      finishReason: 'stop',
    });
    const { executor } = capturingExecutor();
    const outcome = await runTurn(
      request(),
      deps({ model, tools: executor }).deps,
    );

    expect(requests).toHaveLength(2);
    expect(requests[0]?.sampling).toEqual({
      maxTokens: 4096,
      temperature: 0.7,
    });
    expect(requests[1]?.sampling).toEqual(requests[0]?.sampling);
    expect(outcome).toMatchObject({ usage: { finishReason: 'stop' } });
  });
});

/**
 * `costEstimateCents` reached the wire as the raw double the rates produced
 * (`0.042601999999999994` in the evaluation), and the ledger booked the same
 * noise — both call this one formula. It rounds to a millionth of a cent,
 * so the message stamp and the ledger keep agreeing at a fixed scale.
 */
describe('estimateCostCents — the one cost formula', () => {
  const pricing = (
    inputCentsPerMillion: number,
    outputCentsPerMillion: number,
  ) =>
    modelCatalogEntrySchema.parse({
      ...MODEL,
      pricing: { inputCentsPerMillion, outputCentsPerMillion },
    }).pricing;

  it('rounds to a millionth of a cent', () => {
    // Raw: (14200 / 1e6) * 3 + (10 / 1e6) * 15 = 0.042749999999999996.
    expect(estimateCostCents(14200, 10, pricing(3, 15))).toBe(0.04275);
    expect(estimateCostCents(1000, 200, pricing(300, 1500))).toBe(0.6);
    // Rounded, not floored: a sub-micro-cent turn keeps its nearest step.
    expect(estimateCostCents(26, 0, pricing(0.1, 0))).toBe(0.000003);
    // No price: an honest zero, never a guessed rate.
    expect(estimateCostCents(1000, 1000, undefined)).toBe(0);
  });
});

/**
 * A reply that produced no text settles with NO text part — the contract
 * promises exactly that for a cap-emptied reply ("`finishReason: "length"`,
 * no text part"); an empty `{type: "text", text: ""}` used to be written, so
 * the documented detection never fired (2026-09-14 evaluation, g6-2).
 */
describe('a reply with no text settles without a text part', () => {
  it('keeps the reasoning part and writes no text part when the cap emptied the reply', async () => {
    const reasoningOnly: ModelCall = async function* stream() {
      yield { text: '', reasoning: 'The user asks to explain quantum' };
      yield {
        text: '',
        usage: { inputTokens: 2695, outputTokens: 16, totalTokens: 2711 },
        finishReason: 'length',
      };
    };
    const d = deps({ model: reasoningOnly });
    const outcome = await runTurn(request(), d.deps);

    expect(outcome).toMatchObject({
      status: 'completed',
      usage: { finishReason: 'length' },
    });
    const parts = d.store.finalized[0]?.parts as MessagePart[];
    expect(parts.map((part) => part.type)).toEqual(['reasoning']);
    expect(parts.some((part) => part.type === 'text')).toBe(false);
  });

  it('settles an entirely empty reply with no parts at all', async () => {
    const nothing: ModelCall = async function* stream() {
      yield {
        text: '',
        usage: { inputTokens: 10, outputTokens: 0, totalTokens: 10 },
        finishReason: 'stop',
      };
    };
    const d = deps({ model: nothing });
    await runTurn(request(), d.deps);
    expect(d.store.finalized[0]?.parts).toEqual([]);
  });
});
