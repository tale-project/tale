import { describe, expect, it } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { RenderPart } from '../../types';
import { ReviewPanel } from './review-panel';

function reviewPart(data: unknown): RenderPart {
  return {
    render: 'review',
    partState: 'output_available',
    title: 'Review the plan',
    data,
  };
}

describe('ReviewPanel', () => {
  it('renders the outcome for an approved gate instead of an empty body', () => {
    // The resume re-execution persists the recorded decision; TaskReviewCard
    // would find no pending review then and render nothing.
    render(
      <ReviewPanel
        part={reviewPart({
          operation: 'request_review',
          taskId: 'task123',
          approvalId: 'appr123',
          pending: false,
          responded: true,
          decision: 'approve',
        })}
      />,
    );
    expect(screen.getByText('Approved')).toBeInTheDocument();
  });

  it('renders a changes-requested outcome with the feedback', () => {
    render(
      <ReviewPanel
        part={reviewPart({
          operation: 'request_review',
          taskId: 'task123',
          pending: false,
          responded: true,
          decision: 'request_changes',
          feedback: 'Clarify the rollout plan first.',
        })}
      />,
    );
    expect(screen.getByText('Changes requested')).toBeInTheDocument();
    expect(
      screen.getByText('Clarify the rollout plan first.'),
    ).toBeInTheDocument();
  });

  it('falls back to the pending question when no task is bound', () => {
    render(
      <ReviewPanel
        part={reviewPart({ question: 'Approve the plan to proceed?' })}
      />,
    );
    expect(screen.getByText('Awaiting approval')).toBeInTheDocument();
    expect(
      screen.getByText('Approve the plan to proceed?'),
    ).toBeInTheDocument();
  });
});
