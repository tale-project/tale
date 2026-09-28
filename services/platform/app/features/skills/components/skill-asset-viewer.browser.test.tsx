import '@testing-library/jest-dom/vitest';
import { highlightCode as shikiHighlight } from '@tale/ui/markdown/shiki';
import { ThemeContext } from '@tale/ui/theme';
import { cleanup, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { highlightCode } from '@/lib/utils/shiki';
import { inkContrast } from '@/tests/utils/paint';
import { render, screen } from '@/tests/utils/render';
import { textRows } from '@/tests/utils/text-rows';

import { SkillAssetViewer } from './skill-asset-viewer';

import '@/app/globals.css';

// An editor's rhythm: mono 12px type on a 20px row, in every path.
const ROW_PX = 20;
const FONT_PX = '12px';
// 2rem of numbers + 1rem of gap before the text column.
const GUTTER_PX = 48;
// The `pre`'s own p-4 before the numbers.
const PRE_PAD_PX = 16;

const asset = vi.hoisted(() => ({ text: '', pending: false }));

vi.mock('../hooks/queries', () => ({
  useSkillAsset: () =>
    asset.pending
      ? {
          data: undefined,
          isPending: true,
          isError: false,
          isSuccess: false,
          error: null,
        }
      : {
          data: { contentBase64: toBase64(asset.text) },
          isPending: false,
          isError: false,
          isSuccess: true,
          error: null,
        },
}));

function toBase64(text: string) {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

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
  asset.pending = false;
  vi.mocked(highlightCode).mockClear();
});

const LONG_LINE = `const schema = { ${Array.from(
  { length: 24 },
  (_, i) => `field${i}: "string"`,
).join(', ')} };`;
const SOURCE = [LONG_LINE, '', 'export default schema;'].join('\n');

function renderViewer(assetPath: string, theme: 'light' | 'dark' = 'light') {
  document.documentElement.classList.toggle('dark', theme === 'dark');
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
  await waitFor(
    () =>
      expect(
        container.querySelector('.code-line-numbers .line'),
      ).not.toBeNull(),
    { timeout: 5_000 },
  );
  return [...container.querySelectorAll<HTMLElement>('.line')];
}

/** Holds the next highlight back until the returned `land` is called. */
function holdHighlight() {
  let land!: () => void;
  const landed = new Promise<void>((resolve) => {
    land = resolve;
  });
  vi.mocked(highlightCode).mockImplementationOnce(async (...args) => {
    await landed;
    return shikiHighlight(...args);
  });
  return land;
}

/** Each glyph row's left edge, from the left of `origin`. */
function columns(el: HTMLElement, origin: HTMLElement) {
  const left = origin.getBoundingClientRect().left;
  return textRows(el).map((row) => row.left - left);
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

  it('starts a code asset in its highlighted column, before it lands', async () => {
    asset.text = SOURCE;
    const land = holdHighlight();
    const { container } = renderViewer('schemas/demo.ts');

    // Pending: the plain text, wrapped, every row in the text column.
    expect(container.querySelector('.code-line-numbers')).toBeNull();
    const pre = container.querySelector('pre') as HTMLElement;
    const plain = textRows(pre.querySelector('code') as HTMLElement);
    expect(plain.length).toBeGreaterThan(2);
    for (const left of columns(pre.querySelector('code')!, pre)) {
      expect(left).toBe(PRE_PAD_PX + GUTTER_PX);
    }

    // Landed: every glyph row where the plain text had it.
    land();
    const [long, , last] = await highlightedRows(container);
    expect([...textRows(long), ...textRows(last)]).toEqual(plain);
  });

  it('widens the gutter for a five-digit line count, one column throughout', async () => {
    const lines = Array.from({ length: 10_000 }, () => 'a;');
    asset.text = [...lines, LONG_LINE].join('\n');
    const land = holdHighlight();
    const { container } = renderViewer('schemas/many.ts');

    const plainPre = container.querySelector('pre') as HTMLElement;
    const [plainColumn] = columns(plainPre.querySelector('code')!, plainPre);
    // Four digits fill the 2rem column; the fifth widens it.
    expect(plainColumn).toBeGreaterThan(PRE_PAD_PX + GUTTER_PX);

    land();
    const rows = await highlightedRows(container);
    expect(rows).toHaveLength(10_001);
    const pre = container.querySelector('pre') as HTMLElement;
    const wrapped = columns(rows[10_000], pre);
    expect(wrapped.length).toBeGreaterThan(1);
    for (const left of [
      ...columns(rows[0], pre),
      ...columns(rows[9_998], pre),
      ...columns(rows[9_999], pre),
      ...wrapped,
    ]) {
      // A fractional column: glyphs snap to 1/64 px either side of it.
      expect(left).toBeCloseTo(plainColumn, 1);
    }
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

  it("sets a markdown asset's code fence in the same rhythm", async () => {
    asset.text = [
      '# Demo',
      '',
      '```ts',
      'const a = 1;',
      'const b = 2;',
      'export { a, b };',
      '```',
    ].join('\n');
    const { container } = renderViewer('README.md');

    // Formatted markdown, not numbered source.
    expect(container.querySelector('h1')).toHaveTextContent('Demo');
    expect(container.querySelector('.code-line-numbers')).toBeNull();
    const fenceRows = () => {
      const code = container.querySelector('pre code') as HTMLElement;
      expect(getComputedStyle(code).fontSize).toBe(FONT_PX);
      const rows = textRows(code);
      expect(rows).toHaveLength(3);
      return rows.slice(1).map((row, i) => row.top - rows[i].top);
    };
    // The plain fence while its (debounced) highlight is pending, then the
    // highlighted one.
    expect(fenceRows()).toEqual([ROW_PX, ROW_PX]);
    await waitFor(
      () => expect(container.querySelector('pre code .line')).not.toBeNull(),
      { timeout: 5_000 },
    );
    expect(fenceRows()).toEqual([ROW_PX, ROW_PX]);
  });

  it('holds the loading skeleton to the same row height', () => {
    asset.pending = true;
    const { container } = renderViewer('schemas/demo.ts');

    const skeletonRows = container.querySelectorAll<HTMLElement>(
      '[aria-hidden="true"] > span.relative',
    );
    expect(skeletonRows.length).toBeGreaterThan(0);
    for (const row of skeletonRows) {
      expect(getComputedStyle(row).fontSize).toBe(FONT_PX);
      expect(row.getBoundingClientRect().height).toBe(ROW_PX);
    }
  });

  it.each(['light', 'dark'] as const)(
    'numbers every row at AA contrast in the %s theme',
    async (theme) => {
      asset.text = SOURCE;
      const { container } = renderViewer('schemas/demo.ts', theme);
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
