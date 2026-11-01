import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { ConversationsNavigation } from './conversations-navigation';

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
  createLink:
    () =>
    ({
      children,
      ...props
    }: {
      children: React.ReactNode;
      to?: string;
      href?: string;
    }) => <a href={props.to ?? props.href}>{children}</a>,
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { pathname: string } }) => unknown;
  }) =>
    select({ location: { pathname: '/dashboard/org-1/conversations/open' } }),
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

vi.mock('../hooks/queries', () => ({
  useApproxConversationCountByStatus: () => ({ data: 3 }),
}));

describe('ConversationsNavigation', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <ConversationsNavigation organizationId="org-1" />,
      );
      expect(
        screen.getByRole('navigation', { name: 'Inbox' }),
      ).toBeInTheDocument();
      await checkAccessibility(container);
    });
  });
});
