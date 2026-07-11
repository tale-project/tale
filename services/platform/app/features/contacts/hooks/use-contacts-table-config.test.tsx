// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { AppShell } from '@tale/ui/app-shell';
import type { ColumnDef } from '@tanstack/react-table';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import type { Doc } from '@/convex/_generated/dataModel';
import { i18n } from '@/lib/i18n/i18n';

import { useContactsTableConfig } from './use-contacts-table-config';

type Contact = Doc<'contacts'>;

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
});
