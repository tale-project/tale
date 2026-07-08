import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { ConversationsEmptyState } from './conversations-empty-state';

describe('ConversationsEmptyState', () => {
  it('shows the neutral zero-state without a connect CTA', () => {
    render(<ConversationsEmptyState />);
    expect(
      screen.getByRole('heading', { name: 'No conversations yet', level: 2 }),
    ).toBeInTheDocument();
    // The Inbox is only reachable once an inbox automation is installed —
    // there is no onboarding link to settings here.
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<ConversationsEmptyState />);
      await checkAccessibility(container);
    });
  });
});
