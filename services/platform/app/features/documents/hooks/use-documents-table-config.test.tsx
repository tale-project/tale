// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { AppShell } from '@tale/ui/app-shell';
import { render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import type { DocumentItem } from '@/types/documents';

import { useDocumentsTableConfig } from './use-documents-table-config';

// The sync-health badge names the member whose grant runs the sync and hands
// that member the reconnect button; the viewer here is that member.
vi.mock('@/app/hooks/use-current-user', () => ({
  useCurrentUser: () => ({ data: { userId: 'user_owner' } }),
}));

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
        onDocumentView: () => {},
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

/** `renderColumnCell` plus a user for cells that open something. */
function renderColumnCellWithUser(
  columnId: string,
  document: Partial<DocumentItem>,
) {
  const user = userEvent.setup();
  return { user, ...renderColumnCell(columnId, document) };
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

describe('useDocumentsTableConfig — source cell', () => {
  const healthy = {
    configId: 'cfg_1',
    status: 'healthy' as const,
    needsReauth: false,
    ownerUserId: 'user_owner',
    ownerName: 'Dana',
  };

  it('labels a synced folder by the provider its config names', () => {
    renderColumnCell('source', {
      type: 'folder',
      name: 'Q3',
      sourceProvider: 'google_drive',
      sourceMode: 'auto',
      syncHealth: { ...healthy, provider: 'google_drive' },
    });
    expect(
      screen.getByRole('img', { name: 'Google Drive (synced)' }),
    ).toBeInTheDocument();
  });

  // The cell used to spell the source out, and "OneDrive (synchronisiert)"
  // wrapped and spilled into the RAG status column. The vendor mark and a
  // sync glyph fit every locale; the words stay as the accessible name.
  it.each([
    {
      sourceProvider: 'onedrive',
      sourceMode: 'auto',
      name: 'OneDrive (synced)',
    },
    {
      sourceProvider: 'onedrive',
      sourceMode: 'manual',
      name: 'OneDrive (not synced)',
    },
    {
      sourceProvider: 'sharepoint',
      sourceMode: 'manual',
      name: 'SharePoint (not synced)',
    },
    {
      sourceProvider: 'google_drive',
      sourceMode: 'manual',
      name: 'Google Drive (not synced)',
    },
    { sourceProvider: 'upload', sourceMode: 'manual', name: 'Upload' },
    { sourceProvider: 'webdav', sourceMode: 'manual', name: 'WebDAV' },
  ] as const)(
    'shows $sourceProvider ($sourceMode) as an icon named $name',
    async ({ sourceProvider, sourceMode, name }) => {
      const { container } = renderColumnCell('source', {
        type: 'file',
        sourceProvider,
        sourceMode,
      });
      expect(screen.getByRole('img', { name })).toBeInTheDocument();
      expect(container).toHaveTextContent(/^$/);
      await checkAccessibility(container);
    },
  );

  it('draws the sync state as its own glyph, and none for an upload', () => {
    const synced = renderColumnCell('source', {
      type: 'file',
      sourceProvider: 'onedrive',
      sourceMode: 'auto',
    }).container;
    const notSynced = renderColumnCell('source', {
      type: 'file',
      sourceProvider: 'onedrive',
      sourceMode: 'manual',
    }).container;
    const upload = renderColumnCell('source', {
      type: 'file',
      sourceProvider: 'upload',
    }).container;

    expect(synced.querySelector('.lucide-refresh-cw')).not.toBeNull();
    expect(synced.querySelector('.lucide-refresh-cw-off')).toBeNull();
    expect(notSynced.querySelector('.lucide-refresh-cw-off')).not.toBeNull();
    expect(notSynced.querySelector('.lucide-refresh-cw')).toBeNull();
    expect(upload.querySelector('[class*="lucide-refresh"]')).toBeNull();
  });

  it('shows nothing for a provenance without a mark', () => {
    const { container } = renderColumnCell('source', {
      type: 'file',
      sourceProvider: 'api_import',
    });
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  // A config in `error` used to lose its "(synced)" label altogether: the
  // folder listing decorated active configs only, so a broken sync looked
  // like a plain folder. The badge replaces the label and opens the reason.
  it('flags a failed sync with a badge that opens the run error', async () => {
    const { user } = renderColumnCellWithUser('source', {
      type: 'folder',
      name: 'Reports',
      sourceProvider: 'onedrive',
      sourceMode: 'auto',
      syncHealth: {
        ...healthy,
        provider: 'onedrive',
        status: 'failed',
        errorSince: Date.UTC(2026, 8, 15, 9, 0),
        errorMessage: 'Failed to list folder contents: 503 throttled',
      },
    });
    expect(
      screen.queryByRole('img', { name: 'OneDrive (synced)' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sync failed' }));
    expect(
      screen.getByText('Failed to list folder contents: 503 throttled'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Synced with the account of Dana/),
    ).toBeInTheDocument();
  });

  it('names the reconnect case on the badge', () => {
    renderColumnCell('source', {
      type: 'folder',
      name: 'Reports',
      sourceProvider: 'onedrive',
      sourceMode: 'auto',
      syncHealth: {
        ...healthy,
        provider: 'onedrive',
        status: 'failed',
        needsReauth: true,
      },
    });
    expect(
      screen.getByRole('button', { name: 'OneDrive access expired' }),
    ).toHaveTextContent('Reconnect needed');
  });
});
