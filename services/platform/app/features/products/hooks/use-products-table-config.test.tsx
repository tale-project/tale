// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { AppShell } from '@tale/ui/app-shell';
import type { ColumnDef } from '@tanstack/react-table';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import type { ProductDoc } from '@/app/lib/backend/contract/docs';
import { i18n } from '@/lib/i18n/i18n';

import { useProductsTableConfig } from './use-products-table-config';

function Providers({ children }: { children: ReactNode }) {
  return (
    <AppShell i18n={i18n} locale={{ mode: 'client' }}>
      {children}
    </AppShell>
  );
}

function columnKey(column: ColumnDef<ProductDoc>): string | undefined {
  return 'accessorKey' in column ? column.accessorKey : column.id;
}

describe('useProductsTableConfig', () => {
  it('lets the name column soak leftover width so stock/price/updated stay under their headers', () => {
    const { result } = renderHook(() => useProductsTableConfig(), {
      wrapper: Providers,
    });
    const byKey = new Map(
      result.current.columns.map((col) => [columnKey(col), col]),
    );
    expect(
      (byKey.get('name')?.meta as { flex?: boolean } | undefined)?.flex,
    ).toBe(true);
    expect(
      (byKey.get('lastUpdated')?.meta as { align?: string } | undefined)?.align,
    ).toBe('right');
  });
});
