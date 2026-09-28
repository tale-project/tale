import '@testing-library/jest-dom/vitest';
import { highlightCode as shikiHighlight } from '@tale/ui/markdown/shiki';
import { ThemeContext } from '@tale/ui/theme';
import { cleanup, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { highlightCode } from '@/lib/utils/shiki';
import { inkContrast } from '@/tests/utils/paint';
import { render } from '@/tests/utils/render';
import { textRows } from '@/tests/utils/text-rows';

import { DocumentPreviewText } from './document-preview-text';

import '@/app/globals.css';

// An editor's rhythm: mono 12px type on a 20px row, in every path.
const ROW_PX = 20;
const FONT_PX = '12px';
// 2rem of numbers + 1rem of gap before the text column.
const GUTTER_PX = 48;

const preview = vi.hoisted(() => ({
  text: '',
  isLoading: false,
}));

vi.mock('../hooks/use-document-preview', () => ({
  // Small enough that one test can reach the plain path of a code file.
  TEXT_PREVIEW_HIGHLIGHT_MAX_CHARS: 400,
  useTextPreview: () => ({
    data: preview.isLoading
      ? undefined
      : { text: preview.text, truncated: false },
    isLoading: preview.isLoading,
    error: null,
  }),
}));

vi.mock('@/lib/utils/shiki', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils/shiki')>();
  return { ...actual, highlightCode: vi.fn(actual.highlightCode) };
});

const THEMES = {
  light: { theme: 'light', resolvedTheme: 'light', setTheme: () => {} },
  dark: { theme: 'dark', resolvedTheme: 'dark', setTheme: () => {} },
} as const;

// The first highlight loads Shiki's engine, both themes and every eager
// grammar: seconds on a busy runner, past `waitFor`'s budget. Pay it here,
// through the unmocked singleton, so every test starts warm.
beforeAll(async () => {
  await shikiHighlight('x', 'ts', 'min-light');
}, 30_000);

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
  preview.isLoading = false;
  vi.mocked(highlightCode).mockClear();
});

const SOURCE = [
  'export const answer = 42;',
  '',
  'function double(value: number) {',
  '  return value * 2;',
  '}',
].join('\n');

function renderPreview(
  fileName: string,
  theme: 'light' | 'dark' = 'light',
): HTMLElement {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  const frame = (children: ReactNode) => (
    <ThemeContext.Provider value={THEMES[theme]}>
      <div style={{ width: 640, height: 900, display: 'flex' }}>{children}</div>
    </ThemeContext.Provider>
  );
  return render(frame(<DocumentPreviewText url="u" fileName={fileName} />))
    .container;
}

async function highlightedRows(container: HTMLElement) {
  await waitFor(
    () =>
      expect(
        container.querySelector('.code-line-numbers .line'),
      ).not.toBeNull(),
    { timeout: 5_000 },
  );
  return [...container.querySelectorAll<HTMLElement>('.line')];
}

/** Height of a block divided by the rows its text occupies. */
function rowPitch(block: HTMLElement, rows: number) {
  return block.getBoundingClientRect().height / rows;
}

