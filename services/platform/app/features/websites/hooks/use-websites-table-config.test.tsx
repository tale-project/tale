// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { AppShell } from '@tale/ui/app-shell';
import { render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import type { WebsiteDoc } from '@/app/lib/backend/contract/docs';
import { i18n } from '@/lib/i18n/i18n';

import { useWebsitesTableConfig } from './use-websites-table-config';

function Providers({ children }: { children: ReactNode }) {
  return (
    <AppShell i18n={i18n} locale={{ mode: 'client' }}>
      {children}
    </AppShell>
  );
}

type CellRenderer = (ctx: {
  row: { original: Partial<WebsiteDoc> };
}) => ReactNode;

/** Render the `lastScannedAt` column cell for a given website row. */
function renderLastScannedCell(website: Partial<WebsiteDoc>) {
  const { result } = renderHook(() => useWebsitesTableConfig(), {
    wrapper: Providers,
  });
  const column = result.current.columns.find(
    (c) => 'accessorKey' in c && c.accessorKey === 'lastScannedAt',
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only narrowing of ColumnDef cell to its callable form
  const cell = column?.cell as CellRenderer;
  return render(<Providers>{cell({ row: { original: website } })}</Providers>);
}

describe('useWebsitesTableConfig — column layout', () => {
  it.each([
    [1, 1, '0'],
    [4, 2, '2'],
    [undefined, undefined, '0'],
  ])(
    'excludes failed attempts from Indexed (%s attempted, %s failed)',
    (crawledPageCount, failedPageCount, expected) => {
      const { result } = renderHook(() => useWebsitesTableConfig(), {
        wrapper: Providers,
      });
      const column = result.current.columns.find((c) => c.id === 'indexed');
      const cell = column?.cell as CellRenderer;
      render(
        <Providers>
          {cell({ row: { original: { crawledPageCount, failedPageCount } } })}
        </Providers>,
      );
      expect(screen.getByText(expected)).toBeInTheDocument();
    },
  );

  it('lets the domain column soak leftover width so date cells stay under their headers', () => {
    const { result } = renderHook(() => useWebsitesTableConfig(), {
      wrapper: Providers,
    });
    const domain = result.current.columns.find(
      (c) => 'accessorKey' in c && c.accessorKey === 'domain',
    );
    expect((domain?.meta as { flex?: boolean } | undefined)?.flex).toBe(true);
  });
});

describe('useWebsitesTableConfig — lastScannedAt cell', () => {
  it('shows a static "Not scanned yet" label for a never-scanned website', () => {
    renderLastScannedCell({ status: 'error' });

    expect(screen.getByText('Not scanned yet')).toBeInTheDocument();
    // Must NOT misrepresent an idle/terminal state as work-in-progress.
    expect(
      screen.queryByRole('status', { name: 'Scanning' }),
    ).not.toBeInTheDocument();
  });

  it('shows "Not scanned yet" even when a scan errored without a timestamp', () => {
    renderLastScannedCell({ status: 'error' });

    expect(screen.getByText('Not scanned yet')).toBeInTheDocument();
    expect(
      screen.queryByRole('status', { name: 'Scanning' }),
    ).not.toBeInTheDocument();
  });

  it('shows a labelled spinner only while actively scanning', () => {
    renderLastScannedCell({ status: 'scanning' });

    // Spinner carries an accessible name so screen-reader users get the state.
    const spinner = screen.getByRole('status', { name: 'Scanning' });
    expect(spinner).toBeInTheDocument();
    expect(screen.queryByText('Not scanned yet')).not.toBeInTheDocument();
  });

  it('renders the timestamp once a scan has completed', async () => {
    renderLastScannedCell({
      status: 'active',
      lastScannedAt: Date.UTC(2026, 0, 15, 12, 0, 0),
    });

    // CopyableTimestamp resolves the formatted date asynchronously; awaiting
    // its copy control flushes that effect and proves the timestamp rendered.
    expect(await screen.findByRole('button')).toBeInTheDocument();
    expect(
      screen.queryByRole('status', { name: 'Scanning' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Not scanned yet')).not.toBeInTheDocument();
  });
});
