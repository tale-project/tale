import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { cleanup, render, screen } from '@/tests/utils/render';

import { Sheet } from '../components/overlays/sheet';

import '../globals.css';

afterEach(() => {
  cleanup();
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
});

function mouse(target: EventTarget, type: string, x: number, buttons = 1) {
  target.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons,
      clientX: x,
      clientY: 100,
    }),
  );
}

async function openSheet() {
  await page.viewport(1280, 800);
  render(
    <Sheet
      title="Details"
      open
      onOpenChange={() => {}}
      resize={{ minWidthPx: 280, maxWidthPx: 600 }}
    >
      <p>Details content</p>
    </Sheet>,
  );
  const panel = screen.getByRole('dialog', { name: 'Details' });
  const separator = screen.getByRole('separator');
  await expect.poll(() => panel.getBoundingClientRect().right).toBe(1280);
  return { panel, separator };
}

describe('shared resize hook in the existing right-hand Sheet', () => {
  it('drags its left edge in the opposite direction and clamps both bounds', async () => {
    const { panel, separator } = await openSheet();
    mouse(separator, 'mousedown', panel.getBoundingClientRect().left);
    await expect.poll(() => document.body.style.cursor).toBe('col-resize');
    mouse(document, 'mousemove', 1280 - 460);
    await expect.poll(() => panel.getBoundingClientRect().width).toBe(460);
    mouse(document, 'mousemove', 0);
    await expect.poll(() => panel.getBoundingClientRect().width).toBe(600);
    mouse(document, 'mousemove', 1280);
    await expect.poll(() => panel.getBoundingClientRect().width).toBe(280);
    mouse(document, 'mouseup', 1280, 0);
    await expect.poll(() => document.body.style.cursor).toBe('');
  });

  it('moves the left edge with the keyboard while keeping focus on the divider', async () => {
    const { separator } = await openSheet();
    const initial = Number(separator.getAttribute('aria-valuenow'));
    separator.focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(separator).toHaveAttribute('aria-valuenow', String(initial + 20));
    await userEvent.keyboard('{ArrowRight}');
    expect(separator).toHaveAttribute('aria-valuenow', String(initial));
    expect(separator).toHaveFocus();
  });

  it('ignores a move after an unobserved release and restores prior body styles', async () => {
    const { panel, separator } = await openSheet();
    const width = panel.getBoundingClientRect().width;
    document.body.style.cursor = 'crosshair';
    document.body.style.userSelect = 'text';
    mouse(separator, 'mousedown', panel.getBoundingClientRect().left);
    await expect.poll(() => document.body.style.cursor).toBe('col-resize');
    mouse(document, 'mousemove', 1280 - 520, 0);
    await expect.poll(() => document.body.style.cursor).toBe('crosshair');
    expect(document.body.style.userSelect).toBe('text');
    // The ignored move would have resized the panel by hundreds of pixels;
    // the two reads may differ in the last subpixel (383.9999… against 384)
    // while the sheet settles, so they are compared to half a pixel.
    expect(panel.getBoundingClientRect().width).toBeCloseTo(width, 0);
  });
});
