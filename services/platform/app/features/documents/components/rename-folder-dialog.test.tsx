import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@/lib/shared/errors/app-error';

import { RenameFolderDialog } from './rename-folder-dialog';

const mockRenameFolder = vi.fn();
const mockToast = vi.fn();

vi.mock('@tale/ui/i18n/client', () => ({
  useT: (ns: string) => ({ t: (key: string) => `${ns}.${key}` }),
}));

vi.mock('@tale/ui/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

vi.mock('../hooks/mutations', () => ({
  useRenameFolder: () => ({ mutateAsync: mockRenameFolder }),
}));

function renderDialog(onOpenChange = vi.fn()) {
  render(
    <RenameFolderDialog
      open
      onOpenChange={onOpenChange}
      folderId="folder-1"
      currentName="Contracts"
    />,
  );
  return onOpenChange;
}

async function submitName(name: string) {
  const input = screen.getByLabelText(/documents\.folder\.folderName/);
  await userEvent.clear(input);
  await userEvent.type(input, name);
  await userEvent.click(
    screen.getByRole('button', { name: 'documents.actions.rename' }),
  );
}

beforeEach(() => {
  mockRenameFolder.mockReset();
  mockToast.mockReset();
});

describe('RenameFolderDialog', () => {
  it('opens on the current name', () => {
    renderDialog();
    expect(screen.getByLabelText(/documents\.folder\.folderName/)).toHaveValue(
      'Contracts',
    );
  });

  it('renames the folder with the trimmed name and closes', async () => {
    mockRenameFolder.mockResolvedValue(null);
    const onOpenChange = renderDialog();

    await submitName('  Signed contracts  ');

    expect(mockRenameFolder).toHaveBeenCalledWith({
      folderId: 'folder-1',
      name: 'Signed contracts',
    });
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'documents.folder.renamed',
        variant: 'success',
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes without a request when the name is unchanged', async () => {
    const onOpenChange = renderDialog();

    await submitName('Contracts');

    expect(mockRenameFolder).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it.each([
    'Reports/2026',
    'Reports\\2026',
    '.',
    '..',
    'x'.repeat(129),
    'Reports\u007f2026',
  ])('explains invalid name %j inline without sending it', async (name) => {
    const onOpenChange = renderDialog();
    await submitName(name);

    expect(mockRenameFolder).not.toHaveBeenCalled();
    expect(
      await screen.findByText('documents.folder.invalidName'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/documents\.folder\.folderName/)).toHaveValue(
      name,
    );
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it.each(['Reports 2026', 'x'.repeat(128)])(
    'renames to valid name %j',
    async (name) => {
      mockRenameFolder.mockResolvedValue(null);
      renderDialog();
      await submitName(name);
      expect(mockRenameFolder).toHaveBeenCalledWith({
        folderId: 'folder-1',
        name,
      });
    },
  );

  it('keeps a server-refused name editable and lets the corrected draft succeed', async () => {
    mockRenameFolder
      .mockRejectedValueOnce(
        new AppError({
          code: 'FOLDER_NAME_INVALID',
          message: 'FOLDER_NAME_INVALID',
        }),
      )
      .mockResolvedValue(null);
    const onOpenChange = renderDialog();
    await submitName('Reports 2026');

    expect(
      await screen.findByText('documents.folder.invalidName'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/documents\.folder\.folderName/)).toHaveValue(
      'Reports 2026',
    );
    expect(
      screen.getByLabelText(/documents\.folder\.folderName/),
    ).not.toBeDisabled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(mockToast).not.toHaveBeenCalled();

    await submitName('Reports 2027');
    expect(mockRenameFolder).toHaveBeenLastCalledWith({
      folderId: 'folder-1',
      name: 'Reports 2027',
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('names a folder the sync keeps the name of on the field', async () => {
    mockRenameFolder.mockRejectedValue(
      new AppError({
        code: 'FOLDER_SYNC_MANAGED',
        message: 'A folder in a synced tree keeps its name',
      }),
    );
    const onOpenChange = renderDialog();

    await submitName('Customers');

    expect(
      await screen.findByText('documents.folder.renameSyncManaged'),
    ).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('refuses a name of only dots, as the backend would', async () => {
    renderDialog();

    await submitName('..');

    expect(mockRenameFolder).not.toHaveBeenCalled();
    expect(
      await screen.findByText('documents.folder.invalidName'),
    ).toBeInTheDocument();
  });

  it('keeps the dialog open and names a sibling clash on the field', async () => {
    mockRenameFolder.mockRejectedValue(
      new AppError({ code: 'FOLDER_NAME_TAKEN', message: 'Folder name taken' }),
    );
    const onOpenChange = renderDialog();

    await submitName('Invoices');

    expect(
      await screen.findByText('documents.folder.duplicateName'),
    ).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(mockToast).not.toHaveBeenCalled();
  });
});
