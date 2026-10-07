import { loadLocale } from '@tale/ui/i18n/load-locale';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { AppError } from '@/lib/shared/errors/app-error';
import { checkAccessibility } from '@/tests/utils/a11y';
import { i18n } from '@/tests/utils/i18n-all-languages';
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

let projectFixture: { archivedAt?: number } | null = { archivedAt: undefined };
vi.mock('../hooks/queries', () => ({
  useProject: () => ({ project: projectFixture, isLoading: false }),
}));

// A failed read here has never answered; its generic case runs for real in
// project-secrets-tab.read-failure.test.tsx.
vi.mock('../hooks/secrets', () => ({
  useProjectSecrets: () => ({
    secrets: secretsFixture,
    isLoading: false,
    error: secretsErrorFixture,
    isError: secretsErrorFixture !== undefined,
    unavailable: secretsErrorFixture !== undefined,
    stale: false,
    retrying: false,
    failureCount: secretsErrorFixture !== undefined ? 1 : 0,
    retry: vi.fn(),
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
vi.mock('@tale/ui/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
  useToast: () => ({ toast: mockToast }),
}));

// The DeleteDialog's error boundary reads the org id from the router; outside a
// RouterProvider that hook throws, so stub it like the other dialog tests.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

const PROJECT_ID = 'proj-1' as string;

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
  beforeEach(async () => {
    localStorage.setItem('user-locale', 'en');
    await i18n.changeLanguage('en');
    vi.clearAllMocks();
    secretsFixture = [];
    secretsErrorFixture = undefined;
    projectFixture = { archivedAt: undefined };
  });

  afterEach(async () => {
    localStorage.removeItem('user-locale');
    await i18n.changeLanguage('en');
  });

  describe('archived project', () => {
    it('shows the read-only banner and disables every write control', async () => {
      projectFixture = { archivedAt: 1_700_000_000_000 };
      secretsFixture = [{ name: 'OPENAI_API_KEY' }];
      const { container } = renderTab();

      expect(screen.getByText('This project is archived')).toBeInTheDocument();
      expect(
        screen.getByRole('button', {
          name: i18n.t('add', { ns: 'envEditor' }),
        }),
      ).toBeDisabled();
      expect(screen.getByDisplayValue('OPENAI_API_KEY')).toBeDisabled();
      expect(mockSetMutateAsync).not.toHaveBeenCalled();

      await checkAccessibility(container, NO_HEADING_ORDER);
    });
  });

  describe('rendering', () => {
    it('shows the Environment heading, agent-access notice, and an Add control', async () => {
      const { container } = renderTab();

      expect(
        screen.getByRole('heading', {
          name: i18n.t('title', { ns: 'projectSecrets' }),
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(i18n.t('agentAccessTitle', { ns: 'projectSecrets' })),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', {
          name: i18n.t('add', { ns: 'envEditor' }),
        }),
      ).toBeInTheDocument();

      expect(
        screen.getByText(i18n.t('description', { ns: 'projectSecrets' })),
      ).toBeInTheDocument();
      expect(
        screen.getByText(i18n.t('agentAccessBody', { ns: 'projectSecrets' })),
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
      // The session door's 401 (a lapsed session), not the Convex-era
      // `UNAUTHENTICATED` nothing answers any more.
      ['UNAUTHORIZED', /Only project administrators/],
    ])('shows the access notice and no editor for %s', (code, body) => {
      secretsErrorFixture = new AppError({ code });
      renderTab();

      expect(screen.getByText('Admin access required')).toBeInTheDocument();
      expect(screen.getByText(body)).toBeInTheDocument();
      // The dead-end affordances are gone: no editor, no agent-access notice.
      expect(
        screen.queryByRole('button', {
          name: i18n.t('add', { ns: 'envEditor' }),
        }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(
          i18n.t('agentAccessTitle', { ns: 'projectSecrets' }),
        ),
      ).not.toBeInTheDocument();
    });
  });

  describe('save wiring', () => {
    it('calls setProjectSecret with the typed name + value on Save', async () => {
      const { user } = renderTab();

      await user.click(
        screen.getByRole('button', {
          name: i18n.t('add', { ns: 'envEditor' }),
        }),
      );
      await user.type(
        screen.getByPlaceholderText(
          i18n.t('keyPlaceholder', { ns: 'envEditor' }),
        ),
        'MY_SECRET',
      );
      await user.type(
        screen.getByPlaceholderText(
          i18n.t('valuePlaceholder', { ns: 'envEditor' }),
        ),
        'super-secret',
      );
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

  it.each(['en', 'de', 'fr', 'de-CH'])(
    'attaches the invalid name error to the field and clears it in %s',
    async (locale) => {
      // AppShell's client locale bridge reads the saved preference on mount.
      localStorage.setItem('user-locale', locale);
      await loadLocale(i18n, locale);
      await i18n.changeLanguage(locale);
      const { user } = renderTab();
      await user.click(
        screen.getByRole('button', {
          name: i18n.t('add', { ns: 'envEditor' }),
        }),
      );
      const input = screen.getByPlaceholderText(
        i18n.t('keyPlaceholder', { ns: 'envEditor' }),
      );
      await user.type(input, '_TOKEN');
      await user.click(
        screen.getByRole('button', {
          name: i18n.t('save', { ns: 'envEditor' }),
        }),
      );
      expect(input).toHaveAttribute('aria-invalid', 'true');
      const message = i18n.t('projectSecretBadKey', {
        ns: 'envEditor',
        key: '_TOKEN',
      });
      const error = screen.getByText(message);
      expect(error).toBeVisible();
      expect(error).toHaveAttribute('role', 'alert');
      expect(input.getAttribute('aria-describedby')?.split(' ')).toContain(
        error.id,
      );
      expect(mockSetMutateAsync).not.toHaveBeenCalled();
      expect(mockDeleteMutateAsync).not.toHaveBeenCalled();
      await user.clear(input);
      await user.type(input, 'TOKEN');
      expect(input).not.toHaveAttribute('aria-invalid');
      expect(input).not.toHaveAttribute('aria-describedby');
      expect(screen.queryByText(message)).not.toBeInTheDocument();
      if (locale === 'de-CH') {
        expect(message).toContain('Grossbuchstaben');
        expect(
          i18n.t('errors.SECRET_NAME_INVALID', { ns: 'projectSecrets' }),
        ).toContain('Grossbuchstaben');
      }
      await user.click(
        screen.getByRole('button', {
          name: i18n.t('save', { ns: 'envEditor' }),
        }),
      );
      await waitFor(() => expect(mockSetMutateAsync).toHaveBeenCalledTimes(1));
    },
  );

  describe('localized name refusal', () => {
    it.each(['en', 'de', 'fr'])(
      'shows SECRET_NAME_INVALID in %s',
      async (locale) => {
        localStorage.setItem('user-locale', locale);
        await i18n.changeLanguage(locale);
        mockSetMutateAsync.mockRejectedValueOnce(
          new AppError({ code: 'SECRET_NAME_INVALID' }),
        );
        const { user } = renderTab();
        await user.click(
          screen.getByRole('button', {
            name: i18n.t('add', { ns: 'envEditor' }),
          }),
        );
        await user.type(
          screen.getByPlaceholderText(
            i18n.t('keyPlaceholder', { ns: 'envEditor' }),
          ),
          'TOKEN',
        );
        await user.type(
          screen.getByPlaceholderText(
            i18n.t('valuePlaceholder', { ns: 'envEditor' }),
          ),
          'secret',
        );
        await user.click(
          screen.getByRole('button', {
            name: i18n.t('save', { ns: 'envEditor' }),
          }),
        );
        await waitFor(() =>
          expect(mockToast).toHaveBeenCalledWith({
            title: i18n.t('saveError', { ns: 'envEditor' }),
            description: i18n.t('errors.SECRET_NAME_INVALID', {
              ns: 'projectSecrets',
            }),
            variant: 'destructive',
          }),
        );
        expect(mockToast).toHaveBeenCalledTimes(1);
      },
    );
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
