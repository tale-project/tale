import '@testing-library/jest-dom/vitest';
import { ThemeContext } from '@tale/ui/theme';
import { cleanup, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { highlightCode } from '@/lib/utils/shiki';
import { render, screen } from '@/tests/utils/render';

import { SkillAssetViewer } from './skill-asset-viewer';

import '@/app/globals.css';

// An editor's rhythm: mono 12px type on a 20px row, in every path.
const ROW_PX = 20;
const FONT_PX = '12px';
// 2rem of numbers + 1rem of gap before the text column.
const GUTTER_PX = 48;

const asset = vi.hoisted(() => ({ text: '' }));

vi.mock('../hooks/queries', () => ({
  useSkillAsset: () => ({
    data: {
      contentBase64: btoa(
        String.fromCharCode(...new TextEncoder().encode(asset.text)),
      ),
    },
    isPending: false,
    isError: false,
    isSuccess: true,
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

afterEach(() => {
  cleanup();
  vi.mocked(highlightCode).mockClear();
});

const LONG_LINE = `const schema = { ${Array.from(
  { length: 24 },
  (_, i) => `field${i}: "string"`,
).join(', ')} };`;
const SOURCE = [LONG_LINE, '', 'export default schema;'].join('\n');

function renderViewer(assetPath: string, theme: 'light' | 'dark' = 'light') {
  return render(
    <ThemeContext.Provider value={THEMES[theme]}>
      <div style={{ width: 480, height: 900 }}>
        <SkillAssetViewer
          organizationId="org1"
          skillSlug="demo"
          assetPath={assetPath}
        />
      </div>
    </ThemeContext.Provider>,
  );
}

async function highlightedRows(container: HTMLElement) {
  await waitFor(() =>
    expect(container.querySelector('.code-line-numbers .line')).not.toBeNull(),
  );
  return [...container.querySelectorAll<HTMLElement>('.line')];
}

/** The rendered text rows of `el`: each row's top and its leftmost glyph. */
function textRows(el: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const rows = new Map<number, number>();
  for (const rect of range.getClientRects()) {
    if (rect.width === 0) continue;
    const top = Math.round(rect.top);
    rows.set(top, Math.min(rows.get(top) ?? Infinity, rect.left));
  }
  return [...rows.entries()]
    .sort(([a], [b]) => a - b)
    .map(([top, left]) => ({ top, left }));
}

describe('SkillAssetViewer typography', () => {
  it('wraps a long row under its own text, never under the numbers', async () => {
    asset.text = SOURCE;
    const { container } = renderViewer('schemas/demo.ts');
    const [long, blank, last] = await highlightedRows(container);

    const wrapped = textRows(long);
    expect(wrapped.length).toBeGreaterThan(1);
    const lineLeft = long.getBoundingClientRect().left;
    for (const row of wrapped) {
      expect(row.left - lineLeft).toBe(GUTTER_PX);
    }
    // Rows follow one another without an empty line box between them.
    expect(long.getBoundingClientRect().height).toBe(wrapped.length * ROW_PX);
    expect(blank.getBoundingClientRect().top).toBe(
      long.getBoundingClientRect().bottom,
    );
    expect(blank.getBoundingClientRect().height).toBe(ROW_PX);
    expect(last.getBoundingClientRect().top).toBe(
      blank.getBoundingClientRect().bottom,
    );
    expect(getComputedStyle(long).fontSize).toBe(FONT_PX);
  });

  it('keeps one 20px row per line with wrap off, scrolling instead', async () => {
    asset.text = SOURCE;
    const { container, user } = renderViewer('schemas/demo.json');
    await highlightedRows(container);

    const toggle = screen.getByRole('button', { name: 'Toggle line wrap' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    const rows = await highlightedRows(container);
    for (const [i, row] of rows.entries()) {
      expect(row.getBoundingClientRect().height).toBe(ROW_PX);
      if (i > 0) {
        expect(row.getBoundingClientRect().top).toBe(
          rows[i - 1].getBoundingClientRect().bottom,
        );
      }
      const text = textRows(row);
      if (text.length === 0) continue; // the blank source line
      expect(text).toHaveLength(1);
      expect(text[0].left - row.getBoundingClientRect().left).toBe(GUTTER_PX);
    }
    const pre = container.querySelector('pre') as HTMLElement;
    expect(pre.scrollWidth).toBeGreaterThan(pre.clientWidth);
  });

  it('keeps a plain-text asset in the same rhythm', () => {
    asset.text = 'first line\nsecond line\nthird line';
    const { container } = renderViewer('notes.txt');

    const pre = container.querySelector('pre') as HTMLElement;
    const code = pre.querySelector('code') as HTMLElement;
    expect(getComputedStyle(code).fontSize).toBe(FONT_PX);
    expect(getComputedStyle(code).fontFamily).toMatch(/mono/i);
    const padding =
      parseFloat(getComputedStyle(pre).paddingTop) +
      parseFloat(getComputedStyle(pre).paddingBottom);
    expect(pre.getBoundingClientRect().height - padding).toBe(3 * ROW_PX);
    expect(highlightCode).not.toHaveBeenCalled();
  });

  it.each([
    ['light', 'min-light'],
    ['dark', 'min-dark'],
  ] as const)(
    'asks the highlighter for the %s theme by its own name',
    async (theme, shikiTheme) => {
      asset.text = 'name: demo';
      const { container } = renderViewer('config.yaml', theme);
      await highlightedRows(container);

      expect(highlightCode).toHaveBeenCalledWith(
        asset.text,
        'yaml',
        shikiTheme,
      );
      expect(container.querySelector('pre.shiki')).toHaveClass(shikiTheme);
    },
  );
});
