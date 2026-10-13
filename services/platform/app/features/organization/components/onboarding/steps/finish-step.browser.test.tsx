import '@testing-library/jest-dom/vitest';
import { Wizard } from '@tale/ui/wizard/wizard';
import { cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { i18n } from '@/lib/i18n/i18n';
import { render, screen, within } from '@/tests/utils/render';

import '@/app/globals.css';

import { FinishStep } from './finish-step';

// Real-Chromium coverage for what jsdom cannot lay out or judge: the closing
// step's rows — including the one that connects a coding agent — fit every
// screen in every language, pass an audit in both themes, and when an agent
// signs in while the guided setup is open, closing it leaves focus on the row
// that now says so (its button is gone).

const h = vi.hoisted(() => ({
  access: { mayConnect: true } as { mayConnect: boolean } | undefined,
  connections: [] as { clientName: string }[],
}));

vi.mock('@/lib/site-url-context', () => ({
  useSiteUrl: () => 'https://tale.example.com',
}));
vi.mock('@/app/features/coding-agent/hooks/use-new-connection', () => ({
  useNewConnection: () => ({ state: 'waiting' }),
}));
vi.mock('@/app/features/settings/agent-connections/hooks/queries', () => ({
  useAgentConnectionAccess: () => ({ data: h.access }),
  useAgentConnections: () => ({
    data: { connections: h.connections, canSeeEveryone: false },
  }),
}));

const CONNECT = {
  en: 'Connect an agent',
  de: 'Agent verbinden',
  fr: 'Connecter un agent',
} as const;

function tree() {
  return (
    <Wizard
      steps={[{ id: 'finish', label: 'Finish' }]}
      onFinish={() => {}}
      formatProgress={(current, total, label) =>
        `Step ${current} of ${total}: ${label}`
      }
    >
      <FinishStep
        onFinishTo={() => {}}
        providerConnected={false}
        organizationId="org-1"
      />
    </Wizard>
  );
}

/** The dialog and its overlay fade in, and both a visibility check and axe
 * read the opacity of every ancestor. The waiting dot pulses for good, so
 * only the animations that end are awaited. */
async function settleAnimations() {
  await Promise.allSettled(
    document
      .getAnimations()
      .filter(
        (animation) =>
          animation.effect?.getComputedTiming().iterations !== Infinity,
      )
      .map((animation) => animation.finished),
  );
}

beforeEach(() => {
  h.access = { mayConnect: true };
  h.connections = [];
});

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
  localStorage.removeItem('user-locale');
});

describe('the closing step fits the screen', () => {
  for (const language of ['en', 'de', 'fr'] as const) {
    for (const width of [320, 390, 1280]) {
      it(`keeps every row and button inside the list at ${width}px in ${language}`, async () => {
        await page.viewport(width, 800);
        localStorage.setItem('user-locale', language);
        await i18n.changeLanguage(language);
        render(tree());
        const list = screen.getByRole('list');
        const root = document.scrollingElement as HTMLElement;
        expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);

        const edge = list.getBoundingClientRect().right;
        const rows = within(list).getAllByRole('listitem');
        expect(rows).toHaveLength(3);
        expect(
          within(list).getByRole('button', { name: CONNECT[language] }),
        ).toBeVisible();
        for (const button of within(list).getAllByRole('button')) {
          expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(
            edge + 0.5,
          );
        }
      });
    }
  }
});

describe('the coding agent row', () => {
  it('leaves focus on the row once an agent has connected while the setup was open', async () => {
    await page.viewport(1024, 800);
    await i18n.changeLanguage('en');
    const { user, rerender } = render(tree());
    await user.click(screen.getByRole('button', { name: 'Connect an agent' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Connect a coding agent',
    });
    await settleAnimations();
    expect(dialog).toBeVisible();

    // The agent signs in while the person is still in the dialog: the button
    // that opened it turns into the done marker.
    h.connections = [{ clientName: 'Claude Code' }];
    rerender(tree());
    expect(
      screen.queryByRole('button', { name: 'Connect an agent' }),
    ).not.toBeInTheDocument();

    await user.keyboard('{Escape}');
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    const row = screen
      .getByText('Coding agent connected: Claude Code.')
      .closest('li');
    expect(row).toHaveFocus();
  });

  it('hands focus back to its button when nothing connected', async () => {
    await page.viewport(1024, 800);
    await i18n.changeLanguage('en');
    const { user } = render(tree());
    const button = screen.getByRole('button', { name: 'Connect an agent' });
    await user.click(button);
    await screen.findByRole('dialog', { name: 'Connect a coding agent' });
    await user.keyboard('{Escape}');
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(button).toHaveFocus();
  });

  for (const theme of ['light', 'dark']) {
    for (const state of ['to connect', 'connected'] as const) {
      it(`passes an accessibility audit, ${state} (${theme})`, async () => {
        document.documentElement.classList.toggle('dark', theme === 'dark');
        h.connections =
          state === 'connected' ? [{ clientName: 'Claude Code' }] : [];
        await page.viewport(1024, 800);
        await i18n.changeLanguage('en');
        render(tree());
        const list = screen.getByRole('list');
        await settleAnimations();
        const result = await axe.run(list, {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
        });
        expect(result.violations).toEqual([]);
      });
    }
  }
});
