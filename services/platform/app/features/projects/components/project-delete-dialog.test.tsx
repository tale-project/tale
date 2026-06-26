import { ConvexError } from 'convex/values';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { ProjectDeleteDialog } from './project-delete-dialog';

// Regression cover for #2068: the delete dialog's catch block mapped only
// PROJECT_CONFIRM_PHRASE_MISMATCH / PROJECT_LEGAL_HOLD / RATE_LIMITED, so a
// PROJECT_HAS_BOUND_APPS error (thrown when appProjectBindings still reference
// the project) fell through to the generic "Couldn't delete project" toast and
// the bound app names returned in error.data.apps were discarded. The dialog
// now maps the code to the actionable i18n message and lists the app names.

const mockDeleteProject = vi.fn();
const mockNavigate = vi.fn();
const mockToast = vi.fn();

vi.mock('../hooks/mutations', () => ({
  useDeleteProject: () => ({ mutateAsync: mockDeleteProject }),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => mockNavigate,
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
  useToast: () => ({ toast: mockToast }),
}));

function renderDialog() {
  return render(
    <ProjectDeleteDialog
      open={true}
      onOpenChange={vi.fn()}
      organizationId="org-1"
      projectId={'project-1' as never}
      projectName="Q2 Sales"
    />,
  );
}

describe('ProjectDeleteDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('surfaces the actionable message with bound app names on PROJECT_HAS_BOUND_APPS', async () => {
    mockDeleteProject.mockRejectedValueOnce(
      new ConvexError({
        code: 'PROJECT_HAS_BOUND_APPS',
        apps: ['Invoices', 'CRM'],
      }),
    );

    const { user } = renderDialog();

    // Detach mode (default): the confirm phrase isn't required, so the delete
    // button is enabled. It shares the "Delete project" label with the title.
    const buttons = screen.getAllByRole('button', { name: 'Delete project' });
    await user.click(buttons[buttons.length - 1]);

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title:
          'Uninstall the apps using this project first, then delete it: Invoices, CRM.',
        variant: 'destructive',
      }),
    );
    // The generic fallback must NOT be used on this path.
    expect(mockToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Couldn't delete project" }),
    );
  });

  it('falls back to the generic actionable message when no app names are returned', async () => {
    mockDeleteProject.mockRejectedValueOnce(
      new ConvexError({ code: 'PROJECT_HAS_BOUND_APPS' }),
    );

    const { user } = renderDialog();

    const buttons = screen.getAllByRole('button', { name: 'Delete project' });
    await user.click(buttons[buttons.length - 1]);

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Uninstall the apps using this project first, then delete it.',
        variant: 'destructive',
      }),
    );
  });
});
