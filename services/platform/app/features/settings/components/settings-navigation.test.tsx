import React from 'react';
import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, waitFor } from '@/test/utils/render';

import { SettingsNavigation } from './settings-navigation';

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
  useLocation: () => ({ pathname: '/dashboard/org-1/settings/organization' }),
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

describe('SettingsNavigation', () => {
  describe('accessibility', () => {
    it('passes axe audit with all tabs', async () => {
      const { container } = render(
        <SettingsNavigation organizationId="org-1" />,
      );
      await waitFor(() => checkAccessibility(container));
    });

    it('passes axe audit without account tab', async () => {
      const { container } = render(
        <SettingsNavigation organizationId="org-1" showAccountTab={false} />,
      );
      await waitFor(() => checkAccessibility(container));
    });
  });
});
