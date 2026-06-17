import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { ProjectCreateDialog } from './project-create-dialog';

// Migrated from the `validation` E2E "rejects a whitespace-only name on submit;
// cancels without creating". The dialog's name schema is `.trim().min(1)`, and
// the FormDialog submit button is NOT validity-gated (the component passes
// neither `isValid` nor `isDirty`, so both default to `true`) — RHF only runs
// the zod resolver on submit. So a whitespace-only name leaves the button
// enabled; clicking it surfaces the required error and BLOCKS the create
// (`createProject` is never called, no navigation happens). That is pure
// client-side validation gating + a client-side mutation guard — no router
// redirect, no backend round-trip — so it belongs at the component tier. We
// mock the create mutation + navigate to prove neither fires, exactly as the
// E2E asserted "No navigation to a new project detail route".

const mockCreateProject = vi.fn();
const mockNavigate = vi.fn();

vi.mock('../hooks/mutations', () => ({
  useCreateProject: () => ({ mutateAsync: mockCreateProject }),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => mockNavigate,
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
  useToast: () => ({ toast: vi.fn() }),
}));

describe('ProjectCreateDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes axe audit when open', async () => {
    const { container } = render(
      <ProjectCreateDialog
        open={true}
        onOpenChange={vi.fn()}
        organizationId="org-1"
      />,
    );
    expect(
      screen.getByRole('dialog', { name: 'Create project' }),
    ).toBeInTheDocument();
    await checkAccessibility(container);
  });

  it('rejects a whitespace-only name on submit; cancels without creating', async () => {
    const onOpenChange = vi.fn();
    const { user } = render(
      <ProjectCreateDialog
        open={true}
        onOpenChange={onOpenChange}
        organizationId="org-1"
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Create project' });
    const nameField = screen.getByRole('textbox', { name: 'Project name' });
    // The submit button shares the "Create project" label with the dialog
    // title; scope the lookup to the dialog's button role.
    const submit = screen.getByRole('button', { name: 'Create project' });

    // The submit button is NOT validity-gated — a whitespace-only name leaves
    // it enabled (RHF validates on submit, not onChange).
    await user.type(nameField, '   ');
    expect(submit).toBeEnabled();

    await user.click(submit);

    // The zod `.trim().min(1)` rule surfaces the required error and blocks the
    // create: `createProject` never runs and no navigation occurs. (The
    // auto-derived key also errors on the blank name, so there can be more than
    // one alert — assert the specific name-required one, an `alert` element.)
    const alert = await screen.findByText('Project name is required');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(mockCreateProject).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();

    // Dialog stays open after the blocked submit.
    expect(dialog).toBeInTheDocument();

    // Cancelling closes the dialog without creating anything.
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockCreateProject).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
