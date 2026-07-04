/**
 * Regression: the spawn_agent result carries `sandboxState` when the worker
 * was granted workspace tools — the parent must see the files the worker
 * wrote in the SHARED thread workspace instead of recreating them from the
 * worker's text reply (which is how duplicate reports happened).
 */

import { getFunctionName } from 'convex/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@convex-dev/agent', () => ({
  createTool: vi.fn((def) => ({ _handler: def.execute })),
}));

import type { SkillSnapshot } from '../../lib/agent_chat/skills_runtime';
import {
  createSpawnAgentTool,
  type SpawnAgentDeps,
} from './create_spawn_agent_tool';

const ORG_ID = 'org-1';
const PARENT_THREAD_ID = 'parent-thread-1';

const emptySkillSnapshot: SkillSnapshot = {
  entries: [],
  bySlug: new Map(),
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal snapshot for the spawn boundary
} as unknown as SkillSnapshot;

function makeDeps(overrides?: Partial<SpawnAgentDeps>): SpawnAgentDeps {
  return {
    parentConfig: { convexToolNames: ['file_write', 'file_list', 'web'] },
    parentAgentSlug: 'assistant',
    parentModel: 'openrouter/test-model',
    organizationId: ORG_ID,
    orgLocale: 'en',
    skillSnapshot: emptySkillSnapshot,
    runGeneration: vi.fn().mockResolvedValue({ text: 'report saved' }),
    ...overrides,
  };
}

/** Fake ToolCtx dispatching on the generated function ref names. */
function makeCtx() {
  const runMutation = vi.fn((ref: unknown, args: Record<string, unknown>) => {
    const name = getFunctionName(ref as never);
    if (name === 'agent_jobs/internal_mutations:startJob') {
      return Promise.resolve({
        started: true,
        jobId: 'job-row-1',
        jobThreadId: 'job-thread-1',
      });
    }
    if (name === 'agent_jobs/internal_mutations:finalizeJob') {
      return Promise.resolve(null);
    }
    throw new Error(`unexpected runMutation: ${name} ${JSON.stringify(args)}`);
  });
  const runQuery = vi.fn((ref: unknown, _args: Record<string, unknown>) => {
    const name = getFunctionName(ref as never);
    if (name === 'thread_files/internal_queries:listThreadFiles') {
      return Promise.resolve([
        {
          organizationId: ORG_ID,
          path: '/user/code/report.md',
          storageId: 'sid-report',
          size: 42,
          contentType: 'text/markdown',
          source: 'agent_write',
          updatedAt: 1,
        },
      ]);
    }
    throw new Error(`unexpected runQuery: ${name}`);
  });
  return {
    organizationId: ORG_ID,
    threadId: PARENT_THREAD_ID,
    userId: 'user-1',
    runMutation,
    runQuery,
  };
}

type Handler = (
  ctx: Record<string, unknown>,
  args: Record<string, unknown>,
  options: { toolCallId?: string },
) => Promise<Record<string, unknown>>;

function handlerOf(deps: SpawnAgentDeps): Handler {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- accessing the mocked createTool handler for testing
  return (createSpawnAgentTool(deps).tool as unknown as { _handler: Handler })
    ._handler;
}

const baseArgs = {
  name: 'Report writer',
  description: 'Writes the report file',
  instructions: 'Write the report to the workspace.',
  input: 'Write a report about X.',
};

describe('spawn_agent sandboxState', () => {
  it('reports the shared workspace when the worker had workspace tools', async () => {
    const ctx = makeCtx();
    const result = await handlerOf(makeDeps())(
      ctx,
      { ...baseArgs, tools: ['file_write'] },
      { toolCallId: 'call-1' },
    );
    expect(result.success).toBe(true);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test reads the manifest shape
    const state = result.sandboxState as {
      code: Array<{ path: string }>;
    };
    expect(state.code.map((e) => e.path)).toEqual(['/user/code/report.md']);
    // The manifest is keyed on the PARENT thread (the workspace owner).
    const listCall = ctx.runQuery.mock.calls.find(
      ([ref]) =>
        getFunctionName(ref as never) ===
        'thread_files/internal_queries:listThreadFiles',
    );
    expect(listCall?.[1]).toEqual({ threadId: PARENT_THREAD_ID });
  });

  it('omits sandboxState when no workspace tool was granted', async () => {
    const ctx = makeCtx();
    const result = await handlerOf(makeDeps())(
      ctx,
      { ...baseArgs, tools: ['web'] },
      { toolCallId: 'call-2' },
    );
    expect(result.success).toBe(true);
    expect(result.sandboxState).toBeUndefined();
  });

  it('still reports the workspace when the job failed', async () => {
    const deps = makeDeps({
      runGeneration: vi.fn().mockRejectedValue(new Error('model exploded')),
    });
    const ctx = makeCtx();
    const result = await handlerOf(deps)(
      ctx,
      { ...baseArgs, tools: ['file_write'] },
      { toolCallId: 'call-3' },
    );
    expect(result.success).toBe(false);
    expect(result.sandboxState).toBeDefined();
  });
});
