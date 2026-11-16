import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { render, waitFor } from '@/tests/utils/render';

import { Markdown } from './markdown';
import { highlightCode } from './shiki';

import '../globals.css';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// REGRESSION: a grammar outside the eager list was imported through a bare
// `shiki/langs/<id>.mjs` specifier that the bundler left as written. A browser
// cannot resolve one, so CSV and every other such language showed as plain
// text, with a warning. Node resolves bare specifiers: only a browser shows it.
const CSV = ['planet,moons,rings', 'Earth,1,no', 'Saturn,146,yes'].join('\n');

describe('a grammar outside the eager list, in the browser', () => {
  it('highlights CSV once its grammar has loaded', async () => {
    const warn = vi.spyOn(console, 'warn');

    const result = await highlightCode(CSV, 'csv');

    expect(result?.language).toBe('csv');
    expect(result?.html).toContain('var(--code-token-');
    expect(warn).not.toHaveBeenCalled();
  }, 30_000);

  it('colours the csv fence of a Markdown reply', async () => {
    const { container } = render(
      <Markdown>{['```csv', CSV, '```'].join('\n')}</Markdown>,
    );

    await waitFor(
      () =>
        expect(
          container.querySelector('pre.shiki span[style*="var(--code-token-"]'),
        ).not.toBeNull(),
      { timeout: 30_000 },
    );
  }, 40_000);
});
