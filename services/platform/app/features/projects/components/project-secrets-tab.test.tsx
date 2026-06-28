import { ConvexError } from 'convex/values';
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
const mockSetPairMutateAsync = vi.fn().mockResolvedValue(undefined);
const mockDeleteMutateAsync = vi.fn().mockResolvedValue(undefined);
let secretsFixture: { name: string; description?: string }[] = [];
let secretsErrorFixture: unknown = undefined;

vi.mock('../hooks/secrets', () => ({
  useProjectSecrets: () => ({
    secrets: secretsFixture,
    isLoading: false,
    error: secretsErrorFixture,
    isError: secretsErrorFixture !== undefined,
  }),
  useSetProjectSecret: () => ({
    mutateAsync: mockSetMutateAsync,
    isPending: false,
  }),
  useSetProjectSecretPair: () => ({
    mutateAsync: mockSetPairMutateAsync,
    isPending: false,
  }),
  useDeleteProjectSecret: () => ({
    mutateAsync: mockDeleteMutateAsync,
    isPending: false,
  }),
}));

// The component imports the standalone `toast` fn directly; stub it so the
// success/error toasts don't reach the real toast store while still letting
// tests assert what was shown.
const mockToast = vi.fn();
vi.mock('@/app/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
  useToast: () => ({ toast: mockToast }),
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
    secretsErrorFixture = undefined;
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

  describe('access denied', () => {
    it('shows a translated access-denied notice and no Add-secret button when the query is forbidden', async () => {
      secretsErrorFixture = new ConvexError({ code: 'PROJECT_FORBIDDEN' });
      const { container } = renderTab();

      expect(screen.getByText('Admin access required')).toBeInTheDocument();
      expect(
        screen.getByText(/Only project administrators can view or manage/),
      ).toBeInTheDocument();
      // The dead-end affordances must be gone: no empty state, no Add button,
      // and no agent-access warning.
      expect(
        screen.queryByRole('button', { name: 'Add secret' }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText('No secrets yet.')).not.toBeInTheDocument();

      await checkAccessibility(container, NO_HEADING_ORDER);
    });

    it('shows the distinct not-found message when the query reports PROJECT_NOT_FOUND', async () => {
      secretsErrorFixture = new ConvexError({ code: 'PROJECT_NOT_FOUND' });
      const { container } = renderTab();

      expect(screen.getByText('Admin access required')).toBeInTheDocument();
      expect(
        screen.getByText('This project no longer exists.'),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/Only project administrators can view or manage/),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Add secret' }),
      ).not.toBeInTheDocument();

      await checkAccessibility(container, NO_HEADING_ORDER);
    });

    it('treats an UNAUTHENTICATED query error as access denied', async () => {
      secretsErrorFixture = new ConvexError({ code: 'UNAUTHENTICATED' });
      renderTab();

      expect(screen.getByText('Admin access required')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Add secret' }),
      ).not.toBeInTheDocument();
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

    it('writes a "basic" credential through the single atomic pair action', async () => {
      const { user } = renderTab();

      await user.click(screen.getByRole('button', { name: 'Add secret' }));
      await screen.findByRole('dialog', { name: 'Add secret' });

      // Switch the type to "Username & password" so the form collects a pair.
      await user.click(screen.getByRole('combobox', { name: /type/i }));
      await user.click(
        await screen.findByRole('option', { name: /username & password/i }),
      );

      // `Name` substring-matches `Username` too once both fields render, so
      // anchor to the field whose accessible name starts with "Name".
      await user.type(screen.getByLabelText(/^name/i), 'svc');
      await user.type(
        screen.getByLabelText('Username', { exact: false }),
        'alice',
      );
      // The password field carries a show/hide toggle whose aria-label also
      // contains "password"; anchor to the field label itself.
      await user.type(screen.getByLabelText(/^password/i), 's3cret');

      await user.click(screen.getByRole('button', { name: 'Save' }));

      // The pair is written by ONE atomic action — never two sequential
      // setProjectSecret calls (the non-atomic path the bug fixed).
      await waitFor(() => {
        expect(mockSetPairMutateAsync).toHaveBeenCalledTimes(1);
      });
      expect(mockSetMutateAsync).not.toHaveBeenCalled();
      expect(mockSetPairMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          projectId: PROJECT_ID,
          baseName: 'SVC',
          username: 'alice',
          password: 's3cret',
        }),
      );
    });

    it('blocks a malformed name client-side without calling the action', async () => {
      const { user } = renderTab();

      await user.click(screen.getByRole('button', { name: 'Add secret' }));
      await screen.findByRole('dialog', { name: 'Add secret' });

      const nameField = screen.getByLabelText('Name', { exact: false });
      const save = screen.getByRole('button', { name: 'Save' });
      const invalidMessage =
        'Name must start with a letter and use only A–Z, 0–9 and underscores.';

      // Leading digit fails the `^[A-Z][A-Z0-9_]{0,63}$` shape.
      await user.type(nameField, '1bad');
      await user.type(
        screen.getByLabelText('API key', { exact: false }),
        'some-value',
      );

      // Inline field error surfaces before any submit; Save stays disabled.
      expect(await screen.findByText(invalidMessage)).toBeInTheDocument();
      expect(save).toBeDisabled();
      expect(mockSetMutateAsync).not.toHaveBeenCalled();
      expect(mockSetPairMutateAsync).not.toHaveBeenCalled();
    });

    it('maps a SECRET_FORBIDDEN ConvexError to its specific toast', async () => {
      mockSetMutateAsync.mockRejectedValueOnce(
        new ConvexError({ code: 'SECRET_FORBIDDEN' }),
      );
      const { user } = renderTab();

      await user.click(screen.getByRole('button', { name: 'Add secret' }));
      await screen.findByRole('dialog', { name: 'Add secret' });

      await user.type(
        screen.getByLabelText('Name', { exact: false }),
        'good_name',
      );
      await user.type(
        screen.getByLabelText('API key', { exact: false }),
        'some-value',
      );
      await user.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title:
              "You don't have permission to manage this project's secrets.",
            variant: 'destructive',
          }),
        );
      });
    });
  });

  // #1991: a whitespace-only name trims to empty and used to re-enable Save,
  // which then threw the server's SECRET_NAME_INVALID as a generic toast with the
  // dialog stuck open. The client now mirrors the server's SECRET_NAME_RE: an
  // invalid name shows an inline message and keeps Save disabled (no mutation).
  describe('name validation gating', () => {
    it('blocks an invalid name inline and never calls setProjectSecret', async () => {
      const { user } = renderTab();

      await user.click(screen.getByRole('button', { name: 'Add secret' }));
      await screen.findByRole('dialog', { name: 'Add secret' });

      const nameField = screen.getByLabelText('Name', { exact: false });
      const save = screen.getByRole('button', { name: 'Save' });
      const invalidMessage =
        'Name must start with a letter and use only A–Z, 0–9 and underscores.';

      // Whitespace-only trims to empty → invalid → inline message, Save DISABLED.
      await user.type(nameField, '   ');
      expect(await screen.findByText(invalidMessage)).toBeInTheDocument();
      expect(save).toBeDisabled();

      // A valid env-var name (upper-cased by the field) clears it and enables Save.
      await user.clear(nameField);
      await user.type(nameField, 'openai_api_key');
      await waitFor(() => {
        expect(screen.queryByText(invalidMessage)).not.toBeInTheDocument();
        expect(save).toBeEnabled();
      });
      expect(mockSetMutateAsync).not.toHaveBeenCalled();
    });
  });

  // The Edit affordance reuses the same `setProjectSecret` upsert as Add, but
  // the name (the env-var key agents resolve) is fixed: the dialog only
  // re-collects the value (and description). There is no reveal — the stored
  // value is never returned to the client — so Edit re-encrypts a new value.
  describe('edit', () => {
    it('opens Edit prefilled with the fixed name and re-saves under that name', async () => {
      secretsFixture = [
        { name: 'E2E_DEPTH_SECRET_ABC', description: 'old description' },
      ];
      const { user } = renderTab();

      const row = screen
        .getByText('E2E_DEPTH_SECRET_ABC')
        .closest('li') as HTMLElement;
      await user.click(within(row).getByRole('button', { name: 'Edit' }));

      const dialog = await screen.findByRole('dialog', { name: 'Edit secret' });
      expect(dialog).toBeInTheDocument();

      // The name is the env-var key agents resolve — it's prefilled and fixed
      // (disabled) so editing can't orphan references.
      const nameInput = screen.getByLabelText('Name', { exact: false });
      expect(nameInput).toHaveValue('E2E_DEPTH_SECRET_ABC');
      expect(nameInput).toBeDisabled();

      // In edit mode the type stays "custom" and the value field is labelled
      // "Value"; the type selector is not offered.
      expect(
        screen.queryByLabelText('Type', { exact: false }),
      ).not.toBeInTheDocument();

      await user.type(
        screen.getByLabelText('Value', { exact: false }),
        'rotated-secret-value',
      );
      await user.click(screen.getByRole('button', { name: 'Save' }));

      // The upsert is called with the ORIGINAL (fixed) name + the new value.
      await waitFor(() => {
        expect(mockSetMutateAsync).toHaveBeenCalledTimes(1);
      });
      expect(mockSetMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          projectId: PROJECT_ID,
          name: 'E2E_DEPTH_SECRET_ABC',
          value: 'rotated-secret-value',
        }),
      );
    });

    it('does not leave the next Add dialog stuck in edit mode after closing', async () => {
      secretsFixture = [{ name: 'E2E_DEPTH_SECRET_ABC' }];
      const { user } = renderTab();

      const row = screen
        .getByText('E2E_DEPTH_SECRET_ABC')
        .closest('li') as HTMLElement;
      await user.click(within(row).getByRole('button', { name: 'Edit' }));

      await screen.findByRole('dialog', { name: 'Edit secret' });
      await user.type(
        screen.getByLabelText('Value', { exact: false }),
        'rotated-secret-value',
      );
      await user.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(mockSetMutateAsync).toHaveBeenCalledTimes(1);
      });

      // The save resets the form (clearing editingName), so the next Add opens a
      // fresh create dialog: the title is "Add secret", the type selector is back
      // and the name field is empty and enabled.
      await user.click(screen.getByRole('button', { name: 'Add secret' }));
      const addDialog = await screen.findByRole('dialog', {
        name: 'Add secret',
      });
      expect(addDialog).toBeInTheDocument();
      expect(
        screen.getByLabelText('Type', { exact: false }),
      ).toBeInTheDocument();
      const nameInput = screen.getByLabelText('Name', { exact: false });
      expect(nameInput).toHaveValue('');
      expect(nameInput).toBeEnabled();
    });
  });

  describe('overwrite protection', () => {
    it('warns and blocks Save until the user confirms when the name collides with an existing secret', async () => {
      secretsFixture = [{ name: 'EXISTING_SECRET' }];
      const { user } = renderTab();

      await user.click(screen.getByRole('button', { name: 'Add secret' }));
      await screen.findByRole('dialog', { name: 'Add secret' });

      // No warning until a colliding name is typed.
      expect(screen.queryByText('Name already in use')).not.toBeInTheDocument();

      await user.type(
        screen.getByLabelText('Name', { exact: false }),
        'existing_secret',
      );
      await user.type(
        screen.getByLabelText('API key', { exact: false }),
        'replacement-value',
      );

      // The collision is surfaced and the submit button becomes "Overwrite".
      expect(screen.getByText('Name already in use')).toBeInTheDocument();
      const overwriteButton = screen.getByRole('button', { name: 'Overwrite' });
      expect(overwriteButton).toBeDisabled();

      // Clicking while unconfirmed must not persist anything.
      await user.click(overwriteButton);
      expect(mockSetMutateAsync).not.toHaveBeenCalled();

      // Confirming the overwrite enables the submit and lets the save through.
      await user.click(
        screen.getByRole('checkbox', { name: 'Overwrite the existing secret' }),
      );
      expect(overwriteButton).toBeEnabled();
      await user.click(overwriteButton);

      await waitFor(() => {
        expect(mockSetMutateAsync).toHaveBeenCalledTimes(1);
      });
      expect(mockSetMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'EXISTING_SECRET' }),
      );
    });

    it('does not warn when the name does not collide with an existing secret', async () => {
      secretsFixture = [{ name: 'EXISTING_SECRET' }];
      const { user } = renderTab();

      await user.click(screen.getByRole('button', { name: 'Add secret' }));
      await screen.findByRole('dialog', { name: 'Add secret' });

      await user.type(
        screen.getByLabelText('Name', { exact: false }),
        'fresh_secret',
      );

      expect(screen.queryByText('Name already in use')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    });
  });

  describe('save error handling', () => {
    async function fillAndSave(user: ReturnType<typeof renderTab>['user']) {
      await user.click(screen.getByRole('button', { name: 'Add secret' }));
      await screen.findByRole('dialog', { name: 'Add secret' });
      await user.type(
        screen.getByLabelText('Name', { exact: false }),
        'my_secret',
      );
      await user.type(
        screen.getByLabelText('API key', { exact: false }),
        'some-secret-value',
      );
      await user.click(screen.getByRole('button', { name: 'Save' }));
    }

    const cases: { error: unknown; title: string }[] = [
      {
        error: new ConvexError({ code: 'SECRET_NAME_INVALID' }),
        title:
          'Secret names must start with a letter and contain only uppercase letters, numbers, and underscores (max 64 characters).',
      },
      {
        error: new ConvexError({ code: 'SECRET_VALUE_INVALID' }),
        title: 'Enter a secret value between 1 and 8192 characters.',
      },
      {
        error: new ConvexError({ code: 'PROJECT_FORBIDDEN' }),
        title:
          "You don't have access to this project's secrets. Only project administrators can view or manage them.",
      },
      {
        error: new ConvexError({ code: 'PROJECT_NOT_FOUND' }),
        title: 'This project no longer exists.',
      },
      {
        error: new Error('Missing ENCRYPTION_SECRET_HEX environment variable'),
        title:
          "Secret encryption isn't set up on this server (ENCRYPTION_SECRET_HEX is missing). Run `tale init`, then try again.",
      },
      {
        error: new Error('boom'),
        title: 'Something went wrong. Please try again.',
      },
    ];

    for (const { error, title } of cases) {
      const label =
        error instanceof ConvexError
          ? // oxlint-disable-next-line typescript/no-unsafe-member-access -- test fixture code
            (error.data.code as string)
          : (error as Error).message;
      it(`maps a ${label} failure to its translated toast`, async () => {
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        mockSetMutateAsync.mockRejectedValueOnce(error);
        const { user } = renderTab();

        await fillAndSave(user);

        await waitFor(() => {
          expect(mockToast).toHaveBeenCalledWith(
            expect.objectContaining({ title, variant: 'destructive' }),
          );
        });
        expect(mockToast).not.toHaveBeenCalledWith(
          expect.objectContaining({ variant: 'success' }),
        );
        errSpy.mockRestore();
      });
    }
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
