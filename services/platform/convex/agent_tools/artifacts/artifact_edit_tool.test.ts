/**
 * Wiring test for the `artifact_edit` retry-loop short-circuit.
 *
 * Verifies the bug-fix shape: when `beginEditStream` rejects (e.g. the
 * target artifact is still in `liveStreamMode='create'` because a prior
 * `artifact_create` execute errored without settling), subsequent
 * `onInputDelta` parse passes within the SAME tool call MUST NOT keep
 * retrying — without the short-circuit, every ~40 ms parse pass fires
 * the same mutation again and floods Convex logs.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../_generated/api', () => ({
  internal: {
    artifacts: {
      internal_mutations: {
        beginEditStream: 'mock-beginEditStream',
        rewriteArtifact: 'mock-rewriteArtifact',
        applyToolPatch: 'mock-applyToolPatch',
        deleteFileFromArtifact: 'mock-deleteFileFromArtifact',
        renameArtifactFile: 'mock-renameArtifactFile',
        setArtifactEntry: 'mock-setArtifactEntry',
        updateRewriteStreamingContent: 'mock-updateRewriteStreamingContent',
        abortStream: 'mock-abortStream',
      },
      internal_queries: {
        getById: 'mock-getById',
      },
    },
  },
}));

import { artifactEditTool } from './artifact_edit_tool';
import { clearState, initState } from './stream_state';

interface RunMutationCall {
  ref: string;
  args: Record<string, unknown>;
}

function createMockCtx(opts: { rejectBeginEditStream: boolean }) {
  const runMutationCalls: RunMutationCall[] = [];
  const ctx = {
    organizationId: 'org_a',
    threadId: 'thr_a',
    messageId: 'msg_1',
    runMutation: vi.fn(async (ref: string, args: Record<string, unknown>) => {
      runMutationCalls.push({ ref, args });
      if (ref === 'mock-beginEditStream' && opts.rejectBeginEditStream) {
        throw new Error('streaming_in_progress (mocked)');
      }
      return null;
    }),
    runQuery: vi.fn(async (ref: string, _args: Record<string, unknown>) => {
      if (ref === 'mock-getById') {
        return {
          _id: 'art_target',
          organizationId: 'org_a',
          threadId: 'thr_a',
          content: '',
          revision: 1,
        };
      }
      return null;
    }),
  };
  return { ctx, runMutationCalls };
}

async function invokeDelta(
  toolCallId: string,
  delta: string,
  ctx: ReturnType<typeof createMockCtx>['ctx'],
) {
  const fn = (
    artifactEditTool.tool as unknown as {
      onInputDelta: (this: { ctx: unknown }, options: unknown) => Promise<void>;
    }
  ).onInputDelta;
  await fn.call({ ctx }, {
    toolCallId,
    inputTextDelta: delta,
    messages: [],
  } as never);
}

const TOOL_CALL_ID = 'call_edit_1';

beforeEach(() => {
  initState(TOOL_CALL_ID, 'artifact_edit');
  return () => clearState(TOOL_CALL_ID);
});

describe('artifact_edit_tool onInputDelta — beginEditStream retry short-circuit', () => {
  it('calls beginEditStream EXACTLY ONCE even when invoked across many parse passes after a permanent failure', async () => {
    const { ctx, runMutationCalls } = createMockCtx({
      rejectBeginEditStream: true,
    });

    // Each invokeDelta feeds an increasingly-complete JSON payload —
    // mirrors the AI SDK behaviour of resending the accumulating buffer
    // every ~40 ms. After the first parse pass commits a rewrite plan,
    // beginEditStream fires; we configured it to reject. The expectation:
    // no more beginEditStream calls on any subsequent delta, no matter
    // how many we push through.
    const fullJson = JSON.stringify({
      artifactId: 'art_target',
      mode: 'rewrite',
      path: 'main.py',
      content: 'a'.repeat(300),
      expectedRevision: 1,
    });

    await invokeDelta(TOOL_CALL_ID, fullJson, ctx);
    // Three more deltas, each extending content by ~250 bytes — every
    // single one would otherwise reach the Phase 1 init branch and
    // re-invoke beginEditStream.
    for (let i = 0; i < 3; i += 1) {
      const grown = JSON.stringify({
        artifactId: 'art_target',
        mode: 'rewrite',
        path: 'main.py',
        content: 'a'.repeat(300 + (i + 1) * 250),
        expectedRevision: 1,
      });
      const prevLen = JSON.stringify({
        artifactId: 'art_target',
        mode: 'rewrite',
        path: 'main.py',
        content: 'a'.repeat(300 + i * 250),
        expectedRevision: 1,
      }).length;
      await invokeDelta(TOOL_CALL_ID, grown.slice(prevLen), ctx);
    }

    const beginEditStreamCalls = runMutationCalls.filter(
      (c) => c.ref === 'mock-beginEditStream',
    );
    expect(beginEditStreamCalls).toHaveLength(1);
    // And the Phase 2 flush must also NOT run for this dead session —
    // a flush write would target the same stranded row with no effect
    // but adds DB churn.
    const flushCalls = runMutationCalls.filter(
      (c) => c.ref === 'mock-updateRewriteStreamingContent',
    );
    expect(flushCalls).toHaveLength(0);
  });

  it('flushes content on the happy path (no rejection)', async () => {
    const { ctx, runMutationCalls } = createMockCtx({
      rejectBeginEditStream: false,
    });

    const fullJson = JSON.stringify({
      artifactId: 'art_target',
      mode: 'rewrite',
      path: 'main.py',
      content: 'a'.repeat(300),
      expectedRevision: 1,
    });
    await invokeDelta(TOOL_CALL_ID, fullJson, ctx);

    const refs = runMutationCalls.map((c) => c.ref);
    expect(refs).toContain('mock-beginEditStream');
    expect(refs).toContain('mock-updateRewriteStreamingContent');
  });
});
