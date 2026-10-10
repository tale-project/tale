import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cdp, page, userEvent } from 'vitest/browser';

import { ratioAgainst } from '@/tests/utils/contrast';
import { render, screen, waitFor } from '@/tests/utils/render';

import { JsonViewer } from '../json-viewer';
import type { ValueMark, ValueMarkKind } from './model';
import { ValueTree } from './value-tree';

import '../../../globals.css';

// Real-Chromium coverage for what jsdom cannot judge: the WAI-ARIA tree keys
// with real key events and focus, a windowed tree of thousands of rows that
// keeps its focus, the colours of values and marks against every surface in
// both themes, and long keys and values wrapping at a phone's width.

afterEach(async () => {
  cleanup();
  document.documentElement.classList.remove('dark');
  vi.restoreAllMocks();
});

const ISSUE = {
  title: 'Fix login on Safari',
  number: 1234,
  open: true,
  closedAt: null,
  labels: ['bug', 'ui', 'docs'],
  author: { login: 'ada', id: 7 },
  body: 'Steps to reproduce: '.repeat(30),
};

function focused(): string | null {
  return document.activeElement?.getAttribute('aria-label') ?? null;
}

describe('ValueTree keyboard', () => {
  it('walks the tree with the WAI-ARIA keys and one tab stop', async () => {
    render(
      <>
        <button type="button">Before</button>
        <ValueTree value={ISSUE} aria-label="Issue" />
        <button type="button">After</button>
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Before' }));
    await userEvent.keyboard('{Tab}');
    expect(focused()).toBe('title, "Fix login on Safari"');
    await userEvent.keyboard('{Tab}');
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'After' }),
    );
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    expect(focused()).toBe('title, "Fix login on Safari"');

    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(focused()).toBe('labels, a list of 3 items');
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard('{ArrowRight}');
    expect(focused()).toBe('0, "bug"');
    await userEvent.keyboard('{ArrowLeft}');
    expect(focused()).toBe('labels, a list of 3 items');
    await userEvent.keyboard('{ArrowLeft}');
    expect(document.activeElement).toHaveAttribute('aria-expanded', 'false');
    await userEvent.keyboard('{End}');
    expect(focused()).toMatch(/^body, "Steps to reproduce/);
    await userEvent.keyboard('{Home}');
    expect(focused()).toBe('title, "Fix login on Safari"');
    await userEvent.keyboard('*');
    expect(
      screen
        .getAllByRole('treeitem')
        .filter((row) => row.getAttribute('aria-expanded') === 'true'),
    ).toHaveLength(2);
  });

  it('jumps to a key as it is typed', async () => {
    render(<ValueTree value={ISSUE} aria-label="Issue" />);
    await userEvent.click(screen.getByRole('treeitem', { name: /^title/ }));
    await userEvent.keyboard('au');
    expect(focused()).toBe('author, an object with 2 fields');
    await new Promise((resolve) => setTimeout(resolve, 600));
    await userEvent.keyboard('c');
    expect(focused()).toBe('closedAt, empty');
  });

  it('copies the value and the path of the focused row, and says so', async () => {
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined);
    render(
      <ValueTree value={ISSUE} aria-label="Issue" defaultExpandDepth={2} />,
    );
    await userEvent.click(screen.getByRole('treeitem', { name: 'id, 7' }));
    await userEvent.keyboard('{Control>}c{/Control}');
    expect(writeText).toHaveBeenLastCalledWith('7');
    await userEvent.keyboard('{Control>}{Shift>}c{/Shift}{/Control}');
    expect(writeText).toHaveBeenLastCalledWith('author.id');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Copied'),
    );
  });

  it('keeps its focus while a windowed tree of 2,000 rows moves', async () => {
    await page.viewport(1280, 800);
    const many = Array.from({ length: 2000 }, (_, index) => ({ id: index }));
    render(
      <ValueTree
        value={many}
        aria-label="Items"
        pageSize={5000}
        density="compact"
      />,
    );
    const tree = screen.getByRole('tree', { name: 'Items' });
    // Windowed: far fewer rows in the page than in the value.
    expect(screen.getAllByRole('treeitem').length).toBeLessThan(200);
    expect(tree.getBoundingClientRect().height).toBeLessThanOrEqual(512);
    await userEvent.click(screen.getAllByRole('treeitem')[0]);
    await userEvent.keyboard('{End}');
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute('aria-posinset', '2000'),
    );
    expect(focused()).toBe('1999, an object with 1 field');
    await userEvent.keyboard('{ArrowUp}');
    expect(document.activeElement).toHaveAttribute('aria-posinset', '1999');
    await userEvent.keyboard('{Home}');
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute('aria-posinset', '1'),
    );
    expect(screen.getAllByRole('treeitem').length).toBeLessThan(200);
  });

  it('draws a 10,000-value list a page at a time, quickly', () => {
    const big = Array.from({ length: 10_000 }, (_, index) => ({
      id: index,
      name: `Item ${index}`,
    }));
    const start = performance.now();
    render(<ValueTree value={big} aria-label="Big" />);
    const elapsed = performance.now() - start;
    expect(screen.getAllByRole('treeitem')).toHaveLength(51);
    // Generous bound against a slow CI machine; the budget is 30 ms.
    expect(elapsed).toBeLessThan(500);
  });
});

