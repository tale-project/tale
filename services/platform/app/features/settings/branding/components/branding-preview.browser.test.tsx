import '@testing-library/jest-dom/vitest';
import { ThemeContext } from '@tale/ui/theme';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { AppSidebar } from '@/app/components/layout/app-sidebar/app-sidebar';
import { contrastRatio } from '@/lib/utils/color';
import { painted } from '@/tests/utils/paint';
import { cleanup, render, screen } from '@/tests/utils/render';

import { BrandingPreview } from './branding-preview';

import '@/app/globals.css';

// Keep the real live rail shell; its navigation/data children do not affect
// the surface the preview must match.
vi.mock('@/app/components/layout/app-sidebar/sidebar-header', () => ({
  SidebarHeader: () => null,
}));
vi.mock('@/app/components/layout/app-sidebar/sidebar-footer', () => ({
  SidebarFooter: () => null,
}));
vi.mock('@/app/components/layout/app-sidebar/sidebar-nav', () => ({
  SidebarNav: () => null,
}));
vi.mock('@/app/components/layout/app-sidebar/sidebar-search-trigger', () => ({
  SidebarSearchTrigger: () => null,
}));
vi.mock('@/app/components/layout/app-sidebar/sidebar-search-command', () => ({
  SidebarSearchCommand: () => null,
}));

const THEME = {
  light: { theme: 'light', resolvedTheme: 'light', setTheme: () => {} },
  dark: { theme: 'dark', resolvedTheme: 'dark', setTheme: () => {} },
} as const;

let previousViewport: { width: number; height: number };
beforeEach(() => {
  previousViewport = { width: window.innerWidth, height: window.innerHeight };
});

afterEach(async () => {
  cleanup();
  document.documentElement.classList.remove('dark');
  await page.viewport(previousViewport.width, previousViewport.height);
});

describe.each([undefined, '#0066CC', '#DC2626', '#F5F5F0'])(
  'branding preview with accent %s',
  (accentColor) => {
    it.each(['light', 'dark'] as const)(
      'paints the same rail as the live app in %s mode',
      async (theme) => {
        await page.viewport(1280, 900);
        document.documentElement.classList.toggle('dark', theme === 'dark');
        render(
          <ThemeContext.Provider value={THEME[theme]}>
            <AppSidebar organizationId="org-review" />
            <BrandingPreview data={{ accentColor }} />
          </ThemeContext.Provider>,
        );
        const live = screen.getByRole('complementary');
        const preview = screen.getByTestId('preview-rail');
        const background = painted(getComputedStyle(live).backgroundColor);
        expect(painted(getComputedStyle(preview).backgroundColor)).toBe(
          background,
        );

        const active = screen.getByTestId('preview-rail-active');
        const icon = active.querySelector('svg');
        expect(icon).toBeInstanceOf(SVGElement);
        const surface = painted(
          getComputedStyle(active).backgroundColor,
          background,
        );
        expect(
          contrastRatio(
            painted(getComputedStyle(icon as SVGElement).color, surface),
            surface,
          ),
        ).toBeGreaterThanOrEqual(3);
      },
    );
  },
);
