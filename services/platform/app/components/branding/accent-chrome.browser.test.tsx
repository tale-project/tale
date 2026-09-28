import '@testing-library/jest-dom/vitest';
import { SubPanelRowLink } from '@tale/ui/sub-panel-list';
import { ThemeContext } from '@tale/ui/theme';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HomeViewSwitcher } from '@/app/features/home/components/home-view-switcher';
import { NotificationRow } from '@/app/features/notifications/components/notification-row';
import { CitationLink } from '@/app/features/shared/markdown/citation-link';
import type { CitationInfo } from '@/app/features/shared/markdown/use-citations';
import { contrastRatio, deriveAccentPalette } from '@/lib/utils/color';
import { painted } from '@/tests/utils/paint';
import { cleanup, render, screen } from '@/tests/utils/render';

import { BrandingProvider } from './branding-provider';

import '@/app/globals.css';

/**
 * The accent audit (TALE-8), kept: an organization's accent painted by a
 * real browser into the chrome that carries it, for picks that each broke
 * something — a near-white, a near-black navy and a mid-tone magenta — in
 * both themes. Unread dots wear the accent rather than a fixed blue, and
 * where the accent is the ink itself (a citation, the open row) it reads at
 * 4.5:1 on the tint behind it.
 */

const org = vi.hoisted(() => ({ accent: '#FF00FF' }));

vi.mock('@/app/features/settings/branding/hooks/queries', async (actual) => ({
  ...(await actual<
    typeof import('@/app/features/settings/branding/hooks/queries')
  >()),
  useBranding: () => ({
    data: { accentColor: org.accent },
    refetch: vi.fn(),
  }),
}));

vi.mock('@/app/lib/active-organization', async (actual) => ({
  ...(await actual<typeof import('@/app/lib/active-organization')>()),
  useActiveOrganizationId: () => 'org-test',
}));

vi.mock('@tanstack/react-router', async (actual) => ({
  ...(await actual<typeof import('@tanstack/react-router')>()),
  Link: ({
    children,
    to,
    ...rest
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    children: ReactNode;
    to: string;
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
});

const CITATION: CitationInfo = {
  number: 1,
  type: 'web',
  url: 'https://example.com',
};

/** A pinned theme per case, as the app's theme provider would resolve it. */
const THEME = {
  light: { theme: 'light', resolvedTheme: 'light', setTheme: () => {} },
  dark: { theme: 'dark', resolvedTheme: 'dark', setTheme: () => {} },
} as const;

function Chrome({ theme }: { theme: 'light' | 'dark' }) {
  return (
    <ThemeContext.Provider value={THEME[theme]}>
      <BrandingProvider>
        <div data-testid="page" className="bg-background w-80 p-3">
          <HomeViewSwitcher
            value="all"
            onChange={() => {}}
            options={[
              { view: 'all', attention: 0 },
              { view: 'chats', attention: 2 },
            ]}
          />
          <NotificationRow
            title="Review requested"
            body="Ada asked you to review a task."
            createdAt={Date.now()}
            read={false}
            target={null}
            onActivate={() => {}}
            onMarkRead={() => {}}
            markReadPending={false}
          />
          <p>
            A cited reply <CitationLink citation={CITATION} />
          </p>
          <ul>
            <li>
              <SubPanelRowLink to="/open" active>
                Open row
              </SubPanelRowLink>
            </li>
          </ul>
        </div>
      </BrandingProvider>
    </ThemeContext.Provider>
  );
}

describe.each(['#F5F5F0', '#0B0B2A', '#FF00FF'])('accent %s', (accent) => {
  it.each(['light', 'dark'] as const)(
    'carries the accent legibly in the %s theme',
    (theme) => {
      org.accent = accent;
      document.documentElement.classList.toggle('dark', theme === 'dark');
      render(<Chrome theme={theme} />);
      const { text } = deriveAccentPalette(accent, theme);
      const page = painted(
        getComputedStyle(screen.getByTestId('page')).backgroundColor,
      );

      // Unread dots: the Home switcher's attention mark and a notification's.
      const chats = screen.getByRole('radio', { name: /Chats/ });
      const attention = chats.querySelector('.rounded-full');
      const unread = screen.getByText('Unread').nextElementSibling;
      for (const dot of [attention, unread]) {
        expect(dot).toBeInstanceOf(HTMLElement);
        expect(
          painted(getComputedStyle(dot as HTMLElement).backgroundColor),
        ).toBe(text);
      }

      // Where the accent is the ink: a citation on `bg-primary/10`, the open
      // row on its own `…26` tint.
      for (const ink of [
        screen.getByRole('button', { name: /Source 1/ }),
        screen.getByRole('link', { name: 'Open row' }),
      ]) {
        const style = getComputedStyle(ink);
        const surface = painted(style.backgroundColor, page);
        expect(
          contrastRatio(painted(style.color, surface), surface),
          ink.textContent ?? '',
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
});
