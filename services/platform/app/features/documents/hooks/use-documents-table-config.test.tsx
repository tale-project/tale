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
function renderUploadedByCell(document: Partial<DocumentItem>) {
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
    (c) => 'id' in c && c.id === 'uploadedBy',
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only narrowing of ColumnDef cell to its callable form
  const cell = column?.cell as CellRenderer;
  return render(<Providers>{cell({ row: { original: document } })}</Providers>);
}

describe('useDocumentsTableConfig — uploadedBy cell', () => {
  // Regression for #1974: a long unbroken name (e.g. an email) must clip within
  // its column instead of overflowing into the Modified timestamp. `truncate`
  // + `max-w` only engage on a block box, so the cell must render `as="div"`,
  // never an inline `span` (which ignores `max-width`/`overflow`).
  it('renders a long uploader name in a block box that truncates', () => {
    const longName = 'someone.with.a.very.long.address@example.com';
    renderUploadedByCell({ type: 'file', createdByName: longName });

    const cell = screen.getByText(longName);
    // Must be a block element so `truncate` can clip — the inline `span` bug.
    expect(cell.tagName).toBe('DIV');
    expect(cell).toHaveClass('truncate');
    expect(cell).toHaveClass('max-w-[10rem]');
    // The full value stays discoverable on hover once it is clipped.
    expect(cell).toHaveAttribute('title', longName);
  });

  it('falls back to an em dash when a file has no uploader name', () => {
    renderUploadedByCell({ type: 'file' });

    const cell = screen.getByText('—');
    // Still a truncating block box; nothing to disclose, so no title.
    expect(cell.tagName).toBe('DIV');
    expect(cell).toHaveClass('truncate');
    expect(cell).not.toHaveAttribute('title');
  });

  it('renders an em dash for a folder row', () => {
    renderUploadedByCell({ type: 'folder', createdByName: 'ignored' });

    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
