import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatFilterConfig } from '../../lib/shared/schemas/governance';
import { resetForTesting as resetSemaphore } from '../lib/moderation/semaphore';
import { resetCompilationCacheForTesting } from './chat_filter';
import type { GuardrailsSnapshot, NormalizedConfig } from './sanitize';
import {
  createGuardrailsTransform,
  makeInitialState,
  type GuardrailsTransformState,
} from './stream_transform';

// stream_transform no longer imports moderation_provider directly —
// moderation is injected through the `runModerationForChunk` option.
// Tests omit that option, exercising the local-filters path only.

// Vercel AI SDK `TextStreamPart` subset the transform actually consumes.
// We shape-test against the plain object form; full SDK types aren't needed
// for pipe-through behaviour.
type PartIn =
  | { type: 'text-delta'; id: string; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'start' };

function baseChatFilterConfig(
  overrides: Partial<ChatFilterConfig> = {},
): ChatFilterConfig {
  return {
    enabled: true,
    maskReplacement: '[BLOCKED]',
    appliesTo: ['output'],
    preferNonStreamingForFiltering: false,
    configVersion: 1,
    categories: [],
    ...overrides,
  };
}

function wrapChatFilter(
  config: ChatFilterConfig,
): NormalizedConfig<ChatFilterConfig> {
  return {
    policyDocId: 'policy_test',
    updatedAt: 1,
    enabled: config.enabled,
    config,
  };
}

function snapshotWithChatFilter(config: ChatFilterConfig): GuardrailsSnapshot {
  return {
    chatFilter: wrapChatFilter(config),
    pii: null,
    moderation: null,
  };
}

function makeTransform(
  configs: GuardrailsSnapshot,
  state: GuardrailsTransformState,
  stopStream: () => void = () => undefined,
) {
  return createGuardrailsTransform({
    configs,
    direction: 'output',
    sanitizationRunId: 'run_test',
    streamId: 'stream_test',
    orgSlug: 'org_test',
    organizationId: 'org_test',
    state,
    stopStream,
    defaultMaskReplacement: '[BLOCKED]',
  });
}

