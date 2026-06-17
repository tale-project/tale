import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { ActivateConversationsEmptyState } from './activate-conversations-empty-state';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    to?: string;
    href?: string;
  }) => <a href={props.to ?? props.href}>{children}</a>,
}));

describe('ActivateConversationsEmptyState', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <ActivateConversationsEmptyState organizationId="org-1" />,
      );
      await checkAccessibility(container);
    });
  });
});
