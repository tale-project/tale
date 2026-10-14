import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { i18n } from '@/lib/i18n/i18n';
import { cleanup, render, screen } from '@/tests/utils/render';

import { McpConnectSection } from './mcp-connect-section';

import '@/app/globals.css';

/**
 * The connect section of the API → MCP page in real Chromium: it fits a phone
 * and a desktop settings column in every language, with a long address and
 * the longest German and French words, its commands wrap instead of scrolling
 * sideways, and it passes an audit in both themes.
 */

vi.mock('@/lib/site-url-context', () => ({
  useSiteUrl: () => 'https://tale.a-company-with-a-very-long-name.example.com',
}));
vi.mock('@/app/features/coding-agent/hooks/use-new-connection', () => ({
  useNewConnection: () => ({ state: 'waiting' }),
}));
vi.mock(
  '@/app/features/settings/model-endpoints/hooks/use-api-settings-access',
  () => ({ useApiSettingsAccess: () => ({ connectAgents: true }) }),
);

function renderSection() {
  return render(
    <SettingsPage>
      <McpConnectSection organizationId="org-1" />
    </SettingsPage>,
  );
}

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
  localStorage.removeItem('user-locale');
});

describe('the connect section fits the page', () => {
  for (const language of ['en', 'de', 'fr']) {
    for (const width of [320, 390, 1280]) {
      it(`has no sideways scroll at ${width}px in ${language}`, async () => {
        await page.viewport(width, 900);
        localStorage.setItem('user-locale', language);
        await i18n.changeLanguage(language);
        const { user } = renderSection();
        const section = document.querySelector<HTMLElement>(
          '[data-settings-section]',
        );
        expect(section).not.toBeNull();
        const edge = section!.getBoundingClientRect().right;

        for (const tab of screen.getAllByRole('tab')) {
          await user.click(tab);
          const root = document.scrollingElement as HTMLElement;
          expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
          for (const element of section!.querySelectorAll<HTMLElement>(
            'h2, h3, p, a, button, pre, [role="tab"], [role="status"]',
          )) {
            const box = element.getBoundingClientRect();
            if (box.width === 0) continue;
            expect(
              box.right,
              `${tab.textContent}: ${element.tagName} ${element.textContent?.slice(0, 40)}`,
            ).toBeLessThanOrEqual(edge + 0.5);
          }
          // A command wraps within its block: it never scrolls sideways.
          for (const block of section!.querySelectorAll<HTMLElement>('pre')) {
            expect(block.scrollWidth).toBeLessThanOrEqual(
              block.clientWidth + 1,
            );
          }
        }
      });
    }
  }
});

describe('the connect section in both themes', () => {
  for (const theme of ['light', 'dark']) {
    it(`passes an accessibility audit (${theme})`, async () => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      await page.viewport(1024, 900);
      await i18n.changeLanguage('en');
      const { container } = renderSection();
      const result = await axe.run(container, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
      });
      expect(result.violations).toEqual([]);
    });
  }
});
