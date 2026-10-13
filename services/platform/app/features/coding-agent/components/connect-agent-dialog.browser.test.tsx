import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { i18n } from '@/lib/i18n/i18n';
import { render, screen, waitFor } from '@/tests/utils/render';

import '@/app/globals.css';

import { ConnectAgentDialog } from './connect-agent-dialog';

// Real-Chromium coverage for what jsdom cannot lay out: the dialog that
// connects a coding agent fits every screen in every language, with a long
// address and the longest German and French words, its commands wrap instead
// of scrolling sideways, its tabs move with the arrow keys, and it passes an
// audit in both themes, waiting for an agent and with one connected.

const h = vi.hoisted(() => ({
  watch: { state: 'waiting' } as
    | { state: 'waiting' }
    | { state: 'connected'; clientName: string },
}));

vi.mock('@/lib/site-url-context', () => ({
  useSiteUrl: () => 'https://tale.a-company-with-a-very-long-name.example.com',
}));
vi.mock('../hooks/use-new-connection', () => ({
  useNewConnection: () => h.watch,
}));

function renderDialog() {
  return render(
    <ConnectAgentDialog organizationId="org-1" open onOpenChange={() => {}} />,
  );
}

beforeEach(() => {
  h.watch = { state: 'waiting' };
});

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
  localStorage.removeItem('user-locale');
});

describe('the connect dialog fits the screen', () => {
  for (const language of ['en', 'de', 'fr']) {
    for (const width of [320, 390, 768, 1280]) {
      it(`has no sideways scroll at ${width}px in ${language}, on every tab`, async () => {
        await page.viewport(width, 800);
        localStorage.setItem('user-locale', language);
        await i18n.changeLanguage(language);
        const { user } = renderDialog();
        const dialog = await screen.findByRole('dialog');

        for (const tab of screen.getAllByRole('tab')) {
          await user.click(tab);
          const root = document.scrollingElement as HTMLElement;
          expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
          const edge = dialog.getBoundingClientRect().right;
          for (const element of dialog.querySelectorAll<HTMLElement>(
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
          for (const block of dialog.querySelectorAll<HTMLElement>('pre')) {
            expect(block.scrollWidth).toBeLessThanOrEqual(
              block.clientWidth + 1,
            );
          }
        }
      });
    }
  }
});

describe('the connect dialog by keyboard', () => {
  it('moves between the agents with the arrow keys, and shows each one’s own commands', async () => {
    await page.viewport(1024, 800);
    await i18n.changeLanguage('en');
    const { user } = renderDialog();
    const claude = await screen.findByRole('tab', { name: 'Claude Code' });
    claude.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Codex' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Codex' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // The panel fades in: wait for it rather than catch it half way.
    await waitFor(() =>
      expect(screen.getByText(/^codex mcp add tale --url /)).toBeVisible(),
    );
    expect(screen.queryByText(/^claude mcp add/)).not.toBeInTheDocument();
  });

  it('reaches every copy button and the way out, in order', async () => {
    await page.viewport(1024, 800);
    await i18n.changeLanguage('en');
    const { user } = renderDialog();
    await screen.findByRole('dialog');
    const nameOf = (element: Element | null): string =>
      element?.getAttribute('aria-label') ??
      (element?.getAttribute('role') === 'tabpanel'
        ? 'tabpanel'
        : (element?.textContent ?? ''));
    // Focus opens on the agent's tab; Close, being chrome, comes last.
    const reached = [nameOf(document.activeElement)];
    for (let step = 0; step < 12 && reached.at(-1) !== 'Close'; step += 1) {
      await user.tab();
      reached.push(nameOf(document.activeElement));
    }
    expect(reached).toEqual([
      'Claude Code',
      'tabpanel',
      'Copy command',
      'Copy command',
      'Copy prompt',
      'Setup guide',
      'Done',
      'Close',
    ]);
  });
});

describe('the connect dialog in both themes', () => {
  for (const theme of ['light', 'dark']) {
    for (const state of ['waiting', 'connected'] as const) {
      it(`passes an accessibility audit while ${state} (${theme})`, async () => {
        document.documentElement.classList.toggle('dark', theme === 'dark');
        h.watch =
          state === 'waiting'
            ? { state: 'waiting' }
            : { state: 'connected', clientName: 'Claude Code' };
        await page.viewport(1024, 800);
        await i18n.changeLanguage('en');
        renderDialog();
        const dialog = await screen.findByRole('dialog');
        const result = await axe.run(dialog, {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
        });
        expect(result.violations).toEqual([]);
      });
    }
  }
});
