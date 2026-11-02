import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runAdapted } from '@/app/lib/backend/adapters';
import { backendApiErrorFromBody } from '@/app/lib/backend/api-client';
import type { GithubAppRepositories } from '@/app/lib/backend/contract/connector-credentials';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import type {
  ConnectorSummary,
  MaskedConnectorCredential,
} from '../hooks/backend';
import { ConnectorsSettings } from './connectors-settings';

/**
 * The organization's own GitHub App on the connectors settings page: its
 * registration from the add dialog, its installation from its row, and the
 * repositories it reaches. Every hand-off is a full-page navigation to the
 * deployment's GitHub App routes, observed here through `leavePageFor`; the
 * reads are stubbed at the module boundary, as on the page's own suite.
 */

const leavePageFor = vi.hoisted(() => vi.fn());
const createCredential = vi.hoisted(() => vi.fn());
const refetchRepositories = vi.hoisted(() => vi.fn());
const toastSpy = vi.hoisted(() => vi.fn());

const fixtures = vi.hoisted(() => ({
  connectors: [] as unknown[],
  credentials: [] as unknown[],
}));
const repositories = vi.hoisted(() => ({
  query: {} as unknown,
  requested: [] as Array<[string, string]>,
}));
const abilityState = vi.hoisted(() => ({ admin: true }));

vi.mock('../hooks/queries', () => ({
  useConnectors: () => ({
    data: fixtures.connectors,
    isPending: false,
    isError: false,
    error: null,
  }),
  useConnectorCredentials: () => ({
    data: fixtures.credentials,
    isPending: false,
    isError: false,
    error: null,
  }),
}));

