import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { alphaOf } from '@/tests/utils/contrast';
import { render, screen, waitFor } from '@/tests/utils/render';

import { SearchCommand } from './search-command';
import type { SearchSource } from './types';

import '../../globals.css';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function Palette({ owner, source }: { owner: string; source: SearchSource }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open search
      </button>
      <button type="button">Outside search</button>
      <SearchCommand
        open={open}
        onOpenChange={setOpen}
        onSelect={() => {}}
        source={source}
        resetKey={owner}
        recentsStorageKey={`search-browser:${owner}`}
      />
    </>
  );
}

describe('search ownership in a real modal', () => {
  it.each(['organization', 'account', 'signed-out'])(
    'resets %s state without losing focus, trapping or the original opener',
    async (nextOwner) => {
      const source: SearchSource = (query) => ({
        status: 'ready',
        results: query
          ? [{ id: 'private', title: 'Private synthetic result' }]
          : [],
      });
      const { rerender } = render(<Palette owner="initial" source={source} />);
      const opener = screen.getByRole('button', { name: 'Open search' });
      await page.getByRole('button', { name: 'Open search' }).click();
      await page.getByRole('combobox').fill('private tenant query');
      await screen.findByRole('option', { name: /Private synthetic result/ });
      const dialog = screen.getByRole('dialog');
      rerender(<Palette owner={nextOwner} source={source} />);
      expect(screen.getByRole('dialog')).toBe(dialog);
      expect(screen.getByRole('combobox')).toHaveValue('');
      expect(
        screen.queryByRole('option', { name: /Private synthetic result/ }),
      ).not.toBeInTheDocument();
      await userEvent.keyboard('x');
      expect(screen.getByRole('combobox')).toHaveFocus();
      expect(screen.getByRole('combobox')).toHaveValue('x');
      for (let index = 0; index < 4; index++) {
        await userEvent.tab();
        expect(dialog.contains(document.activeElement)).toBe(true);
      }
      await userEvent.tab({ shift: true });
      expect(dialog.contains(document.activeElement)).toBe(true);
      await userEvent.keyboard('{Escape}');
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(opener).toHaveFocus();
      });
    },
  );

  it('cancels the previous owner debounce before the next owner starts typing', async () => {
    const requests = vi.fn();
    const makeSource =
      (owner: string): SearchSource =>
      (query, context) => {
        if (context.active && query) requests(owner, query);
        return { status: 'ready', results: [] };
      };
    const oldSource = makeSource('old');
    const newSource = makeSource('new');
    const { rerender } = render(<Palette owner="old" source={oldSource} />);
    await page.getByRole('button', { name: 'Open search' }).click();
    await page.getByRole('combobox').fill('private old query');
    rerender(<Palette owner="new" source={newSource} />);
    expect(screen.getByRole('combobox')).toHaveValue('');
    await page.getByRole('combobox').fill('new query');
    await waitFor(() =>
      expect(requests).toHaveBeenCalledWith('new', 'new query'),
    );
    expect(requests).not.toHaveBeenCalledWith('new', 'private old query');
    expect(window.localStorage.getItem('search-browser:new')).toBeNull();
  });

  it('deactivates the source as soon as an animated close begins', async () => {
    const contexts = vi.fn();
    const source: SearchSource = (query, context) => {
      contexts(query, context);
      return { status: 'ready', results: [] };
    };
    render(<Palette owner="same" source={source} />);
    await page.getByRole('button', { name: 'Open search' }).click();
    await page.getByRole('combobox').fill('active query');
    await waitFor(() =>
      expect(contexts).toHaveBeenCalledWith('active query', {
        active: true,
        open: true,
      }),
    );
    contexts.mockClear();
    await userEvent.keyboard('{Escape}');
    expect(contexts).toHaveBeenCalledWith('active query', {
      active: false,
      open: false,
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  it('preserves the query across a source change within the same owner', async () => {
    const source: SearchSource = () => ({ status: 'ready', results: [] });
    const nextSource: SearchSource = () => ({ status: 'ready', results: [] });
    const { rerender } = render(<Palette owner="same" source={source} />);
    await page.getByRole('button', { name: 'Open search' }).click();
    await page.getByRole('combobox').fill('same owner query');
    const input = screen.getByRole('combobox');
    rerender(<Palette owner="same" source={nextSource} />);
    expect(screen.getByRole('combobox')).toBe(input);
    expect(input).toHaveValue('same owner query');
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    await page.getByRole('button', { name: 'Open search' }).click();
    expect(screen.getByRole('combobox')).toHaveValue('');
  });
});

describe('the palette over the page', () => {
  // Every keystroke re-renders the results and often resizes the panel, and
  // a backdrop blur behind the overlay or the panel is re-rendered for that
  // frame: without GPU compositing that was 200–450 ms per keystroke
  // (#4348). The page is dimmed instead, and the panel is opaque, which is
  // also the surface reduced-transparency and contrast themes need.
  it('dims the page and paints an opaque panel, with no backdrop blur', async () => {
    const source: SearchSource = (query) => ({
      status: 'ready',
      results: query ? [{ id: 'result', title: 'Synthetic result' }] : [],
    });
    render(<Palette owner="same" source={source} />);
    await page.getByRole('button', { name: 'Open search' }).click();
    await page.getByRole('combobox').fill('synthetic');
    await screen.findByRole('option', { name: /Synthetic result/ });

    const panel = screen.getByRole('dialog');
    // What covers the page's corner while the palette is open: the overlay.
    const overlay = document.elementFromPoint(1, 1);
    if (overlay === null) throw new Error('Nothing covers the page');
    expect(panel.contains(overlay)).toBe(false);

    const blurred = [...document.body.querySelectorAll('*')]
      .filter((element) => getComputedStyle(element).backdropFilter !== 'none')
      .map((element) => element.getAttribute('class') ?? element.tagName);
    expect(blurred).toEqual([]);
    const panelAlpha = alphaOf(getComputedStyle(panel).backgroundColor);
    const dimAlpha = alphaOf(getComputedStyle(overlay).backgroundColor);
    expect(panelAlpha).toBe(1);
    // Dimmed: the page still shows through the overlay, darker.
    expect(dimAlpha).toBeGreaterThan(0);
    expect(dimAlpha).toBeLessThan(1);
  });
});
