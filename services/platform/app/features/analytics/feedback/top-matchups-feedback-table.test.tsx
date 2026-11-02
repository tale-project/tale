import { describe, expect, it } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { TopMatchupsFeedbackTable } from './top-matchups-feedback-table';
import type { FeedbackMatchupBucket } from './types';

/** A matchup of two sides, each a model and the provider that served it. */
function matchup(
  [modelLeft, providerLeft]: [string, string | null],
  [modelRight, providerRight]: [string, string | null],
): FeedbackMatchupBucket {
  return {
    modelLeft,
    providerLeft,
    modelRight,
    providerRight,
    leftWins: 1,
    rightWins: 0,
    ties: 0,
    bothBad: 0,
    total: 1,
  };
}

describe('TopMatchupsFeedbackTable', () => {
  it('names a model the table holds through two providers with each provider [FDBK-R8]', () => {
    render(
      <TopMatchupsFeedbackTable
        rows={[
          matchup(['luna', 'gateway'], ['luna', 'openrouter']),
          matchup(['alpha', 'openai'], ['zeta', 'anthropic']),
        ]}
        isLoading={false}
      />,
    );
    expect(screen.getByText('gateway · luna')).toBeVisible();
    expect(screen.getByText('openrouter · luna')).toBeVisible();
    // A model only one provider serves in the table is named by its id.
    expect(screen.getByText('alpha')).toBeVisible();
    expect(screen.getByText('zeta')).toBeVisible();
    expect(screen.queryByText('openai · alpha')).not.toBeInTheDocument();
  });

  it('names a side recorded without a provider by its id, apart from one with a provider', () => {
    render(
      <TopMatchupsFeedbackTable
        rows={[
          matchup(['luna', null], ['opus', null]),
          matchup(['luna', 'openrouter'], ['opus', 'anthropic']),
        ]}
        isLoading={false}
      />,
    );
    expect(screen.getByText('luna')).toBeVisible();
    expect(screen.getByText('opus')).toBeVisible();
    expect(screen.getByText('openrouter · luna')).toBeVisible();
    expect(screen.getByText('anthropic · opus')).toBeVisible();
  });
});
