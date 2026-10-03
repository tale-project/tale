// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import {
  SESSION_ENDED,
  SHIPPED_LOCALES,
  lapsedSessionRefusal,
} from '@/tests/utils/lapsed-session';

vi.mock('@tale/ui/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string, params?: Record<string, unknown>) => {
      // A row's checkbox is named after its item: keep the name in the label.
      if (key === 'aria.selectFolder' || key === 'aria.selectFile') {
        return `${ns}.${key} ${String(params?.name)}`;
      }
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

// A toast hands back its handle, as the real one does: the dialog dismisses
// its "Import started" notice when the import ends in the connect dialog.
const toastHandle = vi.hoisted(() => ({ dismiss: () => {} }));
vi.mock('@tale/ui/use-toast', () => ({
  toast: vi.fn(() => ({ id: 'toast-1', update: () => {}, ...toastHandle })),
}));

vi.mock('@tale/ui/use-format-date', () => ({
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

vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useOrgTeams: () => ({ teams: [], isLoading: false }),
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

// Whether the CURRENT folder's listing was cut at the bound — the picker's
// notice keys on it.
const listingState = vi.hoisted(() => ({ truncated: false }));

vi.mock('../hooks/queries', () => ({
  useCloudImportAuthorizationStatus: () => ({
    data: { status: 'active', provider: 'microsoft' },
    isLoading: false,
    error: null,
  }),
  useOneDriveFiles: () => ({
    data: {
      items: [{ id: 'folder-1', name: 'Meetings', size: 0, isFolder: true }],
      truncated: listingState.truncated,
    },
    isLoading: false,
    error: null,
  }),
  useSharePointSites: () => ({ data: [], isLoading: false }),
  useSharePointDrives: () => ({ data: [], isLoading: false }),
  useSharePointFiles: () => ({
    data: { items: [], truncated: false },
    isLoading: false,
  }),
}));

import { toast } from '@tale/ui/use-toast';

import { OneDriveImportDialog } from './onedrive-import-dialog';

/** The "Meetings" folder's row checkbox, found by the name it is read by. */
const meetingsCheckbox = () =>
  screen.getByRole('checkbox', {
    name: 'documents.aria.selectFolder Meetings',
  });

describe('OneDriveImportDialog', () => {
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

  // Regression: the listers took Graph's first page only and the dialog
  // imported whatever came back, so a 300-file folder imported 100 and the
  // toast said success. A folder the listing could not cover whole now stops
  // the import — nothing is sent, and the user is told which folder.
  it('refuses to import a folder whose listing was cut at the bound', async () => {
    mockListFiles.mockResolvedValue({
      success: true,
      items: [{ id: 'file-1', name: 'notes.docx', size: 10, isFolder: false }],
      truncated: true,
    });
    const user = userEvent.setup();
    render(<OneDriveImportDialog {...defaultProps} />);

    await user.click(meetingsCheckbox());
    await user.click(
      screen.getByRole('button', { name: 'documents.onedrive.importCount' }),
    );
    await user.click(
      screen.getByRole('button', { name: /documents\.onedrive\.importItems/ }),
    );

    expect(mockImportFiles).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'destructive',
        title: 'documents.onedrive.importFailed',
        description: 'documents.onedrive.folderTooLargeToImport',
      }),
    );
  });

  // The provider's own answer used to stand under the title, in English.
  it('stops the import when a folder cannot be listed at all', async () => {
    mockListFiles.mockResolvedValue({
      success: false,
      error: 'OneDrive API error: 503 {"error":{"code":"serviceNotAvailable"}}',
    });
    const user = userEvent.setup();
    render(<OneDriveImportDialog {...defaultProps} />);

    await user.click(meetingsCheckbox());
    await user.click(
      screen.getByRole('button', { name: 'documents.onedrive.importCount' }),
    );
    await user.click(
      screen.getByRole('button', { name: /documents\.onedrive\.importItems/ }),
    );

    expect(mockImportFiles).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith({
      variant: 'destructive',
      title: 'documents.onedrive.importFailed',
      description: 'common.errors.generic',
    });
  });

  // The grant check's sentence on the answer: access ended part-way. The
  // connect dialog says so, with the count — no toast, and the "Import
  // started" notice is taken down.
  it('hands an import the grant stopped to the connect dialog, with no toast', async () => {
    const dismiss = vi.spyOn(toastHandle, 'dismiss');
    mockImportFiles.mockResolvedValueOnce({
      success: false,
      results: [
        { fileId: 'file-1', fileName: 'notes.docx', status: 'success' },
      ],
      totalFiles: 2,
      successCount: 1,
      failedCount: 0,
      skippedCount: 0,
      error:
        'OneDrive is not authorized for importing. Connect Microsoft 365 from Documents.',
    });
    const onRequireConnect = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <OneDriveImportDialog
        {...defaultProps}
        onOpenChange={onOpenChange}
        onRequireConnect={onRequireConnect}
      />,
    );

    await user.click(meetingsCheckbox());
    await user.click(
      screen.getByRole('button', { name: 'documents.onedrive.importCount' }),
    );
    await user.click(
      screen.getByRole('button', { name: /documents\.onedrive\.importItems/ }),
    );

    await waitFor(() =>
      expect(onRequireConnect).toHaveBeenCalledWith({ imported: 1, total: 2 }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(vi.mocked(toast).mock.calls.map(([shown]) => shown.title)).toEqual([
      'documents.onedrive.importStarted',
    ]);
    expect(dismiss).toHaveBeenCalled();
    dismiss.mockRestore();
  });

  // Any other `error` on the answer is the backend's own English (a token
  // refresh the provider could not answer): the toast keeps the counts.
  it("keeps an unsuccessful import answer's own words out of the toast", async () => {
    mockImportFiles.mockResolvedValueOnce({
      success: false,
      results: [],
      totalFiles: 2,
      successCount: 0,
      failedCount: 0,
      skippedCount: 0,
      error:
        'Cloud authorization could not be refreshed right now (HTTP 503) — the next sync retries',
    });
    const onRequireConnect = vi.fn();
    const user = userEvent.setup();
    render(
      <OneDriveImportDialog
        {...defaultProps}
        onRequireConnect={onRequireConnect}
      />,
    );

    await user.click(meetingsCheckbox());
    await user.click(
      screen.getByRole('button', { name: 'documents.onedrive.importCount' }),
    );
    await user.click(
      screen.getByRole('button', { name: /documents\.onedrive\.importItems/ }),
    );

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        variant: 'destructive',
        title: 'documents.onedrive.importFailed',
        description: 'documents.onedrive.filesImportedCount',
      }),
    );
    expect(onRequireConnect).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(toast).mock.calls)).not.toContain(
      'HTTP 503',
    );
  });

  // An empty folder used to send an empty list, which the door refused in
  // zod's English ("items: Too small: …") after an "Importing 0 items".
  it('says there is nothing to import in a selection of empty folders', async () => {
    mockListFiles.mockResolvedValue({ success: true, items: [] });
    const user = userEvent.setup();
    render(<OneDriveImportDialog {...defaultProps} />);

    await user.click(meetingsCheckbox());
    await user.click(
      screen.getByRole('button', { name: 'documents.onedrive.importCount' }),
    );
    await user.click(
      screen.getByRole('button', { name: /documents\.onedrive\.importItems/ }),
    );

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        title: 'documents.onedrive.importFailed',
        description: 'documents.onedrive.noFilesSelected',
        variant: 'destructive',
      }),
    );
    expect(toast).toHaveBeenCalledTimes(1);
    expect(mockImportFiles).not.toHaveBeenCalled();
  });

  it('says when the shown folder holds more than the listing bound', () => {
    listingState.truncated = true;
    render(<OneDriveImportDialog {...defaultProps} />);

    expect(screen.getByRole('status')).toHaveTextContent(
      'documents.onedrive.listingTruncated',
    );
  });

  it('shows no such notice for a whole listing', () => {
    render(<OneDriveImportDialog {...defaultProps} />);

    expect(screen.queryByRole('status')).toBeNull();
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
    await user.click(meetingsCheckbox());
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

    await user.click(meetingsCheckbox());
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

  // The refusal's own `message` is its serialized payload; the import toast
  // used to show `{"code":"UNAUTHORIZED",…}` under its title.
  describe.each(SHIPPED_LOCALES)('after a lapsed session (%s)', (locale) => {
    afterEach(async () => {
      await i18n.changeLanguage('en');
    });

    it('says the session ended when the import is refused', async () => {
      await i18n.changeLanguage(locale);
      mockImportFiles.mockImplementationOnce(lapsedSessionRefusal);
      const user = userEvent.setup();
      render(<OneDriveImportDialog {...defaultProps} />);

      await user.click(meetingsCheckbox());
      await user.click(
        screen.getByRole('button', { name: 'documents.onedrive.importCount' }),
      );
      await user.click(
        screen.getByRole('button', {
          name: /documents\.onedrive\.importItems/,
        }),
      );

      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith({
          title: 'documents.onedrive.importFailed',
          description: SESSION_ENDED[locale],
          variant: 'destructive',
        }),
      );
      expect(toast).not.toHaveBeenCalledWith(
        expect.objectContaining({
          description: expect.stringContaining('"code"'),
        }),
      );
    });
  });
});
