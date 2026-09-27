import { describe, expect, it } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { ArenaSummary } from './arena-summary';

const verdicts = { a_better: 2, b_better: 1, tie: 1, both_bad: 0 };

describe('ArenaSummary', () => {
  it('shows the three verdict cells over the rows the matchup table counts', () => {
    render(<ArenaSummary byVerdict={verdicts} selfMatches={0} total={4} />);
    expect(screen.getByText('Decisive').nextSibling).toHaveTextContent('3');
    expect(screen.getByText('Tie').nextSibling).toHaveTextContent('1');
    expect(screen.queryByText('Same model')).not.toBeInTheDocument();
  });

  it('counts self-matches apart instead of folding them into a verdict', () => {
    render(<ArenaSummary byVerdict={verdicts} selfMatches={2} total={6} />);
    expect(screen.getByText('Decisive').nextSibling).toHaveTextContent('3');
    expect(screen.getByText('Same model').nextSibling).toHaveTextContent('2');
  });
});
