import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const isMobileState = { value: false };
vi.mock('@/app/hooks/use-is-mobile', () => ({
  useIsMobile: () => isMobileState.value,
}));

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

describe('TabNavigation', () => {
  beforeEach(() => {
    isMobileState.value = false;
  });
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
        label: 'Connectors',
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
      expect(dotIn('Connectors')).toBeNull();
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
      expect(srTextIn('Connectors')).toBeNull();
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

  describe('overflow="menu"', () => {
    // jsdom has no layout, so the clamp's inputs are stubbed: the scroller is
    // 300px of content box, every tab's measurement twin is 120px, the More
    // trigger twin 60px, and the row gap 16px. Fit math: More(60) + gap +
    // Tab One(120) = 196 ≤ 300, + gap + Tab Two(120) = 332 > 300 → one
    // visible tab, three folded into the menu.
    const items = [
      { label: 'Tab One', href: '/dashboard/test-org/projects/p1/views/a/v1' },
      { label: 'Tab Two', href: '/dashboard/test-org/projects/p1/views/a/v2' },
      {
        label: 'Tab Three',
        href: '/dashboard/test-org/projects/p1/views/a/v3',
      },
      { label: 'Tab Four', href: '/dashboard/test-org/projects/p1/views/a/v4' },
    ];

    let restoreDescriptors: (() => void) | undefined;

    beforeEach(() => {
      const proto = HTMLElement.prototype;
      const originalOffset = Object.getOwnPropertyDescriptor(
        proto,
        'offsetWidth',
      );
      const originalClient = Object.getOwnPropertyDescriptor(
        proto,
        'clientWidth',
      );
      Object.defineProperty(proto, 'offsetWidth', {
        configurable: true,
        get(this: HTMLElement) {
          // Only the hidden measurement row's twins get real widths.
          if (
            this.tagName === 'SPAN' &&
            this.parentElement?.getAttribute('aria-hidden') === 'true'
          ) {
            return this.textContent?.includes('moreTabs') ? 60 : 120;
          }
          return 0;
        },
      });
      Object.defineProperty(proto, 'clientWidth', {
        configurable: true,
        get(this: HTMLElement) {
          return this.classList.contains('overflow-x-auto') ? 300 : 0;
        },
      });
      // Override just the clamp's inputs; delegate everything else (incl.
      // `getPropertyValue`, which testing-library's role queries call) to the
      // real jsdom style object.
      const realGetComputedStyle = window.getComputedStyle.bind(window);
      const overrides: Record<string, string> = {
        paddingLeft: '0px',
        paddingRight: '0px',
        columnGap: '16px',
      };
      const computedSpy = vi
        .spyOn(window, 'getComputedStyle')
        .mockImplementation((element, pseudo) => {
          const style = realGetComputedStyle(element, pseudo);
          return new Proxy(style, {
            get(target, prop) {
              if (typeof prop === 'string' && prop in overrides) {
                return overrides[prop];
              }
              const value = Reflect.get(target, prop);
              return typeof value === 'function' ? value.bind(target) : value;
            },
          });
        });
      restoreDescriptors = () => {
        if (originalOffset)
          Object.defineProperty(proto, 'offsetWidth', originalOffset);
        if (originalClient)
          Object.defineProperty(proto, 'clientWidth', originalClient);
        computedSpy.mockRestore();
      };
    });

    afterEach(() => {
      restoreDescriptors?.();
    });

    it('clamps the row to the tabs that fit and folds the tail into a More menu', async () => {
      render(
        <TabNavigation
          ariaLabel="Project navigation"
          items={items}
          overflow="menu"
        />,
      );
      expect(screen.getByRole('link', { name: 'Tab One' })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Tab Two' })).toBeNull();
      const trigger = screen.getByRole('button', {
        name: 'aria.moreTabs',
      });
      const user = userEvent.setup();
      await user.click(trigger);
      // The folded tabs are reachable as menu rows.
      expect(
        await screen.findByRole('menuitem', { name: /Tab Two/ }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('menuitem', { name: /Tab Four/ }),
      ).toBeInTheDocument();
    });

    it('contains the absolute measure row so it cannot widen PageLayout', () => {
      // Regression: the invisible width-twin row is position:absolute and
      // wider than the viewport. Without overflow-x-hidden on the <nav>, it
      // inflates an ancestor `overflow-auto` scrollport and a horizontal
      // swipe shifts the whole project shell — even when page content fits.
      render(
        <TabNavigation
          ariaLabel="Project navigation"
          items={items}
          overflow="menu"
        />,
      );
      expect(screen.getByRole('navigation')).toHaveClass('overflow-x-hidden');
    });

    it('renders every tab inline (no More trigger) when the row fits', () => {
      // Two tabs: 120 + 16 + 120 = 256 ≤ 300 — nothing to fold.
      render(
        <TabNavigation
          ariaLabel="Project navigation"
          items={items.slice(0, 2)}
          overflow="menu"
        />,
      );
      expect(screen.getByRole('link', { name: 'Tab Two' })).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'aria.moreTabs' }),
      ).toBeNull();
    });
  });

  describe('trailing children placement', () => {
    const items = [
      { label: 'General', href: '/dashboard/test-org/settings' },
      { label: 'Branding', href: '/dashboard/test-org/settings/branding' },
    ];

    it('keeps children in the desktop trailing slot', () => {
      isMobileState.value = false;
      const { container } = render(
        <TabNavigation ariaLabel="Settings navigation" items={items}>
          <button type="button">Save</button>
        </TabNavigation>,
      );
      const nav = screen.getByRole('navigation', {
        name: 'Settings navigation',
      });
      expect(nav).toContainElement(
        screen.getByRole('button', { name: 'Save' }),
      );
      expect(container.querySelector('.fixed.w-fit')).toBeNull();
    });

    it('moves children into the floating dock on mobile', async () => {
      isMobileState.value = true;
      render(
        <TabNavigation ariaLabel="Settings navigation" items={items}>
          <button type="button">Save</button>
        </TabNavigation>,
      );
      const nav = screen.getByRole('navigation', {
        name: 'Settings navigation',
      });
      const save = await screen.findByRole('button', { name: 'Save' });
      expect(nav).not.toContainElement(save);
      expect(save.closest('.fixed')).toHaveClass('right-4', 'w-fit');
      expect(document.body.contains(save)).toBe(true);
    });
  });
});
