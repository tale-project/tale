// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Id } from '@/convex/_generated/dataModel';
import type { SettingsUploadsForm } from '@/lib/shared/schemas/automation_settings';
import { fireEvent, render, screen } from '@/tests/utils/render';

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

// Per-test project contents: defaults set in beforeEach; tree tests replace
// them with a nested layout.
const projectData = vi.hoisted(() => ({
  documents: [] as Array<{ _id: string; title: string; folderId: string }>,
  folders: [] as Array<{ _id: string; name: string; parentId?: string }>,
  loading: false,
}));

vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProjectDocuments: () => ({
    documents: projectData.documents,
    isLoading: projectData.loading,
  }),
  useProjectFolders: () => ({
    folders: projectData.folders,
    isLoading: projectData.loading,
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
    projectData.documents = [
      {
        _id: 'doc_seed',
        title: 'history-a-filed.json',
        folderId: 'folder_setup',
      },
    ];
    projectData.folders = [
      { _id: 'folder_setup', name: 'Setup', parentId: undefined },
    ];
    projectData.loading = false;
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

  it('with a declared subdir, lists ONLY that subtree — settings-folder files stay out', async () => {
    projectData.folders = [
      { _id: 'folder_setup', name: 'Setup', parentId: undefined },
      { _id: 'folder_fr', name: 'filed-returns', parentId: 'folder_setup' },
      { _id: 'folder_q1', name: '2025Q1', parentId: 'folder_fr' },
    ];
    projectData.documents = [
      // The desk's own seed at the settings-folder ROOT — the automation's
      // record, not an operator upload: it must neither read as a misfiled
      // file nor offer a delete here (Knowledge is its surface).
      {
        _id: 'doc_seed_root',
        title: 'history-2025-Q1-filed.json',
        folderId: 'folder_setup',
      },
      { _id: 'doc_pdf', title: 'return-q1.pdf', folderId: 'folder_q1' },
    ];
    const { user } = mount({
      ...FORM,
      subdir: 'filed-returns',
      requireFolder: true,
    });

    expect(
      screen.queryByText('history-2025-Q1-filed.json'),
    ).not.toBeInTheDocument();
    // The declared subtree itself is there: the quarter folder, collapsed.
    const quarter = screen.getByRole('treeitem', { name: '2025Q1' });
    expect(quarter).toHaveAttribute('aria-expanded', 'false');
    // …and it really LISTS the subtree: expanding shows the quarter's file
    // (an empty-but-green listing must not pass).
    await user.click(quarter);
    expect(screen.getByText('return-q1.pdf')).toBeInTheDocument();
  });

  it('collapses folders by default; a click reveals the files and picks the target', async () => {
    projectData.folders = [
      { _id: 'folder_setup', name: 'Setup', parentId: undefined },
      { _id: 'folder_q1', name: '2025Q1', parentId: 'folder_setup' },
    ];
    projectData.documents = [
      {
        _id: 'doc_nested',
        title: 'history-b-filed.json',
        folderId: 'folder_q1',
      },
    ];
    const { user } = mount();

    // Collapsed by default: the folder row renders, its contents do not.
    const folderRow = screen.getByRole('treeitem', { name: '2025Q1' });
    expect(folderRow).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('history-b-filed.json')).not.toBeInTheDocument();
    // Roving tabindex fallback: with nothing picked, the FIRST row carries
    // the tab stop so keyboard users can enter the tree at all.
    expect(folderRow).toHaveAttribute('tabindex', '0');

    // Click = expand AND pick as upload target (project Files tab semantics).
    await user.click(folderRow);
    expect(folderRow).toHaveAttribute('aria-expanded', 'true');
    expect(folderRow).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('history-b-filed.json')).toBeInTheDocument();
    // The pick is wired through: the drop zone now names the folder…
    expect(
      screen.getByText('Drop files here — they go to "2025Q1"'),
    ).toBeInTheDocument();
    // …and the revealed file row is a NAVIGABLE treeitem, not a dead div.
    const fileRow = screen
      .getAllByRole('treeitem')
      .find((row) => row.textContent?.includes('history-b-filed.json'));
    expect(fileRow).toBeDefined();

    // Clicking the picked folder again collapses it and clears the target.
    await user.click(folderRow);
    expect(folderRow).toHaveAttribute('aria-expanded', 'false');
    expect(folderRow).toHaveAttribute('aria-selected', 'false');
    expect(screen.queryByText('history-b-filed.json')).not.toBeInTheDocument();
  });

  it('shows a loading state instead of the empty text while the queries load', () => {
    projectData.loading = true;
    mount();

    expect(screen.getByText('Loading files…')).toBeInTheDocument();
    expect(screen.queryByText('No files yet.')).not.toBeInTheDocument();
    // No upload while "empty" might just mean "not loaded yet" — creating
    // the folder chain against an unloaded list would duplicate it.
    expect(document.querySelector('input[type="file"]')).toBeDisabled();
  });

  it("keeps a nested create-folder submit out of the ancestor form's onSubmit", async () => {
    const outerSubmit = vi.fn((event: { preventDefault: () => void }) => {
      event.preventDefault();
    });
    const { user } = render(
      // The setup gate wraps the panel in a real <form>; the create-folder
      // FormDialog mounts in a portal but React still bubbles submit along
      // the component tree — FormDialog must stop it (a folder create once
      // saved the whole gate underneath).
      <form onSubmit={outerSubmit}>
        <SettingsUploadsPanel
          organizationId="org_1"
          projectId={'project_1' as Id<'projects'>}
          folder="Setup"
          form={FORM}
        />
      </form>,
    );

    await user.click(screen.getByRole('button', { name: 'New folder' }));
    const nameInput = await screen.findByPlaceholderText('e.g. Invoices');
    await user.type(nameInput, '2026Q1');
    const dialogForm = nameInput.closest('form');
    if (!(dialogForm instanceof HTMLFormElement))
      throw new Error('dialog form missing');
    fireEvent.submit(dialogForm);

    expect(outerSubmit).not.toHaveBeenCalled();
  });
});
