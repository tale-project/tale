import '@testing-library/jest-dom/vitest';
import { SegmentedControl } from '@tale/ui/segmented-control';
import axe from 'axe-core';
import {
  Inbox,
  Layers,
  ListChecks,
  MessageCircle,
  SquarePen,
  Workflow,
} from 'lucide-react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { i18n } from '@/tests/utils/i18n-all-languages';
import { forgetSavedLocale, saveLocale } from '@/tests/utils/lapsed-session';
import { cleanup, render, screen } from '@/tests/utils/render';

import type { HomeView } from '../lib/home-items';
import { HomeViewSwitcher } from './home-view-switcher';

import '@/app/globals.css';

afterEach(async () => {
  cleanup();
  document.documentElement.classList.remove('dark');
  await forgetSavedLocale();
});

function Switcher() {
  const [view, setView] = useState<HomeView>('all');
  return (
    <div className="bg-background w-70 p-3">
      <HomeViewSwitcher
        value={view}
        onChange={setView}
        options={[
          { view: 'all', attention: 0 },
          { view: 'chats', attention: 0 },
          { view: 'tasks', attention: 2 },
          { view: 'inbox', attention: 0 },
        ]}
      />
    </div>
  );
}

describe.each(['light', 'dark'])('Home view switcher (%s)', (theme) => {
  it('keeps the open view and the icons readable on the track', async () => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { container } = render(<Switcher />);
    const result = await axe.run(container, { runOnly: ['color-contrast'] });
    expect(result.violations).toEqual([]);
    expect(result.passes.some((rule) => rule.id === 'color-contrast')).toBe(
      true,
    );
  });

  it('moves selection and focus together and wraps at both ends', async () => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { user } = render(<Switcher />);
    const options = screen.getAllByRole('radio');
    options[0]?.focus();
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(options[3]);
    expect(options[3]?.getAttribute('aria-checked')).toBe('true');
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}');
    expect(document.activeElement).toBe(options[2]);
    expect(options[2]?.getAttribute('aria-checked')).toBe('true');
    expect(options.filter((option) => option.tabIndex === 0)).toHaveLength(1);
  });
});

describe.each(['en', 'de', 'fr'] as const)(
  'Home view switcher in %s',
  (locale) => {
    it('names every view in full and says what waits on the reader', async () => {
      saveLocale(locale);
      await i18n.changeLanguage(locale);
      render(<Switcher />);
      const t = i18n.getFixedT(locale, 'home');
      expect(
        screen.getByRole('radiogroup', { name: t('views.label') }),
      ).toBeVisible();
      // Three of the four show only an icon; their names are still whole.
      expect(
        screen.getAllByRole('radio').map((radio) => radio.textContent),
      ).toEqual([
        t('views.all'),
        t('views.chats'),
        `${t('views.tasks')}, ${t('aria.attention', { count: 2 })}`,
        t('views.inbox'),
      ]);
    });
  },
);

/** The icons and words of a later kind of work — a fifth view, mocked here
 * with the Automations section's name, the longest the app has to offer. */
const FIVE_VIEWS = [
  { value: 'all', key: 'home:views.all', icon: Layers },
  { value: 'chats', key: 'home:views.chats', icon: MessageCircle },
  { value: 'tasks', key: 'home:views.tasks', icon: ListChecks },
  { value: 'inbox', key: 'home:views.inbox', icon: Inbox },
  { value: 'automations', key: 'navigation:automations', icon: Workflow },
] as const;

/** The Home panel's first row as `HomeNavigator` lays it out: the switcher's
 * column, then the desktop panel's 32px New chat, which a phone leaves out. */
function FiveViewRow({
  width,
  withNewChat,
  initial,
}: {
  width: number;
  withNewChat: boolean;
  initial: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div data-testid="host" className="bg-background" style={{ width }}>
      <div className="flex shrink-0 items-center gap-1.5 px-2.5 pt-2.5 pb-2">
        <div className="min-w-0 flex-1">
          <SegmentedControl
            aria-label={i18n.t('home:views.label')}
            labels="selected"
            value={value}
            onValueChange={setValue}
            options={FIVE_VIEWS.map((view) => ({
              value: view.value,
              label: i18n.t(view.key),
              icon: view.icon,
              ...(view.value === 'chats'
                ? { attention: i18n.t('home:aria.attention', { count: 2 }) }
                : {}),
            }))}
          />
        </div>
        {withNewChat && (
          <span
            data-testid="new-chat"
            className="flex size-8 shrink-0 items-center justify-center"
          >
            <SquarePen className="size-4" />
          </span>
        )}
      </div>
    </div>
  );
}

describe('a fifth view', () => {
  it.each([
    [280, true],
    [480, true],
    [360, false],
  ] as const)(
    'never cuts a name and keeps the row whole at %ipx, in every language',
    async (width, withNewChat) => {
      await page.viewport(withNewChat ? 1280 : width, 800);
      for (const locale of ['en', 'de', 'fr'] as const) {
        saveLocale(locale);
        await i18n.changeLanguage(locale);
        for (const { value } of FIVE_VIEWS) {
          render(
            <FiveViewRow
              width={width}
              withNewChat={withNewChat}
              initial={value}
            />,
          );
          for (const radio of screen.getAllByRole('radio')) {
            // oxlint-disable-next-line testing-library/no-node-access -- the label's frame has no role
            const frame = radio.querySelector(
              '[data-slot="segmented-label-frame"]',
            );
            // oxlint-disable-next-line testing-library/no-node-access -- see above
            const label = frame?.querySelector('[data-slot="segmented-label"]');
            if (
              !(frame instanceof HTMLElement) ||
              !(label instanceof HTMLElement)
            ) {
              throw new Error('A view has no label frame');
            }
            // Shown whole, or folded to the icon: never part of a word.
            const open = frame.getBoundingClientRect().width;
            expect(
              open === 0 || open >= label.getBoundingClientRect().width - 0.5,
              `${locale} ${value}: ${label.textContent}`,
            ).toBe(true);
          }
          // Every view stays in the row, short of New chat.
          const host = screen.getByTestId('host').getBoundingClientRect();
          const end = withNewChat
            ? screen.getByTestId('new-chat').getBoundingClientRect()
            : null;
          for (const radio of screen.getAllByRole('radio')) {
            expect(radio.getBoundingClientRect().right).toBeLessThanOrEqual(
              end?.left ?? host.right,
            );
          }
          if (end !== null) expect(end.right).toBeLessThanOrEqual(host.right);
          cleanup();
        }
      }
    },
  );

  it('still names the open view where there is room for it', async () => {
    await page.viewport(1280, 800);
    for (const locale of ['en', 'de', 'fr'] as const) {
      saveLocale(locale);
      await i18n.changeLanguage(locale);
      render(<FiveViewRow width={480} withNewChat initial="automations" />);
      // oxlint-disable-next-line testing-library/no-node-access -- the label's frame has no role
      const frame = screen
        .getByRole('radio', { name: i18n.t('navigation:automations') })
        .querySelector('[data-slot="segmented-label-frame"]');
      expect(frame).toHaveAttribute('data-shown', 'true');
      cleanup();
    }
  });
});
