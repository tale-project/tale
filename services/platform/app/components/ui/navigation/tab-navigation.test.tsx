import React from 'react';
import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, waitFor } from '@/test/utils/render';

import { TabNavigation } from './tab-navigation';

vi.mock('@tanstack/react-router', () => ({
  Link: React.forwardRef(
    (
      props: { to: string; children: React.ReactNode; className?: string },
      ref: React.Ref<HTMLAnchorElement>,
    ) => (
      <a ref={ref} href={props.to} className={props.className}>
        {props.children}
      </a>
    ),
  ),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/dashboard/test-org/settings' }),
  useSearch: () => ({}),
}));

vi.mock('@/app/components/branding/branding-provider', () => ({
  useBrandingContext: () => ({ accentColor: null }),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: () => true,
    cannot: () => false,
  }),
}));

vi.mock('@/app/hooks/use-resize-observer', () => ({
  useResizeObserver: vi.fn(),
}));

describe('TabNavigation', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <TabNavigation
          ariaLabel="Settings navigation"
          items={[
            { label: 'General', href: '/dashboard/test-org/settings' },
            {
              label: 'Branding',
              href: '/dashboard/test-org/settings/branding',
            },
          ]}
        />,
      );
      await waitFor(() => checkAccessibility(container));
    });
  });
});