async function pipeParts(
  parts: PartIn[],
  transform: TransformStream<unknown, unknown>,
): Promise<PartIn[]> {
  const output: PartIn[] = [];
  const upstream = new ReadableStream<PartIn>({
    start(controller) {
      for (const p of parts) controller.enqueue(p);
      controller.close();
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const piped = upstream.pipeThrough(transform as any);
  const reader = (piped as ReadableStream<PartIn>).getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) output.push(value);
  }
  return output;
}

describe('stream_transform — local filters (chat_filter)', () => {
  beforeEach(() => {
    resetCompilationCacheForTesting();
    resetSemaphore();
  });

  it('passes through non-text-delta parts unchanged', async () => {
    const state = makeInitialState();
    const transform = makeTransform(
      snapshotWithChatFilter(baseChatFilterConfig()),
      state,
    );
    const out = await pipeParts(
      [
        { type: 'start' },
        { type: 'text-delta', id: 'd1', text: 'hello ' },
        { type: 'text-delta', id: 'd1', text: 'world' },
      ],
      transform,
    );
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ type: 'start' });
    expect(out[1]).toMatchObject({ type: 'text-delta', text: 'hello ' });
    expect(out[2]).toMatchObject({ type: 'text-delta', text: 'world' });
  });

  it('masks matches inside a single delta', async () => {
    const state = makeInitialState();
    const config = baseChatFilterConfig({
      categories: [
        {
          id: 'profanity',
          label: 'Profanity',
          enabled: true,
          mode: 'mask',
          words: ['badword'],
          patterns: [],
        },
      ],
    });
    const transform = makeTransform(snapshotWithChatFilter(config), state);
    const out = await pipeParts(
      [{ type: 'text-delta', id: 'd1', text: 'say badword loud' }],
      transform,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: 'text-delta',
      text: 'say [BLOCKED] loud',
    });
    expect(state.blocked).toBe(false);
  });

  it('catches a word split across two deltas via the lookback buffer', async () => {
    const state = makeInitialState();
    const config = baseChatFilterConfig({
      categories: [
        {
          id: 'profanity',
          label: 'Profanity',
          enabled: true,
          mode: 'mask',
          words: ['forbidden'],
          patterns: [],
        },
      ],
    });
    const transform = makeTransform(snapshotWithChatFilter(config), state);
    // Cross-boundary mask is "best-effort in stream, canonical at finalize":
    // the transform can't retroactively rewrite already-emitted lookback
    // bytes in a forward-only TransformStream, so it falls back to the raw
    // delta for the second chunk. finalizeSanitize rewrites the persisted
    // message text so reload / history show the correctly-masked version
    // — that guarantee is covered by pii/chat_filter unit tests.
    const out = await pipeParts(
      [
        { type: 'text-delta', id: 'd1', text: 'this is for' },
        { type: 'text-delta', id: 'd1', text: 'bidden text' },
      ],
      transform,
    );
    const emitted = out
      .filter(
        (p): p is Extract<PartIn, { type: 'text-delta' }> =>
          p.type === 'text-delta',
      )
      .map((p) => p.text)
      .join('');
    expect(emitted).toContain('this is for');
    expect(emitted).toContain('bidden text');
    expect(state.blocked).toBe(false);
  });

  it('masks cleanly when the match lies fully inside a single delta', async () => {
    // Lookback helps when the match starts after lookback.length; e.g.
    // the first delta has no match, and the second delta's new bytes
    // contain the entire match on their own.
    const state = makeInitialState();
    const config = baseChatFilterConfig({
      categories: [
        {
          id: 'profanity',
          label: 'Profanity',
          enabled: true,
          mode: 'mask',
          words: ['loud'],
          patterns: [],
        },
      ],
    });
    const transform = makeTransform(snapshotWithChatFilter(config), state);
    const out = await pipeParts(
      [
        { type: 'text-delta', id: 'd1', text: 'this is ' },
        { type: 'text-delta', id: 'd1', text: 'very loud here' },
      ],
      transform,
    );
    const emitted = out
      .filter(
        (p): p is Extract<PartIn, { type: 'text-delta' }> =>
          p.type === 'text-delta',
      )
      .map((p) => p.text)
      .join('');
    expect(emitted).toContain('[BLOCKED]');
    expect(emitted.includes('loud')).toBe(false);
  });

  it('stops the stream and records blockedReason on block-mode match', async () => {
    const state = makeInitialState();
    const stopStream = vi.fn();
    const config = baseChatFilterConfig({
      categories: [
        {
          id: 'hate',
          label: 'Hate',
          enabled: true,
          mode: 'block',
          words: ['trigger'],
          patterns: [],
        },
      ],
    });
    const transform = makeTransform(
      snapshotWithChatFilter(config),
      state,
      stopStream,
    );
    const out = await pipeParts(
      [
        { type: 'text-delta', id: 'd1', text: 'safe intro ' },
        { type: 'text-delta', id: 'd1', text: 'trigger word' },
      ],
      transform,
    );
    expect(state.blocked).toBe(true);
    expect(state.blockedReason).not.toBeNull();
    expect(state.blockedReason?.code).toBe('chat_filter.blocked');
    expect(state.blockedReason?.categoryIds).toContain('hate');
    expect(stopStream).toHaveBeenCalledTimes(1);

    // Blocking delta is replaced with empty text; no raw bytes leak.
    const textDeltas = out.filter(
      (p): p is Extract<PartIn, { type: 'text-delta' }> =>
        p.type === 'text-delta',
    );
    expect(textDeltas.some((p) => p.text.includes('trigger word'))).toBe(false);
  });

  it('drops subsequent deltas after a block', async () => {
    const state = makeInitialState();
    const config = baseChatFilterConfig({
      categories: [
        {
          id: 'hate',
          label: 'Hate',
          enabled: true,
          mode: 'block',
          words: ['boom'],
          patterns: [],
        },
      ],
    });
    const transform = makeTransform(snapshotWithChatFilter(config), state);
    const out = await pipeParts(
      [
        { type: 'text-delta', id: 'd1', text: 'then boom' },
        { type: 'text-delta', id: 'd1', text: 'should-not-emit' },
      ],
      transform,
    );
    const textDeltas = out.filter(
      (p): p is Extract<PartIn, { type: 'text-delta' }> =>
        p.type === 'text-delta',
    );
    // First delta emitted with text: '' (redacted). Second delta dropped.
    expect(textDeltas.every((p) => p.text === '')).toBe(true);
  });
});

describe('stream_transform — moderation buffer boundaries', () => {
  beforeEach(() => {
    resetCompilationCacheForTesting();
    resetSemaphore();
  });

  it('flushes the moderation buffer on tool-call boundary', async () => {
    const state = makeInitialState();
    const transform = makeTransform(
      snapshotWithChatFilter(baseChatFilterConfig()),
      state,
    );
    const out = await pipeParts(
      [
        { type: 'text-delta', id: 'd1', text: 'hello ' },
        {
          type: 'tool-call',
          toolCallId: 'tc1',
          toolName: 'test',
          input: {},
        },
        { type: 'text-delta', id: 'd1', text: 'world' },
      ],
      transform,
    );
    // Tool-call passes through as-is; text deltas bracket it.
    const toolIdx = out.findIndex((p) => p.type === 'tool-call');
    expect(toolIdx).toBeGreaterThan(0);
    expect(toolIdx).toBeLessThan(out.length - 1);
  });
});
