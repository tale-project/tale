// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { AppShell } from '@tale/ui/app-shell';
import { render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';

import type { Team } from './queries';
import { useTeamsTableConfig } from './use-teams-table-config';

function Providers({ children }: { children: ReactNode }) {
  return (
    <AppShell i18n={i18n} locale={{ mode: 'client' }}>
      {children}
    </AppShell>
  );
}

type CellRenderer = (ctx: { row: { original: Team } }) => ReactNode;

function column(accessorKey: string) {
  const { result } = renderHook(() => useTeamsTableConfig('org-1'), {
    wrapper: Providers,
  });
  const found = result.current.columns.find(
    (c) => 'accessorKey' in c && c.accessorKey === accessorKey,
  );
  if (!found) throw new Error(`no ${accessorKey} column`);
  return found;
}

describe('useTeamsTableConfig', () => {
  // Regression for #2381: the Teams table renders under `SettingsPage`
  // (no `fitToContainer`), so it must NOT enable `stickyLayout`. A sticky inner
  // scroll container has no bounded-height ancestor here — it collapses to
  // content height and its `overscroll-contain` swallows the wheel over the
  // table, freezing the settings page. The page must own the vertical scroll.
  it('does not use the sticky scroll layout', () => {
    const { result } = renderHook(() => useTeamsTableConfig('org-1'), {
      wrapper: Providers,
    });

    expect(result.current.stickyLayout).toBe(false);
  });

  // Synced IdP group names run long and truncate; the full name has to stay
  // discoverable on hover, and the name column — not the member count —
  // gets the width.
  it('gives the team name most of the width and its full text on hover', () => {
    const name = 'Department.Platform.Knowledge-Base.Editors';
    const nameColumn = column('name');
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only narrowing of ColumnDef cell to its callable form
    const cell = nameColumn.cell as CellRenderer;
    render(
      <Providers>
        {cell({
          row: {
            original: {
              id: 't-1',
              name,
              memberCount: 3,
              createdAt: 0,
              synced: true,
            },
          },
        })}
      </Providers>,
    );

    const label = screen.getByText(name);
    expect(label).toHaveClass('truncate');
    expect(label).toHaveAttribute('title', name);
    expect(nameColumn.size).toBeGreaterThan(
      column('memberCount').size ?? Infinity,
    );
  });
});
