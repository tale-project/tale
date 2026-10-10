import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { MCP_TOOL_GROUPS } from '@/lib/mcp/tools';
import { cleanup, render, screen, within } from '@/tests/utils/render';

import { McpEndpointSection } from './mcp-endpoint-section';

import '@/app/globals.css';

/**
 * The API → MCP page in real Chromium: what jsdom cannot judge — contrast in
 * both themes, and whether every tool name fits its column once the page lays
 * out, from a phone to a desktop settings column.
 */

vi.mock('@/lib/site-url-context', () => ({
  useSiteUrl: () => 'https://tale.example.com',
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    className,
  }: {
    children: ReactNode;
    to: string;
    className?: string;
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));
vi.mock('@/app/features/organization/hooks/queries', () => ({
  useOrganization: () => ({
    data: { slug: 'northlight' },
    isError: false,
    refetch: vi.fn(),
  }),
}));

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
});

describe.each([375, 1280])(
  'McpEndpointSection at %ipx (real Chromium)',
  (width) => {
    it.each(['light', 'dark'])(
      'fits every tool name and passes axe in %s mode',
      async (theme) => {
        await page.viewport(width, 900);
        document.documentElement.classList.toggle('dark', theme === 'dark');
        const { container } = render(
          <div className="bg-background text-foreground w-full p-4">
            <SettingsPage>
              <McpEndpointSection organizationId="org-1" />
            </SettingsPage>
          </div>,
        );

        const lists = screen.getAllByRole('list');
        expect(lists).toHaveLength(MCP_TOOL_GROUPS.length);
        for (const list of lists) {
          for (const item of within(list).getAllByRole('listitem')) {
            // A name wider than its column would run into its neighbour.
            expect(
              item.scrollWidth,
              `${item.textContent} overflows its column`,
            ).toBeLessThanOrEqual(item.clientWidth);
          }
        }
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);

        const audit = await axe.run(container, {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
        });
        expect(audit.violations).toEqual([]);
        expect(audit.passes.some((rule) => rule.id === 'color-contrast')).toBe(
          true,
        );
      },
    );
  },
);
