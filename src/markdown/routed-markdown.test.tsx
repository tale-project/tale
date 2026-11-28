import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Card } from './components/cards';
import { isFileHref } from './is-file-href';
import { RoutedMarkdown } from './routed-markdown';

describe('isFileHref', () => {
  it.each([
    ['/llms.txt', true],
    ['/platform/chat/basics.md', true],
    ['/images/shot.webp?v=2', true],
    ['./report.pdf#page=2', true],
    ['/platform/chat/basics', false],
    ['/platform/chat/basics#setup', false],
    ['/', false],
    [undefined, false],
  ])('%s names a file: %s', (href, expected) => {
    expect(isFileHref(href)).toBe(expected);
  });
});

// Rendered without a RouterProvider: a router `<Link>` cannot render there,
// so a file link that renders at all went around the router.
describe('file links reach the server, not the client router', () => {
  it('RoutedMarkdown renders a file link as a plain anchor', () => {
    render(
      <RoutedMarkdown>
        {'[the index](/llms.txt) and [the export](/platform/chat/basics.md)'}
      </RoutedMarkdown>,
    );
    expect(screen.getByRole('link', { name: 'the index' })).toHaveAttribute(
      'href',
      '/llms.txt',
    );
    expect(screen.getByRole('link', { name: 'the export' })).toHaveAttribute(
      'href',
      '/platform/chat/basics.md',
    );
  });

  it('Card renders a file href as a plain anchor', () => {
    render(<Card title="Index" href="/llms-full.txt" />);
    expect(screen.getByRole('link', { name: /Index/ })).toHaveAttribute(
      'href',
      '/llms-full.txt',
    );
  });

  it('keeps an external file link opening in a new tab', () => {
    render(<Card title="Report" href="https://example.com/report.pdf" />);
    expect(screen.getByRole('link', { name: /Report/ })).toHaveAttribute(
      'target',
      '_blank',
    );
  });

  it('still routes a page link through the router', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(
        <RoutedMarkdown>{'[a page](/platform/chat/basics)'}</RoutedMarkdown>,
      ),
    ).toThrow();
    quiet.mockRestore();
  });
});
