/**
 * Wiring test for the `artifact_create` streaming flush.
 *
 * Verifies the bug-fix shape: as JSON tokens arrive in `onInputDelta`,
 * once the placeholder is created we throttle-flush parsed partial
 * `content` into the row's `streamingContent` via the
 * `updateCreateStreamingContent` mutation. Without this, the canvas
 * goes blank whenever the client-side tool-input-delta hook resets
 * (LLM retry / continuation / "I'll create in segments").
 *
 * Direct unit-test of the createTool-wrapped handler: we call
 * `tool.onInputDelta.call({ ctx }, options)` so the agent SDK's
 * `getCtx(this)` wrapper reaches our mock ctx.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../_generated/api', () => ({
  internal: {
    artifacts: {
      internal_mutations: {
        beginCreateStream: 'mock-beginCreateStream',
        finalizeCreateStream: 'mock-finalizeCreateStream',
        discardCreateStream: 'mock-discardCreateStream',
        updateCreateStreamingContent: 'mock-updateCreateStreamingContent',
        setArtifactRunConfig: 'mock-setArtifactRunConfig',
        createArtifact: 'mock-createArtifact',
      },
      internal_queries: {
        getById: 'mock-getById',
        findArtifactByCreatedMessage: 'mock-findArtifactByCreatedMessage',
      },
    },
  },
}));

import { artifactCreateTool } from './artifact_create_tool';
import { clearState, initState } from './stream_state';

interface RunMutationCall {
  ref: string;
  args: Record<string, unknown>;
}

function createMockCtx() {
  const runMutationCalls: RunMutationCall[] = [];
  const runQueryCalls: { ref: string; args: Record<string, unknown> }[] = [];
  const ctx = {
    organizationId: 'org_a',
    threadId: 'thr_a',
    messageId: 'msg_1',
    runMutation: vi.fn(async (ref: string, args: Record<string, unknown>) => {
      runMutationCalls.push({ ref, args });
      if (ref === 'mock-beginCreateStream') {
        // Pretend a fresh placeholder was created.
        return { kind: 'created', artifactId: 'art_new', entryFile: 'main.js' };
      }
      return null;
    }),
    runQuery: vi.fn(async (ref: string, args: Record<string, unknown>) => {
      runQueryCalls.push({ ref, args });
      return null;
    }),
  };
  return { ctx, runMutationCalls, runQueryCalls };
}

/** Invoke the tool's wrapped `onInputDelta` with a mock ctx attached
 *  the same way the agent SDK does (`this.ctx`). */
async function invokeDelta(
  toolCallId: string,
  delta: string,
  ctx: ReturnType<typeof createMockCtx>['ctx'],
) {
  const fn = (
    artifactCreateTool.tool as unknown as {
      onInputDelta: (this: { ctx: unknown }, options: unknown) => Promise<void>;
    }
  ).onInputDelta;
  await fn.call({ ctx }, {
    toolCallId,
    inputTextDelta: delta,
    messages: [],
  } as never);
}

const TOOL_CALL_ID = 'call_test_1';

beforeEach(() => {
  initState(TOOL_CALL_ID, 'artifact_create');
});

afterEach(() => {
  clearState(TOOL_CALL_ID);
  vi.useRealTimers();
});

describe('artifact_create_tool onInputDelta — incremental streamingContent flush', () => {
  it('calls beginCreateStream then updateCreateStreamingContent once content grows past the throttle threshold', async () => {
    const { ctx, runMutationCalls } = createMockCtx();

    // Single delta that already includes all metadata + a large enough
    // initial `content` (> STREAM_FLUSH_DELTA_BYTES = 200) so both Phase 1
    // (init) AND Phase 2 (flush) fire on the same parse pass.
    const big = 'a'.repeat(300);
    const fullJson = JSON.stringify({
      type: 'code',
      title: 'hello world',
      content: big,
    });
    await invokeDelta(TOOL_CALL_ID, fullJson, ctx);

    const refs = runMutationCalls.map((c) => c.ref);
    expect(refs).toEqual([
      'mock-beginCreateStream',
      'mock-updateCreateStreamingContent',
    ]);
    expect(runMutationCalls[1].args).toMatchObject({
      artifactId: 'art_new',
      toolCallId: TOOL_CALL_ID,
      content: big,
    });
  });

  it('does NOT flush a second time when content has only grown a little since last flush (throttle)', async () => {
    const { ctx, runMutationCalls } = createMockCtx();

    // First delta: triggers init + first flush.
    const first = JSON.stringify({
      type: 'code',
      title: 'hello world',
      content: 'a'.repeat(300),
    });
    await invokeDelta(TOOL_CALL_ID, first, ctx);

    // Second delta extends the content by only ~10 bytes — below
    // STREAM_FLUSH_DELTA_BYTES (200) and arriving immediately, so the
    // throttle should block another flush mutation.
    const second = ',"foo":"bar"}'; // ~13 bytes — appended after the closing brace
    // To keep partial JSON valid we instead rewrite the whole thing with
    // 10 more content bytes, simulating the AI SDK behavior of re-emitting
    // the full accumulator as it grows.
    const grown = JSON.stringify({
      type: 'code',
      title: 'hello world',
      content: 'a'.repeat(310),
    });
    // Note: the tool accumulates deltas, so we send only the appended
    // suffix. parsePartialJson handles the previously-accumulated buffer.
    const suffix = grown.slice(first.length);
    await invokeDelta(TOOL_CALL_ID, suffix, ctx);

    const flushCalls = runMutationCalls.filter(
      (c) => c.ref === 'mock-updateCreateStreamingContent',
    );
    expect(flushCalls).toHaveLength(1);

    // Suppress the unused-var lint for the example I drafted before settling
    // on the cleaner "extend the same field" shape above.
    void second;
  });

  it('does NOT call updateCreateStreamingContent before the placeholder exists', async () => {
    const { ctx, runMutationCalls } = createMockCtx();

    // Stream the type + a partial title; not enough to commit yet.
    await invokeDelta(TOOL_CALL_ID, '{"type":"code","title":"in-progress', ctx);

    expect(runMutationCalls).toHaveLength(0);
  });
});
