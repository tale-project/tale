import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { MarkdownFilePreview, isMarkdownFile } from './markdown-file-preview';

function mockFetchText(text: string) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    headers: { get: () => String(text.length) },
    text: async () => text,
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const FILE = { name: 'summary.md', url: 'https://example.test/summary.md' };

describe('isMarkdownFile', () => {
  it('matches markdown extensions case-insensitively', () => {
    expect(isMarkdownFile('summary.md')).toBe(true);
    expect(isMarkdownFile('NOTES.MD')).toBe(true);
    expect(isMarkdownFile('readme.markdown')).toBe(true);
    expect(isMarkdownFile('page.mdx')).toBe(true);
  });

  it('rejects non-markdown files', () => {
    expect(isMarkdownFile('report.pdf')).toBe(false);
    expect(isMarkdownFile('data.json')).toBe(false);
    expect(isMarkdownFile('archive.md.zip')).toBe(false);
  });
});

describe('MarkdownFilePreview', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a trigger labelled with the file name and no dialog until opened', () => {
    mockFetchText('# Hello');
    render(<MarkdownFilePreview file={FILE} />);
    expect(
      screen.getByRole('button', { name: 'Open summary.md' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('fetches and renders the markdown as formatted HTML when opened', async () => {
    const fetchMock = mockFetchText('# Big Heading\n\nA plain paragraph.');
    const { user } = render(<MarkdownFilePreview file={FILE} />);

    await user.click(screen.getByRole('button', { name: 'Open summary.md' }));

    // The heading renders as an actual heading element, not raw markdown text.
    const heading = await screen.findByRole('heading', { name: 'Big Heading' });
    expect(heading).toBeInTheDocument();
    expect(screen.getByText('A plain paragraph.')).toBeInTheDocument();
    // The raw markdown source is NOT shown verbatim.
    expect(screen.queryByText('# Big Heading')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(FILE.url);
  });

  it('falls back to an open-in-new-tab link when the fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 404,
        headers: { get: () => null },
      })),
    );
    const { user } = render(<MarkdownFilePreview file={FILE} />);

    await user.click(screen.getByRole('button', { name: 'Open summary.md' }));

    const fallback = await screen.findByRole('link', {
      name: 'Open in a new tab',
    });
    expect(fallback).toHaveAttribute('href', FILE.url);
  });

  it('passes axe for the closed trigger', async () => {
    mockFetchText('# Hello');
    const { container } = render(<MarkdownFilePreview file={FILE} />);
    await checkAccessibility(container);
  });
});
