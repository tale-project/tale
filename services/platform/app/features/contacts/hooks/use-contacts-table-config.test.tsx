// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { AppShell } from '@tale/ui/app-shell';
import type { ColumnDef } from '@tanstack/react-table';
import { render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import type { ContactDoc } from '@/app/lib/backend/contract/docs';
import { i18n } from '@/lib/i18n/i18n';

import { useContactsTableConfig } from './use-contacts-table-config';

type Contact = ContactDoc;

function Providers({ children }: { children: ReactNode }) {
  return (
    <AppShell i18n={i18n} locale={{ mode: 'client' }}>
      {children}
    </AppShell>
  );
}

function columnKey(column: ColumnDef<Contact>): string | undefined {
  return 'accessorKey' in column ? column.accessorKey : column.id;
}

type CellRenderer = (ctx: { row: { original: Partial<Contact> } }) => ReactNode;

/** Render a single accessor column's cell for a given contact row. */
function renderCell(accessorKey: string, contact: Partial<Contact>) {
  const { result } = renderHook(() => useContactsTableConfig(), {
    wrapper: Providers,
  });
  const column = result.current.columns.find(
    (c) => 'accessorKey' in c && c.accessorKey === accessorKey,
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only narrowing of ColumnDef cell to its callable form
  const cell = column?.cell as CellRenderer;
  return render(<Providers>{cell({ row: { original: contact } })}</Providers>);
}

describe('useContactsTableConfig', () => {
  it('marks Name, Email and Added sortable; everything else not (#2639)', () => {
    const { result } = renderHook(() => useContactsTableConfig(), {
      wrapper: Providers,
    });

    const byKey = new Map(
      result.current.columns.map((col) => [columnKey(col), col]),
    );

    // `enableSorting` unset (undefined) means "sortable" once the table has a
    // sorting config — only explicit `false` opts a column out.
    expect(byKey.get('name')?.enableSorting).not.toBe(false);
    expect(byKey.get('email')?.enableSorting).not.toBe(false);
    expect(byKey.get('_creationTime')?.enableSorting).not.toBe(false);

    expect(byKey.get('phone')?.enableSorting).toBe(false);
    expect(byKey.get('source')?.enableSorting).toBe(false);
    expect(byKey.get('locale')?.enableSorting).toBe(false);
  });

  // A contact's name is frequently a raw email — an unbreakable token that, as
  // a bare inline span in a `table-fixed` cell, overflowed its column and bled
  // over the next one. `block` makes the span honour the cell width and
  // `truncate` clips the overflow with an ellipsis instead of spilling.
  it('truncates the Name, Email and Phone cells so long values cannot bleed across columns', () => {
    const longEmail = 'johnmichealdoe@gmail.com';
    const cases: Array<[string, string]> = [
      ['name', longEmail],
      ['email', longEmail],
      ['phone', '+15551234567890'],
    ];

    for (const [key, value] of cases) {
      const { unmount } = renderCell(key, {
        name: longEmail,
        email: longEmail,
        phone: '+15551234567890',
      });
      expect(screen.getByText(value)).toHaveClass('truncate', 'block');
      unmount();
    }
  });
});
