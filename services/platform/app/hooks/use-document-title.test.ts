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
  headPutsUp('Chat - Acme');
});

describe('useDocumentTitle', () => {
  it('names the tab while mounted and gives the page its title back', () => {
    const { unmount } = renderHook(() =>
      useDocumentTitle('Launch plan - Acme'),
    );
    expect(document.title).toBe('Launch plan - Acme');

    unmount();
    expect(document.title).toBe('Chat - Acme');
  });

  it('follows a new name', () => {
    const { rerender, unmount } = renderHook(
      ({ title }) => useDocumentTitle(title),
      { initialProps: { title: 'Launch plan - Acme' } },
    );
    rerender({ title: 'Launch recap - Acme' });
    expect(document.title).toBe('Launch recap - Acme');

    unmount();
    expect(document.title).toBe('Chat - Acme');
  });

  it('keeps the name over a title the head puts up, and hands that one back', async () => {
    const { unmount } = renderHook(() =>
      useDocumentTitle('Launch plan - Tale'),
    );
    // The org name arrives and the head re-renders the page's title.
    headPutsUp('Chat - Acme Studio');
    await waitFor(() => expect(document.title).toBe('Launch plan - Tale'));

    unmount();
    expect(document.title).toBe('Chat - Acme Studio');
  });

  it('leaves the next page its title when a navigation unmounts this one', () => {
    const { unmount } = renderHook(() =>
      useDocumentTitle('Launch plan - Acme'),
    );
    // The head swaps in the next page's title in the same commit that
    // unmounts this page — before any observer has run.
    headPutsUp('Settings - Acme');
    unmount();
    expect(document.title).toBe('Settings - Acme');
  });

  it('shows the latest name and returns to the earlier one when it leaves', () => {
    const chat = renderHook(() => useDocumentTitle('Launch plan - Acme'));
    const offline = renderHook(() => useDocumentTitle('Offline — Acme'));
    expect(document.title).toBe('Offline — Acme');

    offline.unmount();
    expect(document.title).toBe('Launch plan - Acme');
    chat.unmount();
    expect(document.title).toBe('Chat - Acme');
  });

  it('keeps a notice about the app over a page name that arrives after it', () => {
    const offline = renderHook(() =>
      useDocumentTitle('Offline — Acme', { notice: true }),
    );
    const chat = renderHook(() => useDocumentTitle('Launch plan - Acme'));
    expect(document.title).toBe('Offline — Acme');

    offline.unmount();
    expect(document.title).toBe('Launch plan - Acme');
    chat.unmount();
  });

  it('leaves the title alone without a name', () => {
    renderHook(() => useDocumentTitle(undefined));
    expect(document.title).toBe('Chat - Acme');
  });
});
