// @vitest-environment node

/**
 * The chat-health model breakdown lists one row per model. A turn that
 * settled without a provider (cancelled, errored, or written by an older
 * lane) used to appear as a second row for the same model under an empty
 * provider; the fold merges it into the model's provider bucket when that
 * bucket is unambiguous.
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { foldModelCounts, getOrgChatHealth } from './health.ts';

/** Answers `getOrgChatHealth`'s three reads in order: one message of the
 * organization, the window's messages, and the threads' agents. */
function cannedSql(...answers: unknown[][]): Sql {
  const queue = [...answers];
  const sql = () => Promise.resolve(queue.shift() ?? []);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return sql as unknown as Sql;
}

describe('foldModelCounts', () => {
  it('merges a provider-less count into the one provider known for the model', () => {
    expect(
      foldModelCounts([
        { provider: 'deepseek', model: 'deepseek-v4-flash', count: 10 },
        { provider: '', model: 'deepseek-v4-flash', count: 3 },
        { provider: 'deepseek', model: 'deepseek-v4-pro', count: 2 },
        { provider: '', model: 'deepseek-v4-pro', count: 5 },
      ]),
    ).toEqual([
      { provider: 'deepseek', model: 'deepseek-v4-flash', count: 13 },
      { provider: 'deepseek', model: 'deepseek-v4-pro', count: 7 },
    ]);
  });

  it('keeps a provider-less row when the model is known under several providers, or none', () => {
    expect(
      foldModelCounts([
        { provider: 'openrouter', model: 'shared-model', count: 4 },
        { provider: 'direct', model: 'shared-model', count: 4 },
        { provider: '', model: 'shared-model', count: 1 },
        { provider: '', model: 'orphan-model', count: 2 },
      ]),
    ).toEqual([
      { provider: 'openrouter', model: 'shared-model', count: 4 },
      { provider: 'direct', model: 'shared-model', count: 4 },
      { provider: '', model: 'orphan-model', count: 2 },
      { provider: '', model: 'shared-model', count: 1 },
    ]);
  });

  it('does not mutate its input', () => {
    const input = [
      { provider: 'deepseek', model: 'm', count: 1 },
      { provider: '', model: 'm', count: 1 },
    ];
    foldModelCounts(input);
    expect(input[0]?.count).toBe(1);
  });
});

// #5270: two providers can serve one model id, so a recent error names the
// provider its turn stored, for the page to name the model by.
describe('getOrgChatHealth recent errors', () => {
  it('carry the provider their turn stored, and none where it stored none', async () => {
    const turn = (
      providerSlug: string | null,
      createdAt: number,
    ): Record<string, unknown> => ({
      threadId: 'thread-1',
      role: 'assistant',
      model: 'deepseek-x',
      providerSlug,
      usage: null,
      blockedReason: null,
      error: 'boom',
      createdAt,
    });
    const now = Date.now();
    const health = await getOrgChatHealth(
      cannedSql(
        [{ id: 'message-1' }],
        [turn('deepinfra', now - 1000), turn(null, now - 2000)],
        [{ id: 'thread-1', agentSlug: 'helper' }],
      ),
      'org-1',
      { periodDays: 7 },
    );

    expect(health.recentErrors).toEqual([
      expect.objectContaining({ model: 'deepseek-x', provider: 'deepinfra' }),
      expect.not.objectContaining({ provider: expect.anything() }),
    ]);
  });
});
