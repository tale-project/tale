// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { AppShell } from '@tale/ui/app-shell';
import { render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import type { AuditLogDoc } from '@/app/lib/backend/contract/docs';
import { i18n } from '@/lib/i18n/i18n';

import { useAuditLogTableConfig } from './use-audit-log-table-config';

function Providers({ children }: { children: ReactNode }) {
  return (
    <AppShell i18n={i18n} locale={{ mode: 'client' }}>
      {children}
    </AppShell>
  );
}

type CellRenderer = (ctx: { row: { original: AuditLogDoc } }) => ReactNode;

function actionCell(): CellRenderer {
  const { result } = renderHook(() => useAuditLogTableConfig(), {
    wrapper: Providers,
  });
  const found = result.current.columns.find(
    (c) => 'accessorKey' in c && c.accessorKey === 'action',
  );
  if (!found) throw new Error('no action column');
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only narrowing of ColumnDef cell to its callable form
  return found.cell as CellRenderer;
}

describe('useAuditLogTableConfig — action cell', () => {
  // A connector tool's action has no translation, so the cell shows its raw
  // key: one token as wide as the column. It must wrap between its dotted
  // segments rather than inside a word, and copy as the same text.
  it('lets an untranslated action key wrap after each dot', () => {
    const cell = actionCell();
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the cell reads only `action`; a full audit row is noise here
    const row = {
      action: 'connector.github.create_pull_request_review',
    } as AuditLogDoc;
    render(<Providers>{cell({ row: { original: row } })}</Providers>);

    const label = screen.getByText(
      'connector.github.create pull request review',
    );
    expect(label.querySelectorAll('wbr')).toHaveLength(2);
    expect(label).toHaveClass('break-words');
  });
});