vi.mock('../hooks/oauth-apps', () => ({
  useConnectorOauthApps: () => ({
    data: [],
    isPending: false,
    isError: false,
    error: null,
  }),
  useCloudImportAppStatus: () => ({
    data: { configured: false, source: null },
    isPending: false,
    isError: false,
    error: null,
  }),
  useUpsertConnectorOauthApp: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useRemoveConnectorOauthApp: () => ({ mutate: vi.fn(), isPending: false }),
  useEntraSsoSource: () => ({
    data: { available: false, reason: 'no_sso' },
    isPending: false,
    isError: false,
    error: null,
  }),
  useReuseSsoOauthApp: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('../hooks/mutations', () => ({
  useCreateCredential: () => ({
    mutateAsync: createCredential,
    isPending: false,
  }),
  useUpdateCredential: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteCredential: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetDefaultCredential: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

// The repositories are read live from GitHub, and only by the open dialog.
vi.mock('../hooks/github-app', () => ({
  useGithubAppRepositories: (organizationId: string, credentialId: string) => {
    repositories.requested.push([organizationId, credentialId]);
    return repositories.query;
  },
}));

// The real URLs, a recorded navigation.
vi.mock('../connector-github-app', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../connector-github-app')>()),
  leavePageFor,
}));

vi.mock('../connector-oauth', () => ({ goToAuthorization: vi.fn() }));

// The suggested app name follows the organization's.
vi.mock('@/app/features/organization/hooks/queries', () => ({
  useOrganization: () => ({ data: { name: 'Acme' }, isError: false }),
}));

vi.mock('@/app/hooks/use-url-state', () => {
  const React = require('react') as typeof import('react');
  return {
    useUrlState: () => {
      const [open, setOpen] = React.useState<string | null>(null);
      return {
        state: { connector: open },
        setState: (_key: string, value: string | null) => setOpen(value),
        setStates: () => {},
        clearState: () => {},
        clearAll: () => {},
        isPending: false,
      };
    },
  };
});

// A developer who is an organization admin by default; the admin-only
// affordances are what a test flips off.
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: (_action: string, subject: string) =>
      subject === 'orgSettings' ? abilityState.admin : true,
    cannot: (_action: string, subject: string) =>
      subject === 'orgSettings' ? !abilityState.admin : false,
  }),
  useAbilityLoading: () => false,
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

vi.mock('@tale/ui/use-toast', () => ({
  toast: toastSpy,
  useToast: () => ({ toast: toastSpy }),
}));

const githubConnector: ConnectorSummary = {
  slug: 'github',
  displayName: 'GitHub',
  description: 'Manage repositories, issues, and pull requests on GitHub.',
  tags: ['Developer'],
  endpointMode: 'fixed',
  authMethods: ['bearer', 'github-app'],
  configFields: [],
  actionCount: 4,
  iconUrl: '/api/connectors/github/icon.svg',
  githubAppPermissions: {
    pull_requests: 'write',
    contents: 'write',
    metadata: 'read',
  },
};

const REGISTER_URL =
  'https://tale.example/tale/api/connectors/github-app/register';
const INSTALL_URL =
  'https://tale.example/tale/api/connectors/github-app/install?organizationId=org-1&credentialId=cred-app';
const CONFIGURE_URL =
  'https://github.com/organizations/acme-labs/settings/installations/987';

const installation = {
  id: 987,
  account: 'acme-labs',
  accountType: 'Organization',
  repositorySelection: 'selected',
} as const;

/** A `github-app` credential: registered, and installed only if given an
 * installation. */
function githubAppCredential(
  overrides: Partial<MaskedConnectorCredential> = {},
  app: { installation?: typeof installation } = {},
): MaskedConnectorCredential {
  return {
    id: 'cred-app',
    name: 'Release app',
    connectorSlug: 'github',
    authMethod: 'github-app',
    isDefault: true,
    status: app.installation === undefined ? 'needs-reauth' : 'active',
    createdAt: 1,
    updatedAt: 1,
    githubApp: {
      appId: 123456,
      clientId: 'Iv23liAcme',
      slug: 'tale-acme',
      owner: 'acme-labs',
      ...app,
    },
    ...overrides,
  } as unknown as MaskedConnectorCredential;
}

function listing(
  overrides: Partial<GithubAppRepositories> = {},
): GithubAppRepositories {
  return {
    account: 'acme-labs',
    accountType: 'Organization',
    repositorySelection: 'selected',
    totalCount: 2,
    repositories: [
      {
        fullName: 'acme-labs/api',
        private: true,
        htmlUrl: 'https://github.com/acme-labs/api',
      },
      {
        fullName: 'acme-labs/docs',
        private: false,
        htmlUrl: 'https://github.com/acme-labs/docs',
      },
    ],
    truncated: false,
    configureUrl: CONFIGURE_URL,
    ...overrides,
  };
}

function loaded(data: GithubAppRepositories) {
  return {
    data,
    isPending: false,
    isError: false,
    error: null,
    isFetching: false,
    refetch: refetchRepositories,
  };
}

type User = Awaited<ReturnType<typeof render>>['user'];

/** Open the add flow on GitHub, returning the dialog and its GitHub App
 * group. */
async function openGithubSetup(user: User) {
  await user.click(screen.getByRole('button', { name: 'Add credential' }));
  const dialog = await screen.findByRole('dialog', { name: 'Add credential' });
  await user.click(within(dialog).getByRole('button', { name: /GitHub/ }));
  return {
    dialog,
    group: within(
      within(dialog).getByRole('group', { name: 'Register a GitHub App' }),
    ),
  };
}

/** Open a row's action menu. */
async function openRowMenu(user: User, name: string) {
  await user.click(screen.getByRole('button', { name: `Actions for ${name}` }));
  return within(await screen.findByRole('menu'));
}

/** Open the installed app's repositories. */
async function openRepositories(user: User) {
  await user.click(screen.getByRole('button', { name: 'Show repositories' }));
  return screen.findByRole('dialog', {
    name: 'Repositories this app reaches',
  });
}

describe('ConnectorsSettings — the GitHub App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.__ENV__ = { SITE_URL: 'https://tale.example', BASE_PATH: '/tale' };
    abilityState.admin = true;
    fixtures.connectors = [githubConnector];
    fixtures.credentials = [];
    repositories.query = loaded(listing());
    repositories.requested = [];
  });
  afterEach(() => {
    delete window.__ENV__;
  });

  describe('registering it', () => {
    it('offers the app beside the token, with the permissions it asks for', async () => {
      const { user } = render(<ConnectorsSettings organizationId="org-1" />);
      const { dialog, group } = await openGithubSetup(user);

      expect(
        group.getByRole('textbox', { name: /^Credential name/ }),
      ).toHaveValue('GitHub');
      expect(
        group.getByRole('textbox', { name: /^App name on GitHub/ }),
      ).toHaveValue('Tale Acme');
      const owner = group.getByRole('textbox', {
        name: /^GitHub organization/,
      });
      expect(owner).toHaveValue('');
      expect(owner).toHaveAccessibleDescription(
        'Leave empty to register the app on your personal GitHub account. To register it for a GitHub organization, enter its login — you must be an owner of it.',
      );
      expect(group.getByText('The app asks GitHub for:')).toBeInTheDocument();
      const permissions = group
        .getAllByRole('term')
        .map((term) => [
          term.textContent,
          term.nextElementSibling?.textContent,
        ]);
      expect(permissions).toEqual([
        ['contents', 'Read and write'],
        ['metadata', 'Read-only'],
        ['pull_requests', 'Read and write'],
      ]);
      // Nothing changes for a token.
      expect(
        within(dialog).getByLabelText(/^Token/, { selector: 'input' }),
      ).toBeInTheDocument();

      await checkAccessibility(dialog);
    });

    it('sends the browser to the register route with the details encoded', async () => {
      const { user } = render(<ConnectorsSettings organizationId="org-1" />);
      const { group } = await openGithubSetup(user);

      await user.click(
        group.getByRole('button', { name: 'Register on GitHub' }),
      );
      expect(leavePageFor).toHaveBeenLastCalledWith(
        `${REGISTER_URL}?organizationId=org-1&connectorSlug=github&credentialName=GitHub&appName=Tale+Acme`,
      );

      const name = group.getByRole('textbox', { name: /^Credential name/ });
      await user.clear(name);
      await user.type(name, ' Release & ops ');
      const appName = group.getByRole('textbox', {
        name: /^App name on GitHub/,
      });
      await user.clear(appName);
      await user.type(appName, 'Tale Zürich');
      await user.type(
        group.getByRole('textbox', { name: /^GitHub organization/ }),
        'acme-labs',
      );
      await user.click(
        group.getByRole('button', { name: 'Register on GitHub' }),
      );
      expect(leavePageFor).toHaveBeenLastCalledWith(
        `${REGISTER_URL}?organizationId=org-1&connectorSlug=github&credentialName=Release+%26+ops&appName=Tale+Z%C3%BCrich&owner=acme-labs`,
      );
      expect(leavePageFor).toHaveBeenCalledTimes(2);
      // The credential is stored when GitHub hands the app back, never here.
      expect(createCredential).not.toHaveBeenCalled();
    });

    it('holds back what the route would refuse, focusing the field to fix', async () => {
      fixtures.credentials = [
        githubAppCredential({ id: 'cred-pat', name: 'Platform bot' }),
      ];
      const { user } = render(<ConnectorsSettings organizationId="org-1" />);
      const { group } = await openGithubSetup(user);
      const register = group.getByRole('button', {
        name: 'Register on GitHub',
      });

      // Taken, compared trimmed and case-insensitively as the server does.
      const name = group.getByRole('textbox', { name: /^Credential name/ });
      await user.clear(name);
      await user.type(name, ' platform BOT ');
      await user.click(register);
      expect(name).toHaveFocus();
      expect(name).toHaveAccessibleDescription(
        /Another credential already uses this name\. Choose a different one\./,
      );

      await user.clear(name);
      await user.type(name, 'Release app');
      const appName = group.getByRole('textbox', {
        name: /^App name on GitHub/,
      });
      await user.clear(appName);
      await user.click(register);
      expect(appName).toHaveFocus();
      expect(
        group.getByText("Enter the app's name, at most 34 characters."),
      ).toBeInTheDocument();

      await user.type(appName, 'Tale Acme');
      const owner = group.getByRole('textbox', {
        name: /^GitHub organization/,
      });
      await user.type(owner, '-acme');
      await user.click(register);
      expect(owner).toHaveFocus();
      expect(
        group.getByText(
          "Enter the organization's login as it appears in its GitHub URL: letters, digits and single hyphens.",
        ),
      ).toBeInTheDocument();
      expect(leavePageFor).not.toHaveBeenCalled();

      await user.clear(owner);
      await user.type(owner, 'acme');
      await user.click(register);
      expect(leavePageFor).toHaveBeenCalledWith(
        `${REGISTER_URL}?organizationId=org-1&connectorSlug=github&credentialName=Release+app&appName=Tale+Acme&owner=acme`,
      );
    });

    it('tells a member who is no admin why there is nothing to register', async () => {
      abilityState.admin = false;
      const { user } = render(<ConnectorsSettings organizationId="org-1" />);
      const { dialog, group } = await openGithubSetup(user);

      expect(
        group.getByText(
          'Only organization admins can register and install a GitHub App. Ask an admin to set one up.',
        ),
      ).toBeInTheDocument();
      expect(
        group.queryByRole('button', { name: 'Register on GitHub' }),
      ).not.toBeInTheDocument();
      expect(group.queryByRole('textbox')).not.toBeInTheDocument();
      // A token is still theirs to add.
      expect(
        within(dialog).getByLabelText(/^Token/, { selector: 'input' }),
      ).toBeInTheDocument();
    });
  });

  describe('its row', () => {
    it('links a registered app and offers to install it — never to replace a secret', async () => {
      fixtures.credentials = [githubAppCredential()];
      const { user, container } = render(
        <ConnectorsSettings organizationId="org-1" />,
      );

      // Not installed yet is a step of its setup, not a sign-in gone stale:
      // a neutral badge of its own, never "Reconnect needed".
      expect(
        screen.getByText('Not installed').closest('[title="Not installed"]'),
      ).toHaveClass('bg-slate-100');
      expect(screen.queryByText('Reconnect needed')).not.toBeInTheDocument();
      const app = screen.getByRole('link', { name: 'App tale-acme' });
      expect(app).toHaveAttribute('href', 'https://github.com/apps/tale-acme');
      expect(app.closest('p')).toHaveTextContent(
        'App tale-acme · Registered on GitHub, not installed yet.',
      );
      expect(
        screen.queryByRole('button', { name: 'Show repositories' }),
      ).not.toBeInTheDocument();
      await checkAccessibility(container);

      const menu = await openRowMenu(user, 'Release app');
      expect(
        menu.queryByRole('menuitem', { name: 'Change repositories' }),
      ).not.toBeInTheDocument();
      expect(
        menu.queryByRole('menuitem', { name: /Replace/ }),
      ).not.toBeInTheDocument();
      expect(
        menu.queryByRole('menuitem', { name: 'Reconnect' }),
      ).not.toBeInTheDocument();
      expect(
        menu.getByRole('menuitem', { name: 'Delete' }),
      ).toBeInTheDocument();
      await user.click(
        menu.getByRole('menuitem', { name: 'Install on GitHub' }),
      );
      expect(leavePageFor).toHaveBeenCalledWith(INSTALL_URL);
      // The table never asks GitHub for anything.
      expect(repositories.requested).toEqual([]);
    });

    it('says where an installed app is, and changes its repositories on GitHub', async () => {
      fixtures.credentials = [githubAppCredential({}, { installation })];
      const { user } = render(<ConnectorsSettings organizationId="org-1" />);

      expect(
        screen.getByRole('link', { name: 'App tale-acme' }).closest('p'),
      ).toHaveTextContent(
        'App tale-acme · Installed on acme-labs · Show repositories',
      );
      // Healthy: no status badge beside its name.
      expect(screen.queryByText('Not installed')).not.toBeInTheDocument();
      expect(screen.queryByText('No longer installed')).not.toBeInTheDocument();

      const menu = await openRowMenu(user, 'Release app');
      expect(
        menu.queryByRole('menuitem', { name: 'Install on GitHub' }),
      ).not.toBeInTheDocument();
      expect(
        menu.queryByRole('menuitem', { name: /Replace/ }),
      ).not.toBeInTheDocument();
      await user.click(
        menu.getByRole('menuitem', { name: 'Change repositories' }),
      );
      expect(leavePageFor).toHaveBeenCalledWith(INSTALL_URL);
    });

    it('says an app is no longer installed, and offers to install it again', async () => {
      fixtures.credentials = [
        githubAppCredential({ status: 'needs-reauth' }, { installation }),
      ];
      const { user } = render(<ConnectorsSettings organizationId="org-1" />);

      // Its installation was removed on GitHub, which wants an admin: the
      // attention tone stays, but the badge names what broke — the app is
      // installed again, nobody signs in again.
      expect(
        screen
          .getByText('No longer installed')
          .closest('[title="No longer installed"]'),
      ).toHaveClass('bg-orange-100');
      expect(screen.queryByText('Reconnect needed')).not.toBeInTheDocument();
      expect(
        screen.getByText(/No longer installed on acme-labs\./),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Show repositories' }),
      ).not.toBeInTheDocument();
      const menu = await openRowMenu(user, 'Release app');
      expect(
        menu.getByRole('menuitem', { name: 'Install on GitHub' }),
      ).toBeInTheDocument();
    });

    it.each([
      ['registered', githubAppCredential()],
      ['installed', githubAppCredential({}, { installation })],
    ])(
      'keeps installing a %s app, and choosing its repositories, to admins',
      async (_state, credential) => {
        abilityState.admin = false;
        fixtures.credentials = [credential];
        const { user } = render(<ConnectorsSettings organizationId="org-1" />);

        const menu = await openRowMenu(user, 'Release app');
        expect(
          menu.queryByRole('menuitem', { name: 'Install on GitHub' }),
        ).not.toBeInTheDocument();
        expect(
          menu.queryByRole('menuitem', { name: 'Change repositories' }),
        ).not.toBeInTheDocument();
      },
    );

    it('lets every member read what the app reaches, and only an admin change it', async () => {
      abilityState.admin = false;
      fixtures.credentials = [githubAppCredential({}, { installation })];
      const { user } = render(<ConnectorsSettings organizationId="org-1" />);

      const dialog = within(await openRepositories(user));
      expect(
        dialog.getByRole('list', { name: 'Repositories this app reaches' }),
      ).toBeInTheDocument();
      expect(
        dialog.queryByRole('button', { name: 'Change repositories' }),
      ).not.toBeInTheDocument();
    });
  });

  describe('the repositories it reaches', () => {
    beforeEach(() => {
      fixtures.credentials = [githubAppCredential({}, { installation })];
    });

    it('lists them, marks the private ones and counts the rest', async () => {
      repositories.query = loaded(listing({ totalCount: 7, truncated: true }));
      const { user } = render(<ConnectorsSettings organizationId="org-1" />);
      expect(repositories.requested).toEqual([]);

      const dialog = await openRepositories(user);
      const panel = within(dialog);
      expect(dialog).toHaveAccessibleDescription('Installed on acme-labs');
      const items = within(
        panel.getByRole('list', { name: 'Repositories this app reaches' }),
      ).getAllByRole('listitem');
      expect(items).toHaveLength(2);
      expect(
        within(items[0]).getByRole('link', { name: 'acme-labs/api' }),
      ).toHaveAttribute('href', 'https://github.com/acme-labs/api');
      expect(items[0]).toHaveTextContent('Private');
      expect(
        within(items[1]).getByRole('link', { name: 'acme-labs/docs' }),
      ).toHaveAttribute('href', 'https://github.com/acme-labs/docs');
      expect(items[1]).not.toHaveTextContent('Private');
      expect(panel.getByText('and 5 more')).toBeInTheDocument();
      // A selection the installer chose is no warning.
      expect(
        panel.queryByText(/reaches every repository/),
      ).not.toBeInTheDocument();
      expect(repositories.requested).toContainEqual(['org-1', 'cred-app']);
      await checkAccessibility(dialog);

      await user.click(
        panel.getByRole('button', { name: 'Change repositories' }),
      );
      expect(leavePageFor).toHaveBeenCalledWith(INSTALL_URL);
    });

    it('[CONN-R38] warns when the app reaches every repository of the account, linking where to narrow it', async () => {
      repositories.query = loaded(listing({ repositorySelection: 'all' }));
      const { user } = render(<ConnectorsSettings organizationId="org-1" />);

      const dialog = await openRepositories(user);
      const warning = within(dialog).getByText(
        /This app reaches every repository of acme-labs/,
      );
      expect(warning).toHaveTextContent(
        'This app reaches every repository of acme-labs, including ones added later. Choose “Only select repositories” on GitHub to narrow it. Open on GitHub',
      );
      expect(
        within(warning).getByRole('link', { name: 'Open on GitHub' }),
      ).toHaveAttribute('href', CONFIGURE_URL);
      await checkAccessibility(dialog);
    });

    it('says so when the app reaches none', async () => {
      repositories.query = loaded(listing({ totalCount: 0, repositories: [] }));
      const { user } = render(<ConnectorsSettings organizationId="org-1" />);

      const dialog = within(await openRepositories(user));
      expect(
        dialog.getByText('The app reaches no repositories.'),
      ).toBeInTheDocument();
      expect(dialog.queryByRole('list')).not.toBeInTheDocument();
    });

    it('shows the read while it loads', async () => {
      repositories.query = {
        data: undefined,
        isPending: true,
        isError: false,
        error: null,
        isFetching: true,
        refetch: refetchRepositories,
      };
      const { user } = render(<ConnectorsSettings organizationId="org-1" />);

      const dialog = within(await openRepositories(user));
      expect(dialog.getByRole('status')).toHaveAttribute('aria-busy', 'true');
      expect(dialog.queryByRole('list')).not.toBeInTheDocument();
    });

    it.each([
      [
        'a refusal in the page’s own words',
        backendApiErrorFromBody(404, {
          error: 'CREDENTIAL_NOT_FOUND',
          message: 'Connector credential cred-app not found.',
        }),
        "Couldn't load the repositories. This credential was deleted in another session.",
      ],
      [
        'a disabled credential as the read failing, never as a default',
        backendApiErrorFromBody(400, {
          error: 'CREDENTIAL_DISABLED',
          message:
            'Credential "Release app" is disabled — enable it in Settings → Connectors, or name another credential.',
        }),
        "Couldn't load the repositories.",
      ],
      [
        'a fault as the read failing',
        backendApiErrorFromBody(502, {
          error: 'INTERNAL_ERROR',
          message: 'GitHub answered 502 Bad Gateway.',
        }),
        "Couldn't load the repositories.",
      ],
    ])('says %s, and retries the read', async (_case, failure, sentence) => {
      repositories.query = {
        data: undefined,
        isPending: false,
        isError: true,
        // What the read's adapted fetch rejects with.
        error: await runAdapted(() => Promise.reject(failure)).catch(
          (error: unknown) => error,
        ),
        isFetching: false,
        refetch: refetchRepositories,
      };
      const { user } = render(<ConnectorsSettings organizationId="org-1" />);

      const alert = within(await openRepositories(user)).getByRole('alert');
      // The whole sentence: the page's line, and the reason only it words.
      expect(within(alert).getByText(sentence)).toBeInTheDocument();
      expect(alert).not.toHaveTextContent(failure.message);
      await user.click(
        within(alert).getByRole('button', { name: 'Try again' }),
      );
      expect(refetchRepositories).toHaveBeenCalledTimes(1);
    });

    it('stays open when the read finds the app uninstalled, then returns focus to the app', async () => {
      repositories.query = {
        data: undefined,
        isPending: false,
        isError: true,
        // The read marks the credential, refusing in words that speak of
        // reconnecting, which a GitHub App cannot.
        error: await runAdapted(() =>
          Promise.reject(
            backendApiErrorFromBody(400, {
              error: 'CREDENTIAL_NEEDS_REAUTH',
              message:
                'Credential "Release app" lost its authorization (the GitHub App is no longer installed on GitHub) — reconnect "github" in Settings → Connectors to restore access.',
            }),
          ),
        ).catch((error: unknown) => error),
        isFetching: false,
        refetch: refetchRepositories,
      };
      const { user, rerender } = render(
        <ConnectorsSettings organizationId="org-1" />,
      );
      const dialog = await openRepositories(user);

      // The marked credential reaches the page's listing.
      fixtures.credentials = [
        githubAppCredential({ status: 'needs-reauth' }, { installation }),
      ];
      rerender(<ConnectorsSettings organizationId="org-1" />);

      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAccessibleDescription(
        'No longer installed on acme-labs.',
      );
      const alert = within(dialog).getByRole('alert');
      expect(
        within(alert).getByText("Couldn't load the repositories."),
      ).toBeInTheDocument();
      expect(alert).not.toHaveTextContent('reconnect');
      await user.click(
        within(dialog).getByRole('button', { name: 'Install on GitHub' }),
      );
      expect(leavePageFor).toHaveBeenCalledWith(INSTALL_URL);

      await user.keyboard('{Escape}');
      await waitFor(() =>
        expect(
          screen.getByRole('link', { name: 'App tale-acme' }),
        ).toHaveFocus(),
      );
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Show repositories' }),
      ).not.toBeInTheDocument();
    });
  });
});
