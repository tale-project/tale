import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { alphaOf } from '@/tests/utils/contrast';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { MOBILE_QUERY } from '../../hooks/use-is-mobile';
import type { ResponsiveImage } from '../../images/responsive';
import { ImageZoom } from './image-zoom';

import '../../globals.css';

afterEach(() => {
  cleanup();
});

const ALT = 'Chat screen with agent picker';
// An inline image keeps the test off the network. It sits small in the
// middle of the lightbox, so the corner beside it is the backdrop.
const SRC = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="#4f46e5"/></svg>',
)}`;

describe('the lightbox over the page', () => {
  // The overlay spans the whole page, so a backdrop blur on it made the
  // frame that opens an image blur the viewport: without GPU compositing
  // that frame took 144 ms (#4348), for a blur 80% black barely shows. The
  // overlay only dims, and the lightbox keeps its title, focus and closing.
  it('dims the page with no backdrop blur and still closes as before', async () => {
    render(<ImageZoom src={SRC} alt={ALT} />);
    const trigger = screen.getByRole('button', { name: ALT });
    await page.getByRole('button', { name: ALT }).click();
    const dialog = await waitFor(() =>
      screen.getByRole('dialog', { name: ALT }),
    );
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true);
    });

    const blurred = [...document.body.querySelectorAll('*')]
      .filter((element) => getComputedStyle(element).backdropFilter !== 'none')
      .map((element) => element.getAttribute('class') ?? element.tagName);
    expect(blurred).toEqual([]);

    // The content spans the viewport too: the overlay is what it paints over.
    const overlay = document
      .elementsFromPoint(8, 8)
      .find((element) => !dialog.contains(element));
    if (overlay === undefined) throw new Error('Nothing covers the page');
    expect(overlay).toHaveAttribute('data-state', 'open');
    const box = overlay.getBoundingClientRect();
    expect([box.left, box.top, box.width, box.height]).toEqual([
      0,
      0,
      document.documentElement.clientWidth,
      document.documentElement.clientHeight,
    ]);
    const dimAlpha = alphaOf(getComputedStyle(overlay).backgroundColor);
    expect(dimAlpha).toBeGreaterThan(0);
    expect(dimAlpha).toBeLessThan(1);

    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });

    await page.getByRole('button', { name: ALT }).click();
    const reopened = await waitFor(() =>
      screen.getByRole('dialog', { name: ALT }),
    );
    await page.elementLocator(reopened).click({ position: { x: 8, y: 8 } });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});

/** An inline image of one colour, so each file the browser picks is its own
 * URL and the test stays off the network. */
const swatch = (width: number, height: number, fill: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${fill}"/></svg>`,
  )}`;
const DESKTOP_FULL = swatch(2880, 1800, '#4f46e5');
const DESKTOP: ResponsiveImage = {
  width: 2880,
  height: 1800,
  variants: {
    avif: { 1600: swatch(1600, 1000, '#4338ca') },
    webp: { 1600: swatch(1600, 1000, '#3730a3') },
  },
};
const PHONE_FULL = swatch(780, 1688, '#059669');
const PHONE: ResponsiveImage = {
  width: 780,
  height: 1688,
  variants: {
    avif: { 780: swatch(780, 1688, '#047857') },
    webp: { 780: swatch(780, 1688, '#065f46') },
  },
};

describe('a screenshot with a phone capture', () => {
  // The docs show Tale's phone layout below the breakpoint where Tale itself
  // switches to it, and the lightbox opens the full-size file of the capture
  // the page shows — never the other one.
  it.each([
    {
      width: 390,
      height: 844,
      page: PHONE.variants.avif[780],
      full: PHONE_FULL,
    },
    {
      width: 1280,
      height: 800,
      page: DESKTOP.variants.avif[1600],
      full: DESKTOP_FULL,
    },
  ])(
    'loads the matching capture at $width px, on the page and in the lightbox',
    async ({ width, height, page: pageFile, full: fullFile }) => {
      await page.viewport(width, height);
      render(
        <ImageZoom
          src={DESKTOP_FULL}
          alt={ALT}
          image={DESKTOP}
          sizes="(min-width: 48rem) 48rem, 100vw"
          sources={[{ media: MOBILE_QUERY, image: PHONE, src: PHONE_FULL }]}
        />,
      );
      const shown = screen.getByRole('img', { name: ALT });
      await waitFor(() => {
        expect(shown).toHaveProperty('currentSrc', pageFile);
      });

      await page.getByRole('button', { name: ALT }).click();
      const dialog = await waitFor(() =>
        screen.getByRole('dialog', { name: ALT }),
      );
      const full = within(dialog).getByRole('img', { name: ALT });
      await waitFor(() => {
        expect(full).toHaveProperty('currentSrc', fullFile);
        expect(full).toHaveProperty('complete', true);
      });
      // The lightbox image stays the flex item it is without a phone capture.
      const box = full.getBoundingClientRect();
      expect(box.width).toBeGreaterThan(0);
      expect(box.width).toBeLessThanOrEqual(width * 0.95 + 1);
      expect(box.height).toBeLessThanOrEqual(height * 0.9 + 1);
    },
  );
});
