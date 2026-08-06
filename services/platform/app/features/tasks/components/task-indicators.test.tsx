// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { NeedsReviewIndicator } from './task-indicators';

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string) => `${ns}.${key}`,
  }),
}));

describe('NeedsReviewIndicator', () => {
  it('renders nothing off the review gate', () => {
    render(<NeedsReviewIndicator needsReview={false} reviewerName="Alex" />);
    expect(screen.queryByText('Alex')).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText('tasks.review.needsReview'),
    ).not.toBeInTheDocument();
  });

  it('keeps the bare glyph when no reviewer resolved (pre-reviewer behavior)', () => {
    render(<NeedsReviewIndicator needsReview />);
    expect(
      screen.getByLabelText('tasks.review.needsReview'),
    ).toBeInTheDocument();
  });

  it('names the reviewer the task waits on', () => {
    render(<NeedsReviewIndicator needsReview reviewerName="Alex" />);
    const chip = screen.getByLabelText('tasks.review.waitingOn');
    expect(chip).toBeInTheDocument();
    expect(screen.getByText('Alex')).toBeInTheDocument();
  });

  it('says You when the viewer is the reviewer', () => {
    render(
      <NeedsReviewIndicator needsReview reviewerName="Alex" reviewerIsMe />,
    );
    expect(
      screen.getByLabelText('tasks.review.waitingOnYou'),
    ).toBeInTheDocument();
    expect(screen.getByText('tasks.assignee.you')).toBeInTheDocument();
    expect(screen.queryByText('Alex')).not.toBeInTheDocument();
  });
});
