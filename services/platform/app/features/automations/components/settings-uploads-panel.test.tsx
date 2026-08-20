// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Id } from '@/convex/_generated/dataModel';
import type { SettingsUploadsForm } from '@/lib/shared/schemas/automation_settings';
import { render, screen } from '@/tests/utils/render';

const toastMock = vi.hoisted(() => vi.fn());
vi.mock('@/app/hooks/use-toast', () => ({ toast: toastMock }));

const convexMutation = vi.hoisted(() => vi.fn());
vi.mock('@/app/hooks/use-convex-mutation', () => ({
  useConvexMutation: () => ({ mutateAsync: convexMutation }),
}));

// The panel's create-folder FormDialog reads the org from the route params
// (error-boundary context); there is no router in this render.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org_1',
}));

vi.mock('@/app/features/documents/hooks/mutations', () => ({
  useCreateFolder: () => ({ mutateAsync: vi.fn() }),
  useDeleteDocument: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProjectDocuments: () => ({
    documents: [
      {
        _id: 'doc_seed',
        title: 'history-a-filed.json',
        folderId: 'folder_setup',
      },
    ],
    isLoading: false,
  }),
  useProjectFolders: () => ({
    folders: [{ _id: 'folder_setup', name: 'Setup', parentId: undefined }],
    isLoading: false,
  }),
}));

import { SettingsUploadsPanel } from './settings-uploads-panel';

const FORM: SettingsUploadsForm = {
  kind: 'uploads',
  title: 'Reference documents',
  accept: ['.json', '.pdf'],
  match: String.raw`^history-.*\.json$|\.pdf$`,
};

function mount(form: SettingsUploadsForm = FORM) {
  return render(
    <SettingsUploadsPanel
      organizationId="org_1"
      projectId={'project_1' as Id<'projects'>}
      folder="Setup"
      form={form}
    />,
  );
}

describe('SettingsUploadsPanel', () => {
  beforeEach(() => {
    toastMock.mockReset();
    convexMutation.mockReset();
  });

  it('refuses an upload whose name never matches — before any byte moves', async () => {
    // accept is wider than match on purpose (the schema allows it): a
    // `.json` the pattern never lists would upload fine and then "vanish"
    // from the panel. The gate mirrors the listing filter, pre-upload.
    const { user } = mount();
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('drop-zone input missing');
    await user.upload(
      input,
      new File(['{}'], 'notes.json', { type: 'application/json' }),
    );

    expect(convexMutation).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title:
          "The file name doesn't match the expected pattern for this form.",
        description: 'notes.json',
      }),
    );
  });

  it('renders no drop zone until a folder is picked when requireFolder is set', () => {
    mount({ ...FORM, requireFolder: true });

    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(
      screen.getByText(
        'Create or pick a folder above — uploads go into the selected folder.',
      ),
    ).toBeInTheDocument();
  });

  it('gives the file Delete button an explicit type so it cannot submit a form', () => {
    // The panel renders inside the automation-settings <form>; an implicit
    // type="submit" here fired Save on top of the confirm dialog.
    mount();
    const remove = screen.getByRole('button', {
      name: 'Delete history-a-filed.json',
    });
    expect(remove).toHaveAttribute('type', 'button');
  });
});
