import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { Settings } from 'lucide-react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';

import { render, screen } from '@/tests/utils/render';

import { Button } from './button';
import { IconButton } from './icon-button';
import { SendButton } from './send-button';

import '../../globals.css';

// Real-Chromium coverage for the primary button's chrome under a host accent
// (an organization's brand colour lands in `--color-accent-*`). jsdom
// computes no box-shadow, so only a real engine can say what the edge and the
// focus ring are painted in. Both once ignored the accent: the edge was a
// fixed near-black that rimmed every branded fill in ink, and the focus ring
// was an inset line in `--ring` — the fill's own colour, so it vanished.
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('style');
  document.documentElement.classList.remove('dark');
});

/** The painted layers of `el`'s box-shadow, e.g. `rgb(…) 0px 0px 0px 1px`. */
function shadowLayers(el: HTMLElement): string[] {
  return getComputedStyle(el)
    .boxShadow.split(/,(?![^(]*\))/)
    .map((layer) => layer.trim())
    .filter((layer) => !layer.startsWith('rgba(0, 0, 0, 0)'));
}

/** The colour of the keyboard focus ring: the layer drawn 2px deep inside. */
function focusRingColor(el: HTMLElement): string | undefined {
  const ring = shadowLayers(el).find((layer) =>
    layer.endsWith('0px 0px 0px 2px inset'),
  );
  return ring?.replace(' 0px 0px 0px 2px inset', '');
}

function brand(base: string, fg: string) {
  document.documentElement.style.setProperty('--color-accent-base', base);
  document.documentElement.style.setProperty('--color-accent-fg', fg);
}

describe('primary Button chrome', () => {
  it('rims a branded fill in its own accent, not in ink', () => {
    brand('#ff00ff', '#030712');
    render(<Button>Save</Button>);

    const layers = shadowLayers(screen.getByRole('button', { name: 'Save' }));
    expect(layers).toContain('rgb(255, 0, 255) 0px 0px 0px 1px');
    expect(layers).not.toContain('rgb(3, 7, 18) 0px 0px 0px 1px');
  });

  describe.each([
    ['light', undefined],
    ['dark', undefined],
    ['light', ['#ff00ff', '#030712']],
    ['dark', ['#4e4ed0', '#ffffff']],
  ] as const)('in the %s theme, accent %j', (theme, accent) => {
    it.each([
      ['a text button', () => <Button>Save</Button>, 'Save'],
      [
        'the round send button',
        () => <SendButton label="Send" onClick={() => {}} />,
        'Send',
      ],
      [
        'a primary icon button',
        () => (
          <IconButton icon={Settings} aria-label="Settings" variant="primary" />
        ),
        'Settings',
      ],
    ] as const)(
      'draws the focus ring of %s in the ink, on the fill',
      async (_name, ui, label) => {
        document.documentElement.classList.toggle('dark', theme === 'dark');
        if (accent) brand(accent[0], accent[1]);
        render(ui());
        const button = screen.getByRole('button', { name: label });

        await userEvent.keyboard('{Tab}');
        expect(button).toHaveFocus();

        // The button eases its shadow in (`transition-all`): read the ring
        // once it has landed.
        const style = getComputedStyle(button);
        await expect.poll(() => focusRingColor(button)).toBe(style.color);
        expect(style.color).not.toBe(style.backgroundColor);
      },
    );
  });
});
