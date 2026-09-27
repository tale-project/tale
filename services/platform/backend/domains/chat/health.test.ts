// @vitest-environment node

/**
 * The chat-health model breakdown lists one row per model. A turn that
 * settled without a provider (cancelled, errored, or written by an older
 * lane) used to appear as a second row for the same model under an empty
 * provider; the fold merges it into the model's provider bucket when that
 * bucket is unambiguous.
 */

import { describe, expect, it } from 'vitest';

import { foldModelCounts } from './health.ts';

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
