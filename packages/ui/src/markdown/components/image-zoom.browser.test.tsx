import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { alphaOf } from '@/tests/utils/contrast';
import { render, screen, waitFor } from '@/tests/utils/render';

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
