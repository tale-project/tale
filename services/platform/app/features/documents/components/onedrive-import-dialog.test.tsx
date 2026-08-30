// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (params) {
        return Object.entries(params).reduce(
          (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
          `${ns}.${key}`,
        );
      }
      return `${ns}.${key}`;
    },
  }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/app/hooks/use-format-date', () => ({
  useFormatDate: () => ({
    format: (value: unknown) => String(value),
    formatSmart: (value: unknown) => String(value),
    formatHeader: (value: unknown) => String(value),
  }),
}));

// The file table formats sizes through useFormatNumber → useLocale, which
// needs the app's LocaleProvider — stub the provider hook instead.
vi.mock('@tale/ui/i18n/locale-provider', () => ({
  useLocale: () => ({ locale: 'en' }),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

vi.mock('@/app/hooks/use-team-filter', () => ({
  useTeamFilter: () => ({ selectedTeamId: null }),
}));

vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useTeams: () => ({ teams: [], isLoading: false }),
}));

// Contents of the "Meetings" folder returned when collectAllFiles expands it.
const mockListFiles = vi.fn().mockResolvedValue({
  success: true,
  items: [
    { id: 'file-1', name: 'notes.docx', size: 10, isFolder: false },
    { id: 'file-2', name: 'standup.docx', size: 20, isFolder: false },
  ],
});

vi.mock('@/app/hooks/use-backend-action', () => ({
  useBackendAction: (ref: string) => ({
    mutateAsync: ref === 'onedrive/actions:listFiles' ? mockListFiles : vi.fn(),
  }),
}));

vi.mock('@/app/hooks/use-backend-mutation', () => ({
  useBackendMutation: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

const mockImportFiles = vi.fn().mockResolvedValue({
  success: true,
  successCount: 2,
  totalFiles: 2,
});

vi.mock('../hooks/actions', () => ({
  useImportOneDriveFiles: () => ({
    mutateAsync: mockImportFiles,
    isPending: false,
  }),
}));

vi.mock('../hooks/queries', () => ({
  useCloudImportAuthorizationStatus: () => ({
    data: { status: 'active', provider: 'microsoft' },
    isLoading: false,
    error: null,
  }),
  useOneDriveFiles: () => ({
    data: [{ id: 'folder-1', name: 'Meetings', size: 0, isFolder: true }],
    isLoading: false,
    error: null,
  }),
  useSharePointSites: () => ({ data: [], isLoading: false }),
  useSharePointDrives: () => ({ data: [], isLoading: false }),
  useSharePointFiles: () => ({ data: [], isLoading: false }),
}));

import { OneDriveImportDialog } from './onedrive-import-dialog';

describe('OneDriveImportDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    organizationId: 'org-1',
  };

  beforeEach(() => {
    mockListFiles.mockClear();
    mockImportFiles.mockClear();
  });

  // Regression test: the picker and settings stages are plain functions called
  // from the dialog's render, so any hook they call counts toward the dialog's
  // own hook list. When the stages called useT themselves, switching stages
  // changed the hook count and React threw "Rendered more hooks than during
  // the previous render", crashing the dialog into the error boundary.
  it('switches from picker to settings without crashing', async () => {
    const user = userEvent.setup();
    render(<OneDriveImportDialog {...defaultProps} />);

    expect(screen.getByText('Meetings')).toBeInTheDocument();

    // Select the folder, then proceed — this is the stage transition that
    // used to change the parent's hook count.
    const [, rowCheckbox] = screen.getAllByRole('checkbox');
    await user.click(rowCheckbox);
    await user.click(
      screen.getByRole('button', { name: 'documents.onedrive.importCount' }),
    );

    // Title renders twice (dialog title + custom header) — both are settings.
    expect(
      screen.getAllByText('documents.onedrive.importSettings').length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText('documents.onedrive.oneTimeImport'),
    ).toBeInTheDocument();
  });

  // Regression test: relativePath must carry the full path including the file
  // name. The backend derives the destination folder chain by dropping the
  // last segment, so a folder-only path ("Meetings") would import every file
  // into the hub root instead of recreating the folder.
  it('sends file paths that preserve the selected folder structure', async () => {
    const user = userEvent.setup();
    render(<OneDriveImportDialog {...defaultProps} />);

    const [, rowCheckbox] = screen.getAllByRole('checkbox');
    await user.click(rowCheckbox);
    await user.click(
      screen.getByRole('button', { name: 'documents.onedrive.importCount' }),
    );
    await user.click(
      screen.getByRole('button', { name: /documents\.onedrive\.importItems/ }),
    );

    expect(mockImportFiles).toHaveBeenCalledTimes(1);
    const { items } = mockImportFiles.mock.calls[0][0];
    expect(items.map((i: { relativePath?: string }) => i.relativePath)).toEqual(
      ['Meetings/notes.docx', 'Meetings/standup.docx'],
    );
  });
});
