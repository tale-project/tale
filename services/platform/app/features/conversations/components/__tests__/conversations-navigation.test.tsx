import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { ConversationsNavigation } from '../conversations-navigation';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    to?: string;
    href?: string;
  }) => <a href={props.to ?? props.href}>{children}</a>,
  useLocation: () => ({ pathname: '/dashboard/org-1/conversations/open' }),
}));

vi.mock('@/app/components/branding/branding-provider', () => ({
  useBrandingContext: () => ({ accentColor: '#000000' }),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: () => true,
    cannot: () => false,
  }),
}));

describe('ConversationsNavigation', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <ConversationsNavigation organizationId="org-1" />,
      );
      await checkAccessibility(container);
    });
  });
});
