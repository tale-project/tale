import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { Bot } from 'lucide-react';
import { afterEach, describe, expect, it } from 'vitest';
import { cdp, page } from 'vitest/browser';

import { ratioAgainst } from '@/tests/utils/contrast';
import { render, screen } from '@/tests/utils/render';

import { ConnectionIdentity } from './connection-identity';

import '../../globals.css';

// Real-Chromium coverage for what jsdom cannot see: the two 40px marks and
// the line between them fit a phone, the line draws once and is still under
// reduced motion, and the marks, line and glyph keep their contrast in both
// themes.

afterEach(async () => {
  cleanup();
  document.documentElement.classList.remove('dark');
  await cdp().send('Emulation.setEmulatedMedia', { features: [] });
});

function Picture() {
  return (
    <ConnectionIdentity
      label="Claude Code connecting to Tale"
      from={<Bot />}
      to={<span className="text-sm font-semibold">T</span>}
    />
  );
}

const line = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('.animate-connection-reveal')!;

describe('ConnectionIdentity layout', () => {
  it('draws two 40px marks with a 48px line between them, centred in a 320px column', async () => {
    await page.viewport(320, 640);
    const { container } = render(
      <div className="w-[17.5rem]" data-testid="column">
        <Picture />
      </div>,
    );
    const picture = screen.getByRole('img');
    const marks = [
      ...picture.querySelectorAll<HTMLElement>(
        ':scope > span:not(:nth-child(2))',
      ),
    ].map((mark) => mark.getBoundingClientRect());
    expect(marks).toHaveLength(2);
    for (const mark of marks) {
      expect(mark.width).toBe(40);
      expect(mark.height).toBe(40);
    }
    const between = line(container).getBoundingClientRect();
    expect(between.width).toBe(48);
    expect(between.left).toBeGreaterThanOrEqual(marks[0]!.right);
    expect(between.right).toBeLessThanOrEqual(marks[1]!.left);
    const column = screen.getByTestId('column').getBoundingClientRect();
    const total = marks[1]!.right - marks[0]!.left;
    expect(total).toBe(128);
    expect(marks[0]!.left - column.left).toBeCloseTo(
      column.right - marks[1]!.right,
      0,
    );
  });

  it('sets an icon at 24px inside its tile', async () => {
    await page.viewport(800, 600);
    render(<Picture />);
    const icon = screen
      .getByRole('img')
      .querySelector<SVGElement>('svg.lucide-bot')!;
    expect(icon.getBoundingClientRect().width).toBe(24);
  });
});

describe('ConnectionIdentity motion', () => {
  it('draws its line once when it appears', async () => {
    await page.viewport(800, 600);
    const { container } = render(<Picture />);
    const animations = line(container).getAnimations();
    expect(animations).toHaveLength(1);
    expect(animations[0]).toMatchObject({ animationName: 'connection-reveal' });
    expect(animations[0]?.effect?.getComputedTiming().iterations).toBe(1);
    await animations[0]?.finished;
    expect(getComputedStyle(line(container)).clipPath).toMatch(
      /^inset\(0px 0(%|px) 0px 0px\)$/,
    );
  });

  it('is already drawn under reduced motion', async () => {
    await cdp().send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    await page.viewport(800, 600);
    const { container } = render(<Picture />);
    const running = line(container)
      .getAnimations()
      .filter(
        (animation) =>
          animation.playState === 'running' &&
          Number(animation.effect?.getComputedTiming().duration) > 1,
      );
    expect(running).toEqual([]);
  });
});

describe('ConnectionIdentity in forced colours', () => {
  it('keeps the tiles, the line and the glyph drawn in system colours', async () => {
    await cdp().send('Emulation.setEmulatedMedia', {
      features: [{ name: 'forced-colors', value: 'active' }],
    });
    await page.viewport(800, 600);
    const { container } = render(<Picture />);
    const canvas = getComputedStyle(document.body).backgroundColor;
    const tiles = container.querySelectorAll<HTMLElement>(
      '[role="img"] > span:not(:nth-child(2))',
    );
    expect(tiles).toHaveLength(2);
    for (const tile of tiles) {
      expect(getComputedStyle(tile).borderTopColor).not.toBe(canvas);
    }
    expect(getComputedStyle(line(container)).borderTopColor).not.toBe(canvas);
    expect(getComputedStyle(line(container)).borderTopStyle).toBe('dashed');
    const glyph = container.querySelector<SVGElement>('svg.lucide-link2')!;
    expect(getComputedStyle(glyph).color).not.toBe(canvas);
  });
});

describe('ConnectionIdentity colour', () => {
  it.each(['light', 'dark'])(
    'passes axe, and its marks, line and glyph stay visible (%s)',
    async (theme) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      await page.viewport(800, 600);
      const { container } = render(
        <div className="bg-background p-4">
          <Picture />
        </div>,
      );
      await Promise.all(
        document.getAnimations().map((animation) => animation.finished),
      );
      const result = await axe.run(container, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
      });
      expect(result.violations).toEqual([]);
      // The marks' contents are what the eye reads: an icon or a letter on
      // its tile, and the link glyph on its disc. The borders, the dashed
      // line and the tile's fill are chrome, as on every card.
      const picture = container.querySelector<HTMLElement>('[role="img"]')!;
      for (const glyph of picture.querySelectorAll<SVGElement>('svg')) {
        expect(
          ratioAgainst(glyph.parentElement!, getComputedStyle(glyph).color),
          `${theme} ${glyph.getAttribute('class')}`,
        ).toBeGreaterThanOrEqual(3);
      }
      const letter = screen.getByText('T');
      expect(
        ratioAgainst(letter.parentElement!, getComputedStyle(letter).color),
        `${theme} letter`,
      ).toBeGreaterThanOrEqual(4.5);
    },
  );
});
