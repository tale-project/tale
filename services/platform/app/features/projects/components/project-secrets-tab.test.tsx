import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { Id } from '@/convex/_generated/dataModel';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { ProjectSecretsTab } from './project-secrets-tab';

// Migrated from the projects-depth E2E "project secrets: create then delete an
// API-key secret". The E2E exercised the add-secret dialog (fill name + API key
// value → Save) and the per-row delete button. The "appears in the list" /
// "disappears from the list" round-trip is a backend persistence cycle (the
// Convex action encrypts + stores, the query re-reads) that jsdom cannot
// reproduce — so we mock the feature's secrets hooks: the query supplies the
// rendered list deterministically and the mutations are spies. What's faithfully
// asserted at the component tier is the same observable UI the E2E drove: the
// dialog opens with the Name + API-key fields, Save invokes setProjectSecret
// with the upper-cased name, an existing secret renders as a row, and its delete
// button invokes deleteProjectSecret with that secret's name.

const mockSetMutateAsync = vi.fn().mockResolvedValue(undefined);
const mockDeleteMutateAsync = vi.fn().mockResolvedValue(undefined);
let secretsFixture: { name: string; description?: string }[] = [];

vi.mock('../hooks/secrets', () => ({
  useProjectSecrets: () => ({ secrets: secretsFixture, isLoading: false }),
  useSetProjectSecret: () => ({
    mutateAsync: mockSetMutateAsync,
    isPending: false,
  }),
  useDeleteProjectSecret: () => ({
    mutateAsync: mockDeleteMutateAsync,
    isPending: false,
  }),
}));

// The component imports the standalone `toast` fn directly; stub it so the
// success/error toasts don't reach the real toast store.
vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
  useToast: () => ({ toast: vi.fn() }),
}));

// FormDialog (the dialog shell) reads the org id from the router for its error
// boundary; outside a RouterProvider that hook throws, so stub it like the other
// dialog component tests do.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

const PROJECT_ID = 'proj-1' as Id<'projects'>;

function renderTab() {
  return render(
    <ProjectSecretsTab organizationId="org-1" projectId={PROJECT_ID} />,
  );
}

// The static page chrome stacks the StickySectionHeader (h2) above the Alert's
// fixed `level={5}` heading. In isolation that h2→h5 jump trips axe's
// `heading-order`, but it's a standalone-render artifact: in the app the tab
// sits under the page's h1/h2 hierarchy. Suppress only that one rule on the
// full-page renders; every other WCAG rule stays on.
const NO_HEADING_ORDER = { rules: { 'heading-order': { enabled: false } } };

describe('ProjectSecretsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    secretsFixture = [];
  });

  describe('rendering', () => {
    it('shows the Secrets heading, add button, and empty state', async () => {
      const { container } = renderTab();

      expect(
        screen.getByRole('heading', { name: 'Secrets' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Add secret' }),
      ).toBeInTheDocument();
      expect(screen.getByText('No secrets yet.')).toBeInTheDocument();

      await checkAccessibility(container, NO_HEADING_ORDER);
    });

    it('renders an existing secret as a row with a delete button', async () => {
      secretsFixture = [{ name: 'E2E_DEPTH_SECRET_ABC' }];
      const { container } = renderTab();

      const row = screen
        .getByText('E2E_DEPTH_SECRET_ABC')
        .closest('li') as HTMLElement;
      expect(row).not.toBeNull();
      expect(
        within(row).getByRole('button', { name: 'Delete' }),
      ).toBeInTheDocument();
      expect(screen.queryByText('No secrets yet.')).not.toBeInTheDocument();

      await checkAccessibility(container, NO_HEADING_ORDER);
    });
  });

  describe('add-secret dialog', () => {
    it('opens with the Name and API key fields when the add button is clicked', async () => {
      const { user } = renderTab();

      await user.click(screen.getByRole('button', { name: 'Add secret' }));

      const dialog = await screen.findByRole('dialog', { name: 'Add secret' });
      expect(dialog).toBeInTheDocument();
      // The required asterisk folds "required" into the label's accessible name
      // (e.g. "Namerequired"), so match the field labels on a substring.
      expect(
        screen.getByLabelText('Name', { exact: false }),
      ).toBeInTheDocument();
      // Type defaults to "API key", so the value field is labelled "API key".
      expect(
        screen.getByLabelText('API key', { exact: false }),
      ).toBeInTheDocument();

      await checkAccessibility(dialog);
    });

    it('invokes setProjectSecret with the upper-cased name on Save', async () => {
      const { user } = renderTab();

      await user.click(screen.getByRole('button', { name: 'Add secret' }));
      await screen.findByRole('dialog', { name: 'Add secret' });

      await user.type(
        screen.getByLabelText('Name', { exact: false }),
        'e2e_depth_secret_abc',
      );
      await user.type(
        screen.getByLabelText('API key', { exact: false }),
        'tale-e2e-depth-secret-value',
      );

      // The Save button lives in the dialog footer (common.actions.save).
      await user.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(mockSetMutateAsync).toHaveBeenCalledTimes(1);
      });
      expect(mockSetMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          projectId: PROJECT_ID,
          name: 'E2E_DEPTH_SECRET_ABC',
          value: 'tale-e2e-depth-secret-value',
        }),
      );
    });
  });

  describe('delete', () => {
    it('invokes deleteProjectSecret with the row name when its delete button is clicked', async () => {
      secretsFixture = [{ name: 'E2E_DEPTH_SECRET_ABC' }];
      const { user } = renderTab();

      const row = screen
        .getByText('E2E_DEPTH_SECRET_ABC')
        .closest('li') as HTMLElement;
      await user.click(within(row).getByRole('button', { name: 'Delete' }));

      await waitFor(() => {
        expect(mockDeleteMutateAsync).toHaveBeenCalledTimes(1);
      });
      expect(mockDeleteMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          projectId: PROJECT_ID,
          name: 'E2E_DEPTH_SECRET_ABC',
        }),
      );
    });
  });
});
