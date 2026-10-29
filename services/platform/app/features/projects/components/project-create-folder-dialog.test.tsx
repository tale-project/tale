import { LOCALE_STORAGE_KEY } from '@tale/ui/i18n/detect-locale';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@/lib/shared/errors/app-error';
import { checkAccessibility } from '@/tests/utils/a11y';
import { i18n } from '@/tests/utils/i18n-all-languages';
import { act, cleanup, fireEvent, render, screen } from '@/tests/utils/render';

import { ProjectCreateFolderDialog } from './project-create-folder-dialog';

// The dialog checks a name against the server's folder-name rule before any
// request and names the rule it broke at the field (#4837): it used to send
// "2024/25" and show the server's English sentence under a toast title.

const mockCreateFolder = vi.fn();
const mockToast = vi.fn();

vi.mock('@/app/features/documents/hooks/mutations', () => ({
  useCreateFolder: () => ({ mutateAsync: mockCreateFolder }),
}));

vi.mock('@tale/ui/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

const onOpenChange = vi.fn();

function renderDialog() {
  return render(
    <ProjectCreateFolderDialog
      organizationId="org-1"
      projectId="proj-1"
      open
      onOpenChange={onOpenChange}
    />,
  );
}

function nameInput() {
  return screen.getByRole('textbox', { name: /folder name/i });
}

async function submit(name: string) {
  await act(async () => {
    fireEvent.change(nameInput(), { target: { value: name } });
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Create folder' }));
  });
}

describe('ProjectCreateFolderDialog', () => {
  beforeEach(() => {
    mockCreateFolder.mockResolvedValue('folder-new');
  });

  afterEach(async () => {
    // Unmount first: a language change re-renders every mounted reader.
    cleanup();
    vi.clearAllMocks();
    localStorage.removeItem(LOCALE_STORAGE_KEY);
    await i18n.changeLanguage('en');
  });

  it.each([
    ['2024/25', "A folder name can't contain slashes (/ or \\)"],
    ['Q1\\Q2', "A folder name can't contain slashes (/ or \\)"],
    [
      'Reports\t2026',
      "A folder name can't contain control characters, such as a tab",
    ],
    ['..', "A folder name can't be just one or two dots"],
    [' . ', "A folder name can't be just one or two dots"],
    ['x'.repeat(129), 'Folder name must be 128 characters or fewer'],
    ['   ', 'Folder name is required'],
  ])(
    'names the rule %j breaks at the field, without a request',
    async (name, message) => {
      renderDialog();
      await submit(name);

      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      expect(nameInput()).toHaveAccessibleDescription(message);
      expect(nameInput()).toHaveAttribute('aria-invalid', 'true');
      expect(nameInput()).toHaveValue(name);
      expect(mockCreateFolder).not.toHaveBeenCalled();
      expect(mockToast).not.toHaveBeenCalled();
      expect(onOpenChange).not.toHaveBeenCalled();
    },
  );

  it('names the rule in the language the reader reads', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    await i18n.changeLanguage('de');
    renderDialog();
    await act(async () => {
      fireEvent.change(screen.getByRole('textbox', { name: /ordnername/i }), {
        target: { value: '2024/25' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ordner erstellen' }));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ein Ordnername darf keine Schrägstriche enthalten (/ oder \\)',
    );
    expect(mockCreateFolder).not.toHaveBeenCalled();
  });

  it.each([
    ['Reports 2026', 'Reports 2026'],
    ['  Reports 2026  ', 'Reports 2026'],
    ['x'.repeat(128), 'x'.repeat(128)],
    ['...', '...'],
  ])(
    'creates %j in the project as the name the server stores',
    async (name, stored) => {
      renderDialog();
      await submit(name);

      expect(mockCreateFolder).toHaveBeenCalledWith({
        organizationId: 'org-1',
        name: stored,
        parentId: undefined,
        projectId: 'proj-1',
      });
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Folder created',
        variant: 'success',
      });
      expect(onOpenChange).toHaveBeenCalledWith(false);
    },
  );

  it('names a name the server refused at the field and keeps the draft', async () => {
    mockCreateFolder.mockRejectedValueOnce(
      new AppError({
        code: 'FOLDER_NAME_INVALID',
        message: 'Folder name must not contain a control character',
      }),
    );
    renderDialog();
    await submit('Reports 2026');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Use up to 128 characters without slashes or control characters, and not just one or two dots.',
    );
    expect(nameInput()).toHaveValue('Reports 2026');
    expect(mockToast).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();

    await submit('Reports 2027');
    expect(mockCreateFolder).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'Reports 2027' }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('passes axe with a refused name at the field', async () => {
    const { baseElement } = renderDialog();
    await submit('2024/25');
    await screen.findByRole('alert');

    await checkAccessibility(baseElement);
  });
});
