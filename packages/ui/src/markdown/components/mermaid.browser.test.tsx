import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { alphaOf } from '@/tests/utils/contrast';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { Mermaid } from './mermaid';

import '../../globals.css';

// Small enough to fit the stage at 100 %, so the zoom readout is exact.
const mermaidApi = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async () => ({
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60" width="100%"><rect width="120" height="60" fill="currentColor"/></svg>',
  })),
}));

vi.mock('mermaid', () => ({ default: mermaidApi }));

afterEach(() => {
  cleanup();
});

async function openViewer(): Promise<HTMLElement> {
  render(
    <>
      <p>Page text behind the viewer</p>
      <Mermaid chart={'flowchart LR\nA --> B'} />
    </>,
  );
  const diagram = screen.getByRole('img', { name: 'Mermaid diagram' });
  await waitFor(() => expect(diagram.querySelector('svg')).not.toBeNull());
  await page.getByRole('button', { name: 'Open fullscreen' }).click();
  return screen.getByRole('dialog', { name: 'Mermaid diagram (fullscreen)' });
}

describe('the fullscreen viewer over the page', () => {
  // Every zoom or pan repaints this viewport-wide layer, and a backdrop blur
  // behind it is re-rendered for that frame: without GPU compositing a zoom
  // click took a median 104 ms with the blur and 32 ms without (#5226). The
  // page is covered by an opaque surface instead. The toolbar keeps its own
  // small blur, which measured within budget.
  it('covers the page with an opaque surface, with no backdrop blur', async () => {
    const viewer = await openViewer();

    expect(getComputedStyle(viewer).backdropFilter).toBe('none');
    const toolbar = screen.getByRole('button', {
      name: 'Zoom in',
    }).parentElement;
    const blurred = [...document.body.querySelectorAll('*')]
      .filter(
        (element) =>
          element !== toolbar &&
          getComputedStyle(element).backdropFilter !== 'none',
      )
      .map((element) => element.getAttribute('class') ?? element.tagName);
    expect(blurred).toEqual([]);

    // Apart from the page: opaque, and what covers it corner to corner.
    expect(alphaOf(getComputedStyle(viewer).backgroundColor)).toBe(1);
    for (const { x, y } of [
      { x: 1, y: 1 },
      { x: window.innerWidth - 2, y: window.innerHeight - 2 },
    ]) {
      const covering = document.elementFromPoint(x, y);
      expect(covering !== null && viewer.contains(covering)).toBe(true);
    }
  });

  it('keeps its zoom controls, scroll lock and Escape', async () => {
    const viewer = await openViewer();
    expect(document.body.style.overflow).toBe('hidden');

    const readout = within(viewer).getByText(/^\d+%$/);
    await waitFor(() => expect(readout).toHaveTextContent('100%'));
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await waitFor(() => expect(readout).toHaveTextContent('125%'));

    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(document.body.style.overflow).toBe('');
  });
});
