// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { AppShell } from '@tale/ui/app-shell';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';

import type { KnowledgeEntryItem } from './queries';
import { useKnowledgeEntriesTableConfig } from './use-knowledge-entries-table-config';

// The RAG status badge holds its retry action, a react-query mutation.
const queryClient = new QueryClient();

function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AppShell i18n={i18n} locale={{ mode: 'client' }}>
        {children}
      </AppShell>
    </QueryClientProvider>
  );
}

type CellRenderer = (ctx: {
  row: { original: Partial<KnowledgeEntryItem> };
}) => ReactNode;

function renderColumnCell(
  columnId: string,
  entry: Partial<KnowledgeEntryItem>,
) {
  const { result } = renderHook(() => useKnowledgeEntriesTableConfig(), {
    wrapper: Providers,
  });
  const column = result.current.columns.find(
    (c) =>
      ('id' in c && c.id === columnId) ||
      ('accessorKey' in c && c.accessorKey === columnId),
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only narrowing of ColumnDef cell to its callable form
  const cell = column?.cell as CellRenderer;
  return {
    column,
    ...render(<Providers>{cell({ row: { original: entry } })}</Providers>),
  };
}

describe('useKnowledgeEntriesTableConfig', () => {
  it('lets the topic column soak leftover width so Updated stays under its header', () => {
    const { result } = renderHook(() => useKnowledgeEntriesTableConfig(), {
      wrapper: Providers,
    });
    const topic = result.current.columns.find(
      (c) => 'accessorKey' in c && c.accessorKey === 'topic',
    );
    expect((topic?.meta as { flex?: boolean } | undefined)?.flex).toBe(true);
    const updated = result.current.columns.find(
      (c) => 'accessorKey' in c && c.accessorKey === 'createdAt',
    );
    expect(updated?.size).toBe(208);
    expect(
      updated?.meta as { align?: string; className?: string } | undefined,
    ).toMatchObject({
      align: 'right',
      className: 'overflow-hidden',
    });
  });
});

describe('useKnowledgeEntriesTableConfig — createdAt cell', () => {
  it('clips the timestamp and omits the timezone suffix in-cell', () => {
    renderColumnCell('createdAt', {
      createdAt: new Date('2026-09-14T11:11:00Z').getTime(),
    });

    const wrapper = document.querySelector('.w-0.min-w-full.overflow-hidden');
    expect(wrapper).toBeInTheDocument();
    expect(screen.getByText(/2026/i).textContent).not.toMatch(/GMT/i);
    expect(screen.getByText(/2026/i)).toHaveAttribute('title');
  });
});

describe('useKnowledgeEntriesTableConfig — content cell', () => {
  // Regression: the column showed the Markdown source, asterisks and all.
  it('previews the content with its Markdown decoration stripped', () => {
    renderColumnCell('content', {
      content: 'Open **only on Thursdays**\n\n- Owner: *Kai*',
    });

    const preview = screen.getByText('Open only on Thursdays Owner: Kai');
    expect(preview).toHaveAttribute(
      'title',
      'Open only on Thursdays Owner: Kai',
    );
  });
});

// #3603: the badge read the backend's epoch-millisecond stamp as seconds,
// and the Indexed dialog dated the indexing in the year 58711.
describe('useKnowledgeEntriesTableConfig — ragStatus cell', () => {
  // 10:00Z is 28 September from UTC−10 to UTC+13, whatever zone runs this.
  const indexedAt = Date.parse('2026-09-28T10:00:00.000Z');

  it.each([
    { ragIndexedAt: indexedAt, shows: 'September 28, 2026' },
    { ragIndexedAt: undefined, shows: 'Unknown' },
  ])('shows $shows in the Indexed dialog', async ({ ragIndexedAt, shows }) => {
    const user = userEvent.setup();
    renderColumnCell('ragStatus', {
      documentId: 'doc-1',
      ragStatus: 'completed',
      ragIndexedAt,
    });
    await user.click(screen.getByRole('button', { name: 'Document indexed' }));
    const dialog = screen.getByRole('dialog', { name: 'Document indexed' });
    expect(dialog).toHaveTextContent(`Indexed on: ${shows}`);
    expect(dialog).not.toHaveTextContent('58711');
  });
});
