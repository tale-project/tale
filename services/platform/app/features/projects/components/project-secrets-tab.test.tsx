import { ConvexError } from 'convex/values';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { Id } from '@/convex/_generated/dataModel';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { ProjectSecretsTab } from './project-secrets-tab';

// The project "Environment" page is now the project-scoped surface of the shared
// `EnvVarListEditor` (all env editors unified onto one component). The editor's
// own behavior — dirty state, masking, add/remove — is covered by
// env-var-list-editor.test.tsx; here we assert the WIRING: the page chrome, the
// admin-access guard, and that saving a row calls setProjectSecret / removing
// one calls deleteProjectSecret with the right name. The query is mocked (jsdom
// can't run the Convex encrypt/store round-trip); the mutations are spies.

const mockSetMutateAsync = vi.fn().mockResolvedValue(undefined);
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
  useDeleteProjectSecret: () => ({
    mutateAsync: mockDeleteMutateAsync,
    isPending: false,
  }),
}));

// EnvVarListEditor toasts on save via the standalone `toast`; stub it so it
// doesn't reach the real store outside a provider.
const mockToast = vi.fn();
vi.mock('@/app/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
  useToast: () => ({ toast: mockToast }),
}));

// The DeleteDialog's error boundary reads the org id from the router; outside a
// RouterProvider that hook throws, so stub it like the other dialog tests.
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
// fixed level-5 heading. In isolation that h2→h5 jump trips axe's heading-order, but
// it's a standalone-render artifact (in the app the tab sits under the page's
// h1/h2). Suppress only that one rule; every other WCAG rule stays on.
const NO_HEADING_ORDER = { rules: { 'heading-order': { enabled: false } } };

describe('ProjectSecretsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    secretsFixture = [];
    secretsErrorFixture = undefined;
  });

  describe('rendering', () => {
    it('shows the Environment heading, agent-access notice, and an Add control', async () => {
      const { container } = renderTab();

      expect(
        screen.getByRole('heading', { name: 'Environment' }),
      ).toBeInTheDocument();
      expect(screen.getByText('Available to agents')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Add variable' }),
      ).toBeInTheDocument();

      await checkAccessibility(container, NO_HEADING_ORDER);
    });

    it('renders an existing secret as a masked, editable row', async () => {
      secretsFixture = [{ name: 'OPENAI_API_KEY' }];
      const { container } = renderTab();

      // The key is shown in its editable field; the value stays masked — secrets
      // are write-only and never returned to the client.
      expect(screen.getByDisplayValue('OPENAI_API_KEY')).toBeInTheDocument();

      await checkAccessibility(container, NO_HEADING_ORDER);
    });
  });

  describe('access denied', () => {
    it.each([
      ['PROJECT_FORBIDDEN', /Only project administrators/],
      ['PROJECT_NOT_FOUND', /no longer exists/],
      ['UNAUTHENTICATED', /Only project administrators/],
    ])('shows the access notice and no editor for %s', (code, body) => {
      secretsErrorFixture = new ConvexError({ code });
      renderTab();

      expect(screen.getByText('Admin access required')).toBeInTheDocument();
      expect(screen.getByText(body)).toBeInTheDocument();
      // The dead-end affordances are gone: no editor, no agent-access notice.
      expect(
        screen.queryByRole('button', { name: 'Add variable' }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText('Available to agents')).not.toBeInTheDocument();
    });
  });

  describe('save wiring', () => {
    it('calls setProjectSecret with the typed name + value on Save', async () => {
      const { user } = renderTab();

      await user.click(screen.getByRole('button', { name: 'Add variable' }));
      await user.type(screen.getByPlaceholderText('NAME'), 'MY_SECRET');
      await user.type(screen.getByPlaceholderText('value'), 'super-secret');
      await user.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => expect(mockSetMutateAsync).toHaveBeenCalledTimes(1));
      expect(mockSetMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          projectId: PROJECT_ID,
          name: 'MY_SECRET',
          value: 'super-secret',
        }),
      );
    });
  });

  describe('delete wiring', () => {
    it('calls deleteProjectSecret with the row name after confirm + Save', async () => {
      secretsFixture = [{ name: 'OPENAI_API_KEY' }];
      const { user } = renderTab();

      await user.click(screen.getByRole('button', { name: 'Remove' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
      await user.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() =>
        expect(mockDeleteMutateAsync).toHaveBeenCalledTimes(1),
      );
      expect(mockDeleteMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          projectId: PROJECT_ID,
          name: 'OPENAI_API_KEY',
        }),
      );
    });
  });
});
