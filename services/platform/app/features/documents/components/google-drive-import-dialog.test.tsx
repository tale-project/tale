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
    mutateAsync:
      ref === 'google_drive/actions:listFiles' ? mockListFiles : vi.fn(),
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
  useImportGoogleDriveFiles: () => ({
    mutateAsync: mockImportFiles,
    isPending: false,
  }),
}));

// Whether the CURRENT folder's listing was cut at the bound — the picker's
// notice keys on it.
const listingState = vi.hoisted(() => ({ truncated: false }));

vi.mock('../hooks/queries', () => ({
  useCloudImportAuthorizationStatus: () => ({
    data: { status: 'active', provider: 'google' },
    isLoading: false,
    error: null,
  }),
  useGoogleDriveFiles: () => ({
    data: {
      items: [{ id: 'folder-1', name: 'Meetings', size: 0, isFolder: true }],
      truncated: listingState.truncated,
    },
    isLoading: false,
    error: null,
  }),
}));

import { toast } from '@/app/hooks/use-toast';

import { GoogleDriveImportDialog } from './google-drive-import-dialog';

/** Select the "Meetings" folder, go to settings, and press Import. */
async function selectMeetingsAndImport(
  user: ReturnType<typeof userEvent.setup>,
) {
  const [, rowCheckbox] = screen.getAllByRole('checkbox');
  await user.click(rowCheckbox);
  await user.click(
    screen.getByRole('button', { name: 'documents.googledrive.importCount' }),
  );
  await user.click(
    screen.getByRole('button', { name: /documents\.googledrive\.importItems/ }),
  );
}

describe('GoogleDriveImportDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    organizationId: 'org-1',
  };

  beforeEach(() => {
    mockListFiles.mockClear();
    mockListFiles.mockResolvedValue({
      success: true,
      items: [
        { id: 'file-1', name: 'notes.docx', size: 10, isFolder: false },
        { id: 'file-2', name: 'standup.docx', size: 20, isFolder: false },
      ],
    });
    mockImportFiles.mockClear();
    vi.mocked(toast).mockClear();
    listingState.truncated = false;
  });

  // Regression: the Drive walk was unbounded and the dialog imported
  // whatever a sub-listing returned. Now the lister is bounded and says when
  // it cut a folder — and a folder the listing could not cover whole stops
  // the import: nothing is sent, and the user is told which folder.
  it('refuses to import a folder whose listing was cut at the bound', async () => {
    mockListFiles.mockResolvedValue({
      success: true,
      items: [{ id: 'file-1', name: 'notes.docx', size: 10, isFolder: false }],
      truncated: true,
    });
    const user = userEvent.setup();
    render(<GoogleDriveImportDialog {...defaultProps} />);

    await selectMeetingsAndImport(user);

    expect(mockImportFiles).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'destructive',
        title: 'documents.googledrive.importFailed',
        description: 'documents.onedrive.folderTooLargeToImport',
      }),
    );
  });

  // Regression: a sub-folder that failed to list used to toast and the
  // import went on with the rest, calling that a success.
  it('stops the import when a folder cannot be listed at all', async () => {
    mockListFiles.mockResolvedValue({ success: false, error: 'Drive 503' });
    const user = userEvent.setup();
    render(<GoogleDriveImportDialog {...defaultProps} />);

    await selectMeetingsAndImport(user);

    expect(mockImportFiles).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'destructive',
        title: 'documents.googledrive.importFailed',
        description: 'Drive 503',
      }),
    );
  });

  it('says when the shown folder holds more than the listing bound', () => {
    listingState.truncated = true;
    render(<GoogleDriveImportDialog {...defaultProps} />);

    expect(screen.getByRole('status')).toHaveTextContent(
      'documents.onedrive.listingTruncated',
    );
  });

  it('shows no such notice for a whole listing', () => {
    render(<GoogleDriveImportDialog {...defaultProps} />);

    expect(screen.queryByRole('status')).toBeNull();
  });

  // The whole-listing path still imports: relativePath carries the full path
  // including the file name, as the backend drops the last segment to derive
  // the destination folder chain.
  it('imports a whole folder with paths that preserve its structure', async () => {
    const user = userEvent.setup();
    render(<GoogleDriveImportDialog {...defaultProps} />);

    await selectMeetingsAndImport(user);

    expect(mockImportFiles).toHaveBeenCalledTimes(1);
    const { items } = mockImportFiles.mock.calls[0][0];
    expect(items.map((i: { relativePath?: string }) => i.relativePath)).toEqual(
      ['Meetings/notes.docx', 'Meetings/standup.docx'],
    );
    expect(toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' }),
    );
  });
});
