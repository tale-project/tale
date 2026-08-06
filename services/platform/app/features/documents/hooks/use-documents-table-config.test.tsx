// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { AppShell } from '@tale/ui/app-shell';
import { render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import type { DocumentItem } from '@/types/documents';

import { useDocumentsTableConfig } from './use-documents-table-config';

function Providers({ children }: { children: ReactNode }) {
  return (
    <AppShell i18n={i18n} locale={{ mode: 'client' }}>
      {children}
    </AppShell>
  );
}

type CellRenderer = (ctx: {
  row: { original: Partial<DocumentItem> };
}) => ReactNode;

/** Render the `uploadedBy` column cell for a given document row. */
function renderColumnCell(columnId: string, document: Partial<DocumentItem>) {
  const { result } = renderHook(
    () =>
      useDocumentsTableConfig({
        onDocumentClick: () => {},
        onFolderDeleted: () => {},
        isLoadingTeams: false,
        teamMap: new Map(),
      }),
    { wrapper: Providers },
  );
  const column = result.current.columns.find(
    (c) =>
      ('id' in c && c.id === columnId) ||
      ('accessorKey' in c && c.accessorKey === columnId),
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only narrowing of ColumnDef cell to its callable form
  const cell = column?.cell as CellRenderer;
  return {
    column,
    ...render(<Providers>{cell({ row: { original: document } })}</Providers>),
  };
}

function renderUploadedByCell(document: Partial<DocumentItem>) {
  return renderColumnCell('uploadedBy', document);
}

describe('useDocumentsTableConfig — uploadedBy cell', () => {
  // Regression for #1974: a long unbroken name (e.g. an email) must clip within
  // its column instead of overflowing into the Modified timestamp. The clip
  // wrapper uses `w-0 min-w-full`; the inner span is `block truncate`.
  it('renders a long uploader name in a block box that truncates', () => {
    const longName = 'someone.with.a.very.long.address@example.com';
    renderUploadedByCell({ type: 'file', createdByName: longName });

    const cell = screen.getByText(longName);
    // Wrapper pins the clip box to the table cell; inner span is block + truncate.
    expect(cell.parentElement).toHaveClass(
      'w-0',
      'min-w-full',
      'overflow-hidden',
    );
    expect(cell.tagName).toBe('SPAN');
    expect(cell).toHaveClass('truncate', 'block');
    // The full value stays discoverable on hover once it is clipped.
    expect(cell).toHaveAttribute('title', longName);
  });

  it('falls back to an em dash when a file has no uploader name', () => {
    renderUploadedByCell({ type: 'file' });

    const cell = screen.getByText('—');
    // Still a truncating block box; nothing to disclose, so no title.
    expect(cell.tagName).toBe('SPAN');
    expect(cell).toHaveClass('truncate', 'block');
    expect(cell).not.toHaveAttribute('title');
  });

  it('renders an em dash for a folder row', () => {
    renderUploadedByCell({ type: 'folder', createdByName: 'ignored' });

    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('clips the uploadedBy column at the table cell', () => {
    const { column } = renderUploadedByCell({
      type: 'file',
      createdByName: 'a@b.com',
    });

    expect(column?.meta).toMatchObject({ className: 'overflow-hidden' });
  });
});

describe('useDocumentsTableConfig — lastModified cell', () => {
  it('wraps the timestamp in a clip box and omits the timezone suffix in-cell', () => {
    renderColumnCell('lastModified', {
      type: 'file',
      lastModified: new Date('2026-05-27T14:57:00Z').getTime(),
    });

    const wrapper = document.querySelector('.w-0.min-w-full.overflow-hidden');
    expect(wrapper).toBeInTheDocument();
    // `medium` + `ll LT` keeps the date compact; timezone stays in `title`.
    expect(screen.getByText(/2026/i).textContent).not.toMatch(/GMT/i);
    expect(screen.getByText(/2026/i)).toHaveAttribute('title');
  });
});
