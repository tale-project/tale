import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { ProjectRenameDialog } from './project-rename-dialog';

// Regression cover for #3916: the dialog reset its field on every change of
// `currentName` while it was open. The row passes the project's live name, so
// a rename made in another session replaced an unsaved draft with no save, no
// discard and no notice. The draft now starts when the dialog opens (or turns
// to another project), and a live rename only moves an untouched field.

const mockUpdateIdentity = vi.fn();
const mockToast = vi.fn();
const onOpenChange = vi.fn();

vi.mock('../hooks/mutations', () => ({
  useUpdateProjectIdentity: () => ({ mutateAsync: mockUpdateIdentity }),
}));

vi.mock('@tale/ui/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
  useToast: () => ({ toast: mockToast }),
}));

function renameDialog({
  open = true,
  projectId = 'project-1',
  currentName,
}: {
  open?: boolean;
  projectId?: string;
  currentName: string;
}) {
  return (
    <ProjectRenameDialog
      open={open}
      onOpenChange={onOpenChange}
      projectId={projectId}
      currentName={currentName}
    />
  );
}

function nameField() {
  return screen.getByRole('textbox', { name: 'Project name' });
}

describe('ProjectRenameDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateIdentity.mockResolvedValue(undefined);
  });

  it('keeps a typed draft when the project is renamed elsewhere, and saves the draft', async () => {
    const { user, rerender } = render(
      renameDialog({ currentName: 'Original name' }),
    );
    await user.clear(nameField());
    await user.type(nameField(), 'Unfinished local rename');

    rerender(renameDialog({ currentName: 'Other user renamed this' }));

    expect(nameField()).toHaveValue('Unfinished local rename');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mockUpdateIdentity).toHaveBeenCalledTimes(1);
    expect(mockUpdateIdentity).toHaveBeenCalledWith({
      projectId: 'project-1',
      name: 'Unfinished local rename',
    });
  });

  it('keeps a typed draft when the row re-renders with the same name', async () => {
    const { user, rerender } = render(
      renameDialog({ currentName: 'Original name' }),
    );
    await user.clear(nameField());
    await user.type(nameField(), 'Unfinished local rename');

    rerender(renameDialog({ currentName: 'Original name' }));

    expect(nameField()).toHaveValue('Unfinished local rename');
  });

  it('moves an untouched field to the new name, so Save never writes the old one back', async () => {
    const { user, rerender } = render(
      renameDialog({ currentName: 'Original name' }),
    );

    rerender(renameDialog({ currentName: 'Other user renamed this' }));

    expect(nameField()).toHaveValue('Other user renamed this');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mockUpdateIdentity).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('starts fresh when re-opened, for the same project and for another one', async () => {
    const { user, rerender } = render(
      renameDialog({ currentName: 'Original name' }),
    );
    await user.clear(nameField());
    await user.type(nameField(), 'Abandoned draft');

    rerender(renameDialog({ open: false, currentName: 'Original name' }));
    rerender(renameDialog({ currentName: 'Original name' }));

    expect(nameField()).toHaveValue('Original name');

    await user.clear(nameField());
    await user.type(nameField(), 'Another abandoned draft');

    rerender(renameDialog({ open: false, currentName: 'Original name' }));
    rerender(
      renameDialog({ projectId: 'project-2', currentName: 'Second project' }),
    );

    expect(nameField()).toHaveValue('Second project');

    // The fresh draft is untouched, so it still follows a live rename.
    rerender(
      renameDialog({
        projectId: 'project-2',
        currentName: 'Renamed elsewhere',
      }),
    );

    expect(nameField()).toHaveValue('Renamed elsewhere');
  });

  it('starts fresh when it turns to another project while open', async () => {
    const { user, rerender } = render(
      renameDialog({ currentName: 'Original name' }),
    );
    await user.clear(nameField());
    await user.type(nameField(), 'Draft for the first project');

    rerender(
      renameDialog({ projectId: 'project-2', currentName: 'Second project' }),
    );

    expect(nameField()).toHaveValue('Second project');
  });
});
