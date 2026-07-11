import { describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../_generated/server';
import {
  postFailureNotice,
  type RunAgentOnDiscussionResult,
} from './run_agent_on_discussion';

const BASE_ARGS = {
  organizationId: 'org_1',
  agentSlug: 'assistant',
  threadId: 'thread_1',
};

function makeCtx(): { ctx: ActionCtx; runMutation: ReturnType<typeof vi.fn> } {
  const runMutation = vi.fn().mockResolvedValue({ posted: true });
  return { ctx: { runMutation } as unknown as ActionCtx, runMutation };
}

describe('postFailureNotice', () => {
  it('posts nothing when the run succeeded', async () => {
    const { ctx, runMutation } = makeCtx();
    const result: RunAgentOnDiscussionResult = { ok: true, text: 'hi' };

    await postFailureNotice(ctx, BASE_ARGS, result);

    expect(runMutation).not.toHaveBeenCalled();
  });

  it.each(['discussion_not_found', 'discussion_not_open', 'discussion_locked'])(
    'stays silent for the %s refusal (nowhere to post)',
    async (refusedReason) => {
      const { ctx, runMutation } = makeCtx();
      const result: RunAgentOnDiscussionResult = {
        ok: false,
        refusedReason,
        error: 'irrelevant',
      };

      await postFailureNotice(ctx, BASE_ARGS, result);

      expect(runMutation).not.toHaveBeenCalled();
    },
  );

  it('posts a visible System notice for a run-admission refusal', async () => {
    const { ctx, runMutation } = makeCtx();
    const result: RunAgentOnDiscussionResult = {
      ok: false,
      refusedReason: 'automation_disabled',
      error: 'Task automation is disabled for this organization.',
    };

    await postFailureNotice(ctx, BASE_ARGS, result);

    expect(runMutation).toHaveBeenCalledTimes(1);
    const [, notice] = runMutation.mock.calls[0] as [
      unknown,
      {
        organizationId: string;
        threadId: string;
        message: string;
      },
    ];
    expect(notice).toEqual({
      organizationId: 'org_1',
      threadId: 'thread_1',
      message:
        'The agent "assistant" was mentioned here but could not reply: Task automation is disabled for this organization.',
    });
  });

  it('posts a visible notice for a provider/generation failure (no refusedReason)', async () => {
    const { ctx, runMutation } = makeCtx();
    const result: RunAgentOnDiscussionResult = {
      ok: false,
      error: 'Provider request failed: 503 Service Unavailable',
      timedOut: false,
    };

    await postFailureNotice(ctx, BASE_ARGS, result);

    expect(runMutation).toHaveBeenCalledTimes(1);
    const [, notice] = runMutation.mock.calls[0] as [
      unknown,
      { message: string },
    ];
    expect(notice.message).toBe(
      'The agent "assistant" was mentioned here but could not reply: Provider request failed: 503 Service Unavailable',
    );
  });

  it('falls back to "unknown error" when neither error nor refusedReason is set', async () => {
    const { ctx, runMutation } = makeCtx();
    const result: RunAgentOnDiscussionResult = { ok: false };

    await postFailureNotice(ctx, BASE_ARGS, result);

    const [, notice] = runMutation.mock.calls[0] as [
      unknown,
      { message: string },
    ];
    expect(notice.message).toBe(
      'The agent "assistant" was mentioned here but could not reply: unknown error',
    );
  });

  it('collapses whitespace and caps the detail length', async () => {
    const { ctx, runMutation } = makeCtx();
    const messy = `line one\n\nline   two\t\t${'x'.repeat(400)}`;
    const result: RunAgentOnDiscussionResult = { ok: false, error: messy };

    await postFailureNotice(ctx, BASE_ARGS, result);

    const [, notice] = runMutation.mock.calls[0] as [
      unknown,
      { message: string },
    ];
    expect(notice.message).not.toMatch(/\n|\t/);
    // Prefix length + the 300-char capped detail.
    const prefix =
      'The agent "assistant" was mentioned here but could not reply: ';
    expect(notice.message.length).toBe(prefix.length + 300);
  });

  it('never throws when posting the notice itself fails (best-effort)', async () => {
    const runMutation = vi.fn().mockRejectedValue(new Error('db unavailable'));
    const ctx = { runMutation } as unknown as ActionCtx;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result: RunAgentOnDiscussionResult = { ok: false, error: 'boom' };

    await expect(
      postFailureNotice(ctx, BASE_ARGS, result),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      '[AgentDiscussionRun] failed to post failure notice',
      expect.objectContaining({
        org: 'org_1',
        thread: 'thread_1',
        agent: 'assistant',
      }),
    );

    warnSpy.mockRestore();
  });
});
