import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

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

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
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

  describe('per-tab dirty dot (#2573)', () => {
    // A search-param strip (the automation detail's `?tab=`): every item
    // shares one pathname, only Configuration declares dirty keys.
    const items = [
      {
        label: 'Integrations',
        href: '/dashboard/test-org/automations/crm',
        search: {},
      },
      {
        label: 'Configuration',
        href: '/dashboard/test-org/automations/crm',
        search: { tab: 'configuration' },
        dirtyKeys: ['name', 'description'],
      },
    ];

    // Matched by a regex, not an exact string: the dirty tab's accessible
    // name now also carries the sr-only "unsaved changes" text (#2573
    // a11y follow-on), so an exact-string match on the bare label would
    // stop finding it once dirty.
    const linkFor = (tabName: string) =>
      screen.getByRole('link', { name: new RegExp(tabName) });
    const dotIn = (tabName: string) =>
      linkFor(tabName).querySelector('.bg-amber-500');
    const srTextIn = (tabName: string) =>
      linkFor(tabName).querySelector('.sr-only');

    it('marks exactly the tab whose dirtyKeys intersect the dirty set', () => {
      render(
        <TabNavigation
          ariaLabel="Automation navigation"
          items={items}
          dirtyKeys={new Set(['name'])}
        />,
      );
      expect(dotIn('Configuration')).not.toBeNull();
      expect(dotIn('Integrations')).toBeNull();
    });

    it('gives the dirty dot a screen-reader text alternative (#2573 a11y follow-on)', () => {
      render(
        <TabNavigation
          ariaLabel="Automation navigation"
          items={items}
          dirtyKeys={new Set(['name'])}
        />,
      );
      // The visible dot is aria-hidden; this sr-only twin is its text
      // alternative, so a screen-reader user still learns the tab is dirty.
      expect(srTextIn('Configuration')).toHaveTextContent(
        'aria.unsavedChanges',
      );
      expect(srTextIn('Integrations')).toBeNull();
    });

    it('clears the dot when the dirty set empties (save/discard)', () => {
      const { rerender } = render(
        <TabNavigation
          ariaLabel="Automation navigation"
          items={items}
          dirtyKeys={new Set(['description'])}
        />,
      );
      expect(dotIn('Configuration')).not.toBeNull();
      rerender(
        <TabNavigation
          ariaLabel="Automation navigation"
          items={items}
          dirtyKeys={new Set()}
        />,
      );
      expect(dotIn('Configuration')).toBeNull();
    });

    it('renders no dot when the strip has no dirty-key source at all', () => {
      // No parent editor registered (`dirtyKeys` undefined) — a tab with
      // declared keys must stay unmarked rather than treat undefined as dirty.
      render(<TabNavigation ariaLabel="Automation navigation" items={items} />);
      expect(dotIn('Configuration')).toBeNull();
    });
  });
});
