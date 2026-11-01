import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { i18n } from '@/lib/i18n/i18n';
import { render, screen, within } from '@/tests/utils/render';

import '@/app/globals.css';

import { FixRunButton } from './coding-agent-entry';
import { RunFailureCard } from './run-failure-card';

// Real-Chromium coverage for what jsdom cannot lay out: the failure card's
// ways on — including the one that hands the run to a coding agent — fit every
// screen in every language, the dialog it opens passes an audit in both themes,
// and closing the dialog brings focus back to the button that opened it.

vi.mock('@/lib/site-url-context', () => ({
  useSiteUrl: () => 'https://tale.example.com',
}));
vi.mock('@/app/features/coding-agent/hooks/use-new-connection', () => ({
  useNewConnection: () => ({ state: 'waiting' }),
}));
vi.mock('@/app/features/projects/hooks/queries', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/app/features/projects/hooks/queries')
  >()),
  useNamedProjects: () => ({ projects: new Map(), isPending: false }),
}));
vi.mock(
  '@/app/features/settings/agent-connections/hooks/queries',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/app/features/settings/agent-connections/hooks/queries')
    >()),
    useAgentConnectionAccess: () => ({ data: { signInOn: true } }),
  }),
);

const FIX_NAME = {
  en: 'Fix with your coding agent',
  de: 'Mit deinem Coding-Agent beheben',
  fr: 'Corriger avec ton agent de code',
} as const;

function renderCard() {
  return render(
    <RunFailureCard
      failure={{
        code: 'connector_error',
        reason: 'CONNECTOR_CREDENTIAL_MISSING',
        params: { connector: 'imap-smtp' },
        message: 'no usable credential for imap-smtp',
      }}
      stepLabel="Send the weekly digest to the whole team"
      onShowStep={() => {}}
      onRetryFromStep={() => {}}
      actions={
        <FixRunButton
          organizationId="org-1"
          automationSlug="support/triage-inbox"
          runId="run-9f3"
        />
      }
    />,
  );
}

/**
 * The dialog and its overlay fade in, and both a visibility check and axe
 * read the opacity of every ancestor: one that starts a few frames in judges
 * the text at a few percent. The waiting dot pulses for good, so only the
 * animations that end are awaited.
 */
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

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
  localStorage.removeItem('user-locale');
});

describe('the failure card fits the screen', () => {
  for (const language of ['en', 'de', 'fr'] as const) {
    for (const width of [320, 390, 768, 1280]) {
      it(`keeps its buttons inside the card at ${width}px in ${language}`, async () => {
        await page.viewport(width, 800);
        localStorage.setItem('user-locale', language);
        await i18n.changeLanguage(language);
        renderCard();
        const card = screen.getAllByRole('region')[0] as HTMLElement;
        const root = document.scrollingElement as HTMLElement;
        expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);

        const edge = card.getBoundingClientRect().right;
        const buttons = within(card).getAllByRole('button');
        // Show step, Retry from this step and the way to a coding agent.
        expect(buttons).toHaveLength(3);
        expect(within(card).getByRole('button', { name: FIX_NAME[language] }));
        for (const button of buttons) {
          expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(
            edge + 0.5,
          );
        }
      });
    }
  }
});

describe('the way to a coding agent', () => {
  it('hands focus back to its button when the dialog closes', async () => {
    await page.viewport(1024, 800);
    await i18n.changeLanguage('en');
    const { user } = renderCard();
    const fix = screen.getByRole('button', { name: FIX_NAME.en });
    await user.click(fix);
    const dialog = await screen.findByRole('dialog', { name: FIX_NAME.en });
    await settleAnimations();
    expect(
      within(dialog).getByText(
        /The run run-9f3 of the automation support\/triage-inbox failed\./,
      ),
    ).toBeVisible();
    await user.keyboard('{Escape}');
    // The dialog's focus scope hands focus back a task after it unmounts.
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(fix).toHaveFocus();
    });
  });

  for (const theme of ['light', 'dark']) {
    it(`passes an accessibility audit with the dialog open (${theme})`, async () => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      await page.viewport(1024, 800);
      await i18n.changeLanguage('en');
      const { user } = renderCard();
      await user.click(screen.getByRole('button', { name: FIX_NAME.en }));
      const dialog = await screen.findByRole('dialog', { name: FIX_NAME.en });
      await settleAnimations();
      const result = await axe.run(dialog, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
      });
      expect(result.violations).toEqual([]);
    });
  }
});
