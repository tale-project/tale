import { AppShell } from '@tale/ui/app-shell';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';

import { createChatSearchSource } from './chat-search-source';

const backend = vi.hoisted(() => ({
  hits: [] as unknown[],
}));

vi.mock('./chat-backend', () => ({
  useChatQuery: () => ({ status: 'ready', data: backend.hits }),
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
  backend.hits = [];
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
