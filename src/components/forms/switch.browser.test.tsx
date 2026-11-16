import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';

import { ratioAgainst } from '@/tests/utils/contrast';
import { render, screen } from '@/tests/utils/render';

import { Switch } from './switch';

import '../../globals.css';

// Real-Chromium coverage for the switch's keyboard focus ring, which jsdom
// does not paint. A host accent lands in `--ring` as a shade that reads
// 4.5:1 on the page; the ring was that shade at half strength — the only
// focus mark, since the track's state borders win over its focus border —
// and an accent's ring painted 2.2–2.7:1 against the page in either theme.
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('style');
  document.documentElement.classList.remove('dark');
});

/** The accent's text shade per theme, as the platform's branding provider
 * sets it into `--primary` and `--ring` for a blue, a near-white, a
 * near-black navy and a magenta pick. */
const ACCENT_RINGS = {
  light: ['210 100% 36%', '60 20% 32%', '240 58% 10%', '300 100% 32%'],
  dark: ['210 100% 54%', '60 20% 95%', '240 58% 69%', '300 100% 50%'],
} as const;

/** The colour of the focus ring: the widest solid ring among `el`'s
 * box-shadow layers (an offset gap is the narrower one inside it). */
function focusRingColor(el: HTMLElement): string | undefined {
  const rings = getComputedStyle(el)
    .boxShadow.split(/,(?![^(]*\))/)
    .flatMap((layer) => {
      const match =
        /^(.+\))\s+-?[\d.]+px\s+-?[\d.]+px\s+([\d.]+)px\s+([\d.]+)px$/.exec(
          layer.trim(),
        );
      if (!match || Number(match[2]) !== 0 || Number(match[3]) === 0) {
        return [];
      }
      return [{ color: match[1] ?? '', spread: Number(match[3]) }];
    });
  return rings.toSorted((a, b) => b.spread - a.spread)[0]?.color;
}

describe.each(['light', 'dark'] as const)(
  'Switch focus in the %s theme',
  (theme) => {
    it.each<[name: string, ring: string | undefined]>([
      ['unbranded', undefined],
      ...ACCENT_RINGS[theme].map((ring): [string, string] => [
        `accent ${ring}`,
        ring,
      ]),
    ])('draws a ring that clears 3:1 on the page, %s', async (_name, ring) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      if (ring) {
        document.documentElement.style.setProperty('--primary', ring);
        document.documentElement.style.setProperty('--ring', ring);
      }
      render(
        <div data-testid="page" className="bg-background flex gap-6 p-6">
          {/* Judge the settled ring, independent of transition timing. */}
          <style>{'* { transition: none !important; }'}</style>
          <Switch aria-label="Off" />
          <Switch aria-label="On" defaultChecked />
        </div>,
      );
      const page = screen.getByTestId('page');

      for (const name of ['Off', 'On']) {
        const control = screen.getByRole('switch', { name });
        await userEvent.keyboard('{Tab}');
        expect(control).toHaveFocus();
        const color = focusRingColor(control);
        expect(color, `${name}: no focus ring`).toBeDefined();
        expect(
          ratioAgainst(page, color ?? 'transparent'),
          `${name}: ${color}`,
        ).toBeGreaterThanOrEqual(3);
      }
    });
  },
);
