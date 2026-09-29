/**
 * `generate_image` rides the same workspace-tool dispatch as every other
 * platform tool: routed with the token's own turn, audited by parameter
 * KEYS (never the prompt), and listed by `workspace_status` as a tool that
 * writes — it spends the organization's money and saves files, so it is
 * never badged read-only.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { functionRefName } from '../../../../lib/shared/handlers/function-refs';
import type { ActionCtx } from '../../lib/ctx';

const runGenerateImageMock = vi.fn();
vi.mock('./workspace_image_tool', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./workspace_image_tool')>()),
  runGenerateImage: (...args: unknown[]) =>
    runGenerateImageMock(...(args as [])),
}));

import {
  dispatchWorkspaceToolImpl,
  workspaceToolStatusImpl,
} from './workspace_tools_bridge';

const runQuery = vi.fn(async () => null);
const runMutation = vi.fn(async (_ref: unknown, _args: unknown) => null);
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the dispatch reaches only runQuery/runMutation here
const ctx = { runQuery, runMutation } as unknown as ActionCtx;

beforeEach(() => {
  runGenerateImageMock.mockReset().mockResolvedValue({
    status: 'ok',
    output: { files: [{ path: '/agent/output/task_1/cover.png' }] },
  });
  runQuery.mockClear();
  runMutation.mockClear();
});

describe('dispatchWorkspaceToolImpl — generate_image', () => {
  it('routes to the image tool with the token’s turn and audits keys only', async () => {
    const turn = { kind: 'task-agent', execId: 'exec_1' } as const;
    const result = await dispatchWorkspaceToolImpl(ctx, {
      organizationId: 'org_1',
      sessionId: 'sid_1',
      turn,
      tool: 'generate_image',
      callArgs: { prompt: 'A confidential launch poster', count: 2 },
    });
    expect(result).toMatchObject({ status: 'ok' });
    expect(runGenerateImageMock).toHaveBeenCalledWith(ctx, {
      organizationId: 'org_1',
      sessionId: 'sid_1',
      turn,
      callArgs: { prompt: 'A confidential launch poster', count: 2 },
    });
    const audit = runMutation.mock.calls.find(
      ([ref]) =>
        functionRefName(ref) === 'sandbox/session_mutations:recordToolCall',
    );
    expect(audit?.[1]).toMatchObject({
      tool: 'generate_image',
      outcome: 'ok',
      paramsFingerprint: 'count,prompt',
    });
    expect(JSON.stringify(audit)).not.toContain('confidential');
  });
});

describe('workspaceToolStatusImpl — generate_image', () => {
  it('describes the tool and never badges it read-only', () => {
    const status = workspaceToolStatusImpl([
      'rag_search',
      'generate_image',
    ]) as {
      tools: Array<{ name: string; description: string; readOnly: boolean }>;
    };
    const tool = status.tools.find((entry) => entry.name === 'generate_image');
    expect(tool?.readOnly).toBe(false);
    expect(tool?.description).toContain('Create images');
    expect(tool?.description).toContain('inputImages');
    expect(
      status.tools.find((entry) => entry.name === 'rag_search')?.readOnly,
    ).toBe(true);
  });
});