describe('DocumentPreviewText typography', () => {
  it('lays highlighted source out one 20px row per line, numbered', async () => {
    preview.text = SOURCE;
    const container = renderPreview('answer.ts');
    const rows = await highlightedRows(container);

    expect(rows).toHaveLength(5);
    const tops = rows.map((row) => row.getBoundingClientRect().top);
    for (const [i, row] of rows.entries()) {
      const style = getComputedStyle(row);
      expect(style.fontSize).toBe(FONT_PX);
      expect(style.lineHeight).toBe(`${ROW_PX}px`);
      // No empty line box between two rows: the next row starts where this
      // one ends, the blank source line included.
      if (i > 0) expect(tops[i] - tops[i - 1]).toBe(ROW_PX);
      expect(getComputedStyle(row, '::before').content).toBe('counter(line)');
    }
  });

  it('keeps the plain path of a code file in the same rhythm', async () => {
    // Over the (mocked) highlight cap: the source renders unhighlighted.
    const lines = Array.from({ length: 30 }, (_, i) => `const v${i} = ${i};`);
    preview.text = lines.join('\n');
    const container = renderPreview('long.ts');

    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(container.querySelector('.code-line-numbers')).toBeNull();
    const code = pre!.querySelector('code')!;
    expect(getComputedStyle(code).fontSize).toBe(FONT_PX);
    expect(rowPitch(pre!, lines.length)).toBe(ROW_PX);
    // The text column lines up with a highlighted file's text column.
    const left = pre!.getBoundingClientRect().left;
    for (const row of textRows(code)) expect(row.left - left).toBe(GUTTER_PX);
    expect(highlightCode).not.toHaveBeenCalled();
  });

  it('lays a code file out as its highlight will, before it lands', async () => {
    const long = `export const row = [${Array.from({ length: 60 }, (_, i) => i).join(', ')}];`;
    preview.text = [long, '', 'export default row;'].join('\n');
    let land!: () => void;
    const landed = new Promise<void>((resolve) => {
      land = resolve;
    });
    vi.mocked(highlightCode).mockImplementationOnce(async (...args) => {
      await landed;
      return shikiHighlight(...args);
    });
    const container = renderPreview('row.ts');

    // Pending: the plain text, unwrapped, in the numbered text column.
    expect(container.querySelector('.code-line-numbers')).toBeNull();
    const pre = container.querySelector('pre') as HTMLElement;
    const plain = textRows(pre.querySelector('code') as HTMLElement);
    expect(plain).toHaveLength(2); // the blank line draws no glyph
    const left = pre.getBoundingClientRect().left;
    for (const row of plain) expect(row.left - left).toBe(GUTTER_PX);
    expect(pre.scrollWidth).toBeGreaterThan(pre.clientWidth);

    // Landed: every glyph row where the plain text had it.
    land();
    const [first, , last] = await highlightedRows(container);
    expect(textRows(first)).toEqual([plain[0]]);
    expect(textRows(last)).toEqual([plain[1]]);
  });

  it('keeps a plain-text file in the same rhythm', () => {
    preview.text = 'first line\nsecond line\nthird line';
    const container = renderPreview('notes.txt');

    const pre = container.querySelector('pre') as HTMLElement;
    const code = pre.querySelector('code') as HTMLElement;
    expect(getComputedStyle(code).fontSize).toBe(FONT_PX);
    expect(getComputedStyle(code).fontFamily).toMatch(/mono/i);
    expect(rowPitch(pre, 3)).toBe(ROW_PX);
  });

  it('holds the loading skeleton to the same row height', () => {
    preview.isLoading = true;
    const container = renderPreview('answer.ts');

    const skeletonRows = container.querySelectorAll<HTMLElement>(
      '[aria-hidden="true"] > span.relative',
    );
    expect(skeletonRows.length).toBeGreaterThan(0);
    for (const row of skeletonRows) {
      expect(row.getBoundingClientRect().height).toBe(ROW_PX);
    }
  });

  it.each(['light', 'dark'] as const)(
    'numbers every row at AA contrast on the %s canvas',
    async (theme) => {
      preview.text = SOURCE;
      const container = renderPreview('answer.ts', theme);
      const rows = await highlightedRows(container);

      for (const row of rows) {
        expect(inkContrast(row, '::before')).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it.each([
    ['light', 'min-light'],
    ['dark', 'min-dark'],
  ] as const)(
    'asks the highlighter for the %s theme by its own name',
    async (theme, shikiTheme) => {
      preview.text = '{"answer": 42}';
      const container = renderPreview('answer.json', theme);
      await highlightedRows(container);

      expect(highlightCode).toHaveBeenCalledWith(
        preview.text,
        'json',
        shikiTheme,
      );
      expect(container.querySelector('pre.shiki')).toHaveClass(shikiTheme);
    },
  );
});
