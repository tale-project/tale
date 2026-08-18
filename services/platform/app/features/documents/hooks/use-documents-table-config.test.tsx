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

/** Render one column's cell for a given document row. */
function renderColumnCell(
  columnId: string,
  document: Partial<DocumentItem>,
  teamMap: Map<string, string> = new Map(),
) {
  const { result } = renderHook(
    () =>
      useDocumentsTableConfig({
        onDocumentClick: () => {},
        onFolderDeleted: () => {},
        isLoadingTeams: false,
        teamMap,
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

describe('useDocumentsTableConfig — teams cell', () => {
  const teamMap = new Map([
    ['team_a', 'Compliance'],
    ['team_b', 'Legal'],
  ]);

  function renderTeamsCell(
    document: Partial<DocumentItem>,
    teams: Map<string, string> = teamMap,
  ) {
    return renderColumnCell('teams', document, teams);
  }

  it('says organization-wide only when there is no team and no project', () => {
    renderTeamsCell({});
    expect(screen.getByText('Organization-wide')).toBeInTheDocument();
  });

  // #2989: a project-scoped document has zero teams by construction (the two
  // stamps are mutually exclusive), so a cell keyed on `teamIds.length === 0`
  // called every one of them organization-wide — the opposite of the truth, on
  // the screen an operator uses to check whether material is restricted.
  it('never says organization-wide for a project-scoped document', () => {
    renderTeamsCell({ projectId: 'project_a', teamIds: [] });
    expect(screen.queryByText('Organization-wide')).not.toBeInTheDocument();
    expect(screen.getByText('Project-scoped')).toBeInTheDocument();
  });

  // The reachable sibling: a row written before multi-team support carries only
  // the deprecated single `teamId`, which `hasTeamAccess` still enforces — but
  // the cell read `teamTags` alone and so reported it as unrestricted.
  it('never says organization-wide for a legacy single-team document', () => {
    renderTeamsCell({ teamId: 'team_a' });
    expect(screen.queryByText('Organization-wide')).not.toBeInTheDocument();
    expect(screen.getByText('Compliance')).toBeInTheDocument();
  });

  it('names the teams of a multi-team document', () => {
    renderTeamsCell({ teamIds: ['team_a', 'team_b'] });
    expect(screen.getByText(/Compliance, Legal/)).toBeInTheDocument();
  });
});
