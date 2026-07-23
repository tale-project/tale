import { describe, expect, it, vi } from 'vitest';

import {
  buildHarnessTable,
  type CredentialAuth,
} from '../shared/providers/resolve_execution';
import {
  harnessConnectorSchema,
  modelCatalogEntrySchema,
  type HarnessConnector,
} from '../shared/schemas/providers';
import type { GuardrailFilter } from './guardrails';
import {
  runTurn,
  TURN_STEPS,
  type ModelCall,
  type TurnDeps,
  type TurnRequest,
  type TurnStore,
  type UsageLedgerEntry,
} from './turn';
import type { ChatMessage } from './types';

/**
 * The pipeline's contract is its ORDER and its short-circuits. Every outside
 * dependency is a fake here — no provider, no Convex, no network — so what the
 * tests observe is exactly the sequence of steps and what each one did.
 */

const ORG = 'org_1';

function harness(
  slug: string,
  policy: { managed: boolean; byo: boolean },
): HarnessConnector {
  return harnessConnectorSchema.parse({
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
  readonly generations: string[];
  heartbeats: number;
}

function fakeStore(): { store: TurnStore; calls: StoreCalls } {
  const calls: StoreCalls = { appended: [], generations: [], heartbeats: 0 };
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
      beginGeneration() {
        calls.generations.push('begin');
        return Promise.resolve();
      },
      heartbeat() {
        calls.heartbeats += 1;
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
    streamId: 'stream_1',
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
    expect(d.store.heartbeats).toBeGreaterThan(0);
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

  it('closes the generation row even when the model call throws', async () => {
    const failing: ModelCall = () => {
      throw new Error('provider exploded');
    };
    const d = deps({ model: failing });

    await expect(runTurn(request(), d.deps)).rejects.toThrow(
      'provider exploded',
    );
    expect(d.store.generations).toEqual(['begin', 'end']);
  });

  it('persists the user message and the assistant answer', async () => {
    const d = deps();
    await runTurn(request(), d.deps);

    expect(d.store.appended.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(d.store.appended[1]).toMatchObject({
      organizationId: ORG,
      threadId: 'thread_1',
      model: 'claude-fable-5',
      providerSlug: 'anthropic',
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
    expect(d.store.appended.at(-1)).toMatchObject({
      role: 'assistant',
      blockedReason: expect.stringContaining('moderation_provider'),
    });
    expect(d.store.generations).toEqual(['begin', 'end']);
  });
});
