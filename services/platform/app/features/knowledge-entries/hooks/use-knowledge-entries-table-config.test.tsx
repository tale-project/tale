// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { AppShell } from '@tale/ui/app-shell';
import { render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';

import type { KnowledgeEntryItem } from './queries';
import { useKnowledgeEntriesTableConfig } from './use-knowledge-entries-table-config';

function Providers({ children }: { children: ReactNode }) {
  return (
    <AppShell i18n={i18n} locale={{ mode: 'client' }}>
      {children}
    </AppShell>
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
  it('lets topic and content split the leftover width so Updated stays under its header', () => {
    const { result } = renderHook(() => useKnowledgeEntriesTableConfig(), {
      wrapper: Providers,
    });
    for (const key of ['topic', 'content']) {
      const column = result.current.columns.find(
        (c) => 'accessorKey' in c && c.accessorKey === key,
      );
      expect((column?.meta as { flex?: boolean } | undefined)?.flex).toBe(true);
    }
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
