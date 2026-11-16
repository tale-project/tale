import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { ratioAgainst } from '@/tests/utils/contrast';
import { render, screen } from '@/tests/utils/render';

import { DropdownMenu } from './dropdown-menu';

import '../../globals.css';

// Real-Chromium coverage for the switch a checkbox row draws: the row is on
// when its track wears `--primary`, and its knob has to stand out on that
// track (3:1) in either theme. A white knob vanished on the dark theme's
// white track, and on a near-white accent's.
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('style');
  document.documentElement.classList.remove('dark');
});

/** The accent's text shade and its ink per theme, as the platform's branding
 * provider sets them into `--primary` and `--primary-foreground` for a
 * near-white, a near-black navy and a magenta pick. */
const ACCENT_PAIRS = {
  light: [
    ['60 20% 32%', '0 0% 100%'],
    ['240 58% 10%', '0 0% 100%'],
    ['300 100% 32%', '0 0% 100%'],
  ],
  dark: [
    ['60 20% 95%', '224 71% 4%'],
    ['240 58% 69%', '224 71% 4%'],
    ['300 100% 50%', '224 71% 4%'],
  ],
} as const;

describe.each(['light', 'dark'] as const)(
  'DropdownMenu checkbox row in the %s theme',
  (theme) => {
    it.each<
      [name: string, pair: readonly [primary: string, ink: string] | undefined]
    >([
      ['unbranded', undefined],
      ...ACCENT_PAIRS[theme].map(
        (pair): [string, readonly [string, string]] => [
          `accent ${pair[0]}`,
          pair,
        ],
      ),
    ])('draws the knob of an on switch legibly, %s', async (_name, pair) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      if (pair) {
        document.documentElement.style.setProperty('--primary', pair[0]);
        document.documentElement.style.setProperty(
          '--primary-foreground',
          pair[1],
        );
      }
      render(
        <>
          {/* Judge the settled colours, independent of transition timing. */}
          <style>{'* { transition: none !important; }'}</style>
          <DropdownMenu
            trigger={<button type="button">Tools</button>}
            items={[
              [
                {
                  type: 'checkbox',
                  label: 'Web search',
                  checked: true,
                  onCheckedChange: () => {},
                },
              ],
            ]}
          />
        </>,
      );

      await page.getByRole('button', { name: 'Tools' }).click();
      const row = await screen.findByRole('menuitemcheckbox', {
        name: 'Web search',
      });
      const track = row.querySelector<HTMLElement>('span[aria-hidden]');
      const knob = track?.firstElementChild;
      if (!track || !(knob instanceof HTMLElement)) {
        throw new Error('no switch in the checkbox row');
      }

      expect(
        ratioAgainst(track, getComputedStyle(knob).backgroundColor),
      ).toBeGreaterThanOrEqual(3);
    });
  },
);