describe.each(['light', 'dark'])('ValueTree colours (%s)', (theme) => {
  it.each(['bg-background', 'bg-card', 'bg-bg-elevated'])(
    'keeps values, marks and chips at AA on %s',
    async (surface) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      const { container } = render(
        <div className={`${surface} p-4`}>
          <ValueTree
            value={{
              title: 'Fix',
              amount: 300,
              open: true,
              closedAt: null,
              score: 7,
              kind: 'text',
              gone: 1,
              token: null,
              body: 'Lorem ipsum',
              nested: { a: 1 },
            }}
            aria-label="Output"
            defaultExpandDepth={2}
            redacted={['/token']}
            elided={[{ pointer: '/body', kind: 'string', dropped: 120 }]}
            marks={
              new Map<string, ValueMarkKind | ValueMark>([
                ['/amount', { kind: 'changed', before: 250 }],
                ['/score', 'added'],
                ['/kind', { kind: 'type-changed', before: 1 }],
                ['/gone', 'removed'],
                ['/nested', 'focus'],
                ['/nested/b', 'missing'],
              ])
            }
          />
        </div>,
      );
      const result = await axe.run(container, {
        runOnly: [
          'color-contrast',
          'aria-required-children',
          'aria-required-parent',
          'aria-allowed-attr',
          'aria-hidden-focus',
          'nested-interactive',
        ],
      });
      expect(result.violations).toEqual([]);
      expect(result.passes.some((rule) => rule.id === 'color-contrast')).toBe(
        true,
      );
      // The gutter glyphs are what tell a mark apart without colour: 3:1.
      for (const name of [
        /^Changed from 250/,
        /^Added/,
        /^Type changed/,
        /^Removed/,
      ]) {
        const row = screen.getByRole('treeitem', { name });
        const glyph = row.querySelector('svg');
        expect(glyph).not.toBeNull();
        if (glyph === null) continue;
        expect(
          ratioAgainst(
            glyph.parentElement ?? row,
            getComputedStyle(glyph).color,
          ),
        ).toBeGreaterThanOrEqual(3);
      }
    },
  );
});

describe('ValueTree at a phone width', () => {
  it('wraps long keys and values instead of scrolling sideways', async () => {
    await page.viewport(375, 700);
    render(
      <div className="w-[343px]" data-testid="frame">
        <ValueTree
          value={{
            [`a_very_long_key_${'x'.repeat(60)}`]: 'y'.repeat(200),
            url: `https://example.com/${'path/'.repeat(30)}`,
          }}
          aria-label="Output"
        />
      </div>,
    );
    const tree = screen.getByRole('tree');
    expect(tree.scrollWidth).toBeLessThanOrEqual(tree.clientWidth);
    const frame = screen.getByTestId('frame');
    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
  });
});

describe('ValueTree under reduced motion', () => {
  afterEach(async () => {
    await cdp().send('Emulation.setEmulatedMedia', { features: [] });
  });

  it('opens a container without turning its chevron', async () => {
    await cdp().send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    render(<ValueTree value={ISSUE} aria-label="Issue" />);
    const row = screen.getByRole('treeitem', { name: /^labels/ });
    const chevron = row.querySelector('[data-chevron] svg');
    expect(chevron).not.toBeNull();
    if (chevron === null) return;
    expect(getComputedStyle(chevron).transitionProperty).toBe('none');
  });
});

describe('JsonViewer on the value tree', () => {
  it('renders its old props as a tree, at AA, in both themes', async () => {
    for (const theme of ['light', 'dark']) {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      const { container, unmount } = render(
        <JsonViewer
          data={{ runId: 'r1', input: { amount: 250, notify: false } }}
          collapsed={1}
          enableClipboard
          className="border-border rounded-lg border"
        />,
      );
      expect(screen.getAllByRole('treeitem')).toHaveLength(2);
      const result = await axe.run(container, {
        runOnly: ['color-contrast', 'button-name', 'aria-required-children'],
      });
      expect(result.violations).toEqual([]);
      unmount();
    }
  });
});
