import { AppShell } from '@tale/ui/app-shell';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';

import { createChatSearchSource } from './chat-search-source';

const backend = vi.hoisted(() => ({
  status: 'ready' as 'ready' | 'loading' | 'unavailable',
  hits: [] as unknown[],
  retrySearch: vi.fn((_query: string) => Promise.resolve()),
}));

vi.mock('./chat-backend', () => ({
  useChatQuery: () =>
    backend.status === 'ready'
      ? { status: 'ready', data: backend.hits }
      : { status: backend.status },
  useChatSearchRetry: () => backend.retrySearch,
}));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <AppShell i18n={i18n} locale={{ mode: 'client' }}>
      {children}
    </AppShell>
  );
}

const OPEN = { active: true, open: true };

beforeEach(() => {
  backend.status = 'ready';
  backend.hits = [];
  backend.retrySearch.mockReset();
  backend.retrySearch.mockImplementation(() => Promise.resolve());
});

describe('the palette chat source', () => {
  it('reads the matching reply as its prose, not its markdown source', () => {
    backend.hits = [
      {
        threadId: 'th-1',
        title: 'Draft a launch checklist',
        snippet:
          'Here is a **launch checklist**:\n1. **Freeze the content** — call `file_write`\n- Ship the [redirect map](https://example.com)',
        updatedAt: 1,
      },
    ];
    const source = createChatSearchSource({ organizationId: 'org-1' });
    const { result } = renderHook(() => source('launch', OPEN), { wrapper });

    expect(result.current.results[0]).toMatchObject({
      id: 'th-1',
      title: 'Draft a launch checklist',
      body: 'Here is a launch checklist: 1. Freeze the content — call file_write Ship the redirect map',
    });
    // The row cuts and highlights an excerpt from `body`; a `subtitle`
    // would win the line with the raw text.
    expect(result.current.results[0]?.subtitle).toBeUndefined();
  });

  it('names an untitled chat', () => {
    backend.hits = [
      { threadId: 'th-2', title: null, snippet: 'hello', updatedAt: 1 },
    ];
    const source = createChatSearchSource({ organizationId: 'org-1' });
    const { result } = renderHook(() => source('hello', OPEN), { wrapper });

    expect(result.current.results[0]?.title).toBe(
      i18n.t('history.untitled', { ns: 'chat' }),
    );
  });
});

// #4890: an unavailable search read as "no results" on purpose, so a chat
// that exists looked missing during an outage.
describe('a chat search that fails', () => {
  const HIT = {
    threadId: 'th-1',
    title: 'Launch',
    snippet: 'go',
    updatedAt: 1,
  };

  it('reads as the palette error with a retry, never as no chats', () => {
    backend.status = 'unavailable';
    const source = createChatSearchSource({ organizationId: 'org-1' });
    const { result } = renderHook(() => source('launch', OPEN), { wrapper });

    expect(result.current).toMatchObject({
      status: 'error',
      results: [],
      retrying: false,
    });
    expect(result.current.retry).toBeInstanceOf(Function);
  });

  it('holds the error through its retry, then shows what the search found', async () => {
    backend.status = 'unavailable';
    let settle: () => void = () => {};
    backend.retrySearch.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    const source = createChatSearchSource({ organizationId: 'org-1' });
    const { result, rerender } = renderHook(() => source('launch', OPEN), {
      wrapper,
    });

    act(() => result.current.retry?.());
    expect(backend.retrySearch).toHaveBeenCalledWith('launch');
    // The retry restarts the read from `loading`: the failure still stands.
    backend.status = 'loading';
    rerender();
    expect(result.current).toMatchObject({ status: 'error', retrying: true });
    // Nor do rows another query found stand in for this one's answer.
    backend.status = 'ready';
    backend.hits = [{ ...HIT, threadId: 'th-other' }];
    rerender();
    expect(result.current).toMatchObject({
      status: 'error',
      results: [],
      retrying: true,
    });

    backend.hits = [HIT];
    await act(async () => settle());
    expect(result.current.status).toBe('ready');
    expect(result.current.results.map(({ id }) => id)).toEqual(['th-1']);
  });

  it('keeps the error, no longer busy, when the retry fails again', async () => {
    backend.status = 'unavailable';
    const source = createChatSearchSource({ organizationId: 'org-1' });
    const { result } = renderHook(() => source('launch', OPEN), { wrapper });

    await act(async () => result.current.retry?.());
    expect(result.current).toMatchObject({ status: 'error', retrying: false });
  });
});
