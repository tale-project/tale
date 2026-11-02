import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useDocumentTitle } from './use-document-title';

/** What TanStack's `HeadContent` does when a page's title changes: a new
 * `<title>` element replaces the old one. */
function headPutsUp(text: string) {
  document.head.querySelector('title')?.remove();
  const title = document.createElement('title');
  title.textContent = text;
  document.head.append(title);
}

beforeEach(() => {
  headPutsUp('Sessions - Session Manager');
});

describe('useDocumentTitle', () => {
  it('names the tab while mounted and gives the page its title back', () => {
    const { unmount } = renderHook(() =>
      useDocumentTitle('Shop - Session Manager'),
    );
    expect(document.title).toBe('Shop - Session Manager');

    unmount();
    expect(document.title).toBe('Sessions - Session Manager');
  });

  it('follows a new name', () => {
    const { rerender, unmount } = renderHook(
      ({ title }) => useDocumentTitle(title),
      { initialProps: { title: 'Shop - Session Manager' } },
    );
    rerender({ title: 'Bank - Session Manager' });
    expect(document.title).toBe('Bank - Session Manager');

    unmount();
    expect(document.title).toBe('Sessions - Session Manager');
  });

  it('keeps the name over a title the head puts up, and hands that one back', async () => {
    const { unmount } = renderHook(() =>
      useDocumentTitle('Shop - Session Manager'),
    );
    // The language changes and the head words the page's title anew.
    headPutsUp('Sitzungen - Session Manager');
    await waitFor(() => expect(document.title).toBe('Shop - Session Manager'));

    unmount();
    expect(document.title).toBe('Sitzungen - Session Manager');
  });

  it('leaves the next page its title when a navigation unmounts this one', () => {
    const { unmount } = renderHook(() =>
      useDocumentTitle('Shop - Session Manager'),
    );
    // The head swaps in the next page's title in the same commit that
    // unmounts this page, before any observer has run.
    headPutsUp('Proxies - Session Manager');
    unmount();
    expect(document.title).toBe('Proxies - Session Manager');
  });

  it('shows the latest name and returns to the earlier one when it leaves', () => {
    const session = renderHook(() =>
      useDocumentTitle('Shop - Session Manager'),
    );
    const other = renderHook(() => useDocumentTitle('Bank - Session Manager'));
    expect(document.title).toBe('Bank - Session Manager');

    other.unmount();
    expect(document.title).toBe('Shop - Session Manager');
    session.unmount();
    expect(document.title).toBe('Sessions - Session Manager');
  });

  it('keeps a notice about the app over a page name that arrives after it', () => {
    const offline = renderHook(() =>
      useDocumentTitle('Reconnecting - Session Manager', { notice: true }),
    );
    const session = renderHook(() =>
      useDocumentTitle('Shop - Session Manager'),
    );
    expect(document.title).toBe('Reconnecting - Session Manager');

    offline.unmount();
    expect(document.title).toBe('Shop - Session Manager');
    session.unmount();
  });

  it('leaves the title alone without a name', () => {
    renderHook(() => useDocumentTitle(undefined));
    expect(document.title).toBe('Sessions - Session Manager');
  });
});
