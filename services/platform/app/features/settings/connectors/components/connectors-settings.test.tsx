import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

import type {
  ConnectorSummary,
  MaskedConnectorCredential,
} from '../hooks/backend';
import { ConnectorsSettings } from './connectors-settings';

/**
 * Component coverage for the connectors settings page.
 *
 * The catalog renders as cards from the (mocked) listing action; narrowing runs
 * over the loaded list; and everything actionable — the credential rows, the add
 * dialog, the consent hand-off — lives in the dialog one card opens. Credential
 * rows show masked values only, the two unhealthy statuses stay
 * distinguishable, and backend behaviour (encryption, method validation,
 * default swaps) stays with the convex tests: the hooks are stubbed at the
 * module boundary.
 */

const createCredential = vi.hoisted(() => vi.fn());
const updateCredential = vi.hoisted(() => vi.fn());
const deleteCredential = vi.hoisted(() => vi.fn());
const setDefaultCredential = vi.hoisted(() => vi.fn());
const goToAuthorization = vi.hoisted(() => vi.fn());
const toastSpy = vi.hoisted(() => vi.fn());

const fixtures = vi.hoisted(() => ({
  connectors: [] as unknown[],
  credentials: [] as unknown[],
  connectorsError: null as unknown,
  credentialsError: null as unknown,
}));

vi.mock('../hooks/queries', () => ({
  useConnectors: () => ({
    data: fixtures.connectors,
    isPending: false,
    isError: fixtures.connectorsError !== null,
    error: fixtures.connectorsError,
  }),
  useConnectorCredentials: () => ({
    data: fixtures.credentials,
    isPending: false,
    isError: fixtures.credentialsError !== null,
    error: fixtures.credentialsError,
  }),
}));

vi.mock('../hooks/mutations', () => ({
  useCreateCredential: () => ({
    mutateAsync: createCredential,
    isPending: false,
  }),
  useUpdateCredential: () => ({
    mutateAsync: updateCredential,
    isPending: false,
  }),
  useDeleteCredential: () => ({
    mutateAsync: deleteCredential,
    isPending: false,
  }),
  useSetDefaultCredential: () => ({
    mutateAsync: setDefaultCredential,
    isPending: false,
  }),
}));

// The consent hand-off is a real navigation in the app; here it is observed.
vi.mock('../connector-oauth', () => ({ goToAuthorization }));

// The open card lives in the URL. Backed by component state here so the page's
// behaviour is testable without a router; the real round trip (including the
// OAuth return) is verified in the browser.
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

// Developer by default; one test flips the capability off to assert the gate.
const abilityState = vi.hoisted(() => ({ canRead: true }));
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: () => abilityState.canRead,
    cannot: () => !abilityState.canRead,
  }),
  useAbilityLoading: () => false,
}));

// FormDialog reads the org id for its error boundary.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: toastSpy,
  useToast: () => ({ toast: toastSpy }),
}));

const githubConnector: ConnectorSummary = {
  slug: 'github',
  displayName: 'GitHub',
  description: 'Manage repositories, issues, and pull requests on GitHub.',
  tags: ['Developer'],
  endpointMode: 'fixed',
  authMethods: ['bearer'],
  actionCount: 4,
  iconUrl: '/api/connectors/github/icon.svg',
};

const slackConnector: ConnectorSummary = {
  slug: 'slack',
  displayName: 'Slack',
  description: 'Send messages and interact with channels in Slack.',
  tags: ['Messaging'],
  endpointMode: 'fixed',
  authMethods: ['oauth2'],
  actionCount: 6,
  iconUrl: '/api/connectors/slack/icon.svg',
};

const confluenceConnector: ConnectorSummary = {
  slug: 'confluence',
  displayName: 'Confluence',
  description: "Import Confluence Cloud pages into Tale's knowledge base.",
  tags: ['Knowledge'],
  endpointMode: 'per-credential',
  authMethods: ['basic'],
  actionCount: 2,
  iconUrl: '/api/connectors/confluence/icon.svg',
};

// WebDAV ships no icon — the catalog carries none and the card falls back.
const webdavConnector: ConnectorSummary = {
  slug: 'webdav',
  displayName: 'WebDAV Files',
  description:
    "Read, write, and list files in the organization's WebDAV store.",
  tags: ['Files'],
  endpointMode: 'fixed',
  authMethods: ['basic'],
  actionCount: 4,
};

function credential(
  overrides: Partial<Omit<MaskedConnectorCredential, 'id'>> & {
    id: string;
    name: string;
  },
): MaskedConnectorCredential {
  return {
    connectorSlug: 'github',
    authMethod: 'bearer',
    isDefault: false,
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as unknown as MaskedConnectorCredential;
}

const defaultCredentials: MaskedConnectorCredential[] = [
  credential({
    id: 'cred-1',
    name: 'Platform bot',
    maskedPreview: 'ghp_…4f2',
    isDefault: true,
  }),
  credential({
    id: 'cred-2',
    name: 'Release bot',
    maskedPreview: 'ghp_…9zz',
    status: 'disabled',
  }),
];

/** Open a connector's card and return its detail dialog. */
async function openCard(
  user: Awaited<ReturnType<typeof render>>['user'],
  name: string,
) {
  await user.click(screen.getByRole('button', { name: `Open ${name}` }));
  return within(await screen.findByRole('dialog', { name }));
}

describe('ConnectorsSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    abilityState.canRead = true;
    fixtures.connectors = [githubConnector, slackConnector];
    fixtures.credentials = [...defaultCredentials];
    fixtures.connectorsError = null;
    fixtures.credentialsError = null;
  });

  it('renders one card per shipped connector with its catalog facts', async () => {
    const { container } = render(<ConnectorsSettings organizationId="org-1" />);

    expect(screen.getByRole('heading', { name: 'GitHub' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Slack' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Manage repositories, issues, and pull requests on GitHub.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Developer')).toBeInTheDocument();
    expect(screen.getByText('4 actions')).toBeInTheDocument();
    // The card summarises how many credentials are held, without listing them.
    expect(screen.getByText('2 credentials')).toBeInTheDocument();
    // Radix Tabs points aria-controls at a lazily-mounted panel that does not
    // exist in JSDOM — a false positive, disabled the same way the shared
    // toolbar's own suite disables it.
    await checkAccessibility(container, {
      rules: { 'aria-valid-attr-value': { enabled: false } },
    });
  });

  it('renders a connector that ships no icon', () => {
    fixtures.connectors = [webdavConnector];
    fixtures.credentials = [];
    render(<ConnectorsSettings organizationId="org-1" />);
    expect(
      screen.getByRole('heading', { name: 'WebDAV Files' }),
    ).toBeInTheDocument();
  });

  it('lets a stale grant outrank the credential count on the card', () => {
    fixtures.credentials = [
      credential({
        id: 'cred-3',
        name: 'Workspace grant',
        connectorSlug: 'slack',
        authMethod: 'oauth2',
        status: 'needs-reauth',
      }),
    ];
    render(<ConnectorsSettings organizationId="org-1" />);
    // "1 credential" is reassuring but useless next to a broken grant.
    expect(screen.getByText('Reconnect needed')).toBeInTheDocument();
    expect(screen.queryByText('1 credential')).not.toBeInTheDocument();
  });

  describe('narrowing', () => {
    it('splits connected from available by whether any credential is held', async () => {
      const { user } = render(<ConnectorsSettings organizationId="org-1" />);

      await user.click(screen.getByRole('tab', { name: 'Connected' }));
      expect(
        screen.getByRole('heading', { name: 'GitHub' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: 'Slack' }),
      ).not.toBeInTheDocument();

      await user.click(screen.getByRole('tab', { name: 'Available' }));
      expect(
        screen.getByRole('heading', { name: 'Slack' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: 'GitHub' }),
      ).not.toBeInTheDocument();
    });

    it('searches name, description and tags', async () => {
      const { user } = render(<ConnectorsSettings organizationId="org-1" />);
      const search = screen.getByPlaceholderText('Search connectors…');

      await user.type(search, 'channels');
      expect(
        screen.getByRole('heading', { name: 'Slack' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: 'GitHub' }),
      ).not.toBeInTheDocument();

      await user.clear(search);
      await user.type(search, 'Messaging');
      expect(
        screen.getByRole('heading', { name: 'Slack' }),
      ).toBeInTheDocument();
    });

    it('offers the search reset — not a create CTA — when nothing matches', async () => {
      const { user } = render(<ConnectorsSettings organizationId="org-1" />);
      await user.type(
        screen.getByPlaceholderText('Search connectors…'),
        'nothing matches this',
      );
      expect(
        screen.getByRole('heading', { name: 'No results found' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: 'No connectors available' }),
      ).not.toBeInTheDocument();
    });

    it('narrows by tag', async () => {
      const { user } = render(<ConnectorsSettings organizationId="org-1" />);
      await user.click(screen.getByRole('combobox', { name: 'Tags' }));
      await user.click(
        await screen.findByRole('option', { name: 'Messaging' }),
      );
      expect(
        screen.getByRole('heading', { name: 'Slack' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: 'GitHub' }),
      ).not.toBeInTheDocument();
    });
  });

  describe('the dialog a card opens', () => {
    it('lists the credentials with masked values only', async () => {
      const { user } = render(<ConnectorsSettings organizationId="org-1" />);
      const dialog = await openCard(user, 'GitHub');

      expect(dialog.getByText('Platform bot')).toBeInTheDocument();
      expect(dialog.getByText('ghp_…4f2')).toBeInTheDocument();
      expect(dialog.getByText('Default')).toBeInTheDocument();
      expect(dialog.getByText('Disabled')).toBeInTheDocument();
    });

    it('warns when credentials exist but none is the default', async () => {
      fixtures.credentials = [
        credential({ id: 'cred-1', name: 'Platform bot' }),
      ];
      const { user } = render(<ConnectorsSettings organizationId="org-1" />);
      const dialog = await openCard(user, 'GitHub');
      expect(dialog.getByText(/No default credential/)).toBeInTheDocument();
    });

    it('keeps a disabled credential neutral and a stale grant actionable', async () => {
      fixtures.connectors = [slackConnector];
      fixtures.credentials = [
        credential({
          id: 'cred-3',
          name: 'Workspace grant',
          connectorSlug: 'slack',
          authMethod: 'oauth2',
          status: 'needs-reauth',
          statusDetail: 'refresh_token expired',
        }),
      ];
      const { user } = render(<ConnectorsSettings organizationId="org-1" />);
      const dialog = await openCard(user, 'Slack');

      expect(dialog.getByText(/refresh_token expired/)).toBeInTheDocument();
      await user.click(
        dialog.getByRole('button', { name: 'Actions for Workspace grant' }),
      );
      const menu = within(await screen.findByRole('menu'));
      // Re-running consent is the only thing that fixes it; there is no
      // hand-entered secret to replace.
      expect(
        menu.getByRole('menuitem', { name: 'Reconnect' }),
      ).toBeInTheDocument();
      expect(
        menu.queryByRole('menuitem', { name: /Replace/ }),
      ).not.toBeInTheDocument();
    });

    it('joins an OAuth-only connector through consent instead of a form', async () => {
      fixtures.connectors = [slackConnector];
      fixtures.credentials = [];
      const { user } = render(<ConnectorsSettings organizationId="org-1" />);
      const dialog = await openCard(user, 'Slack');

      expect(
        dialog.queryByRole('button', { name: 'Add credential' }),
      ).not.toBeInTheDocument();
      await user.click(dialog.getByRole('button', { name: 'Connect' }));
      expect(goToAuthorization).toHaveBeenCalledWith('org-1', 'slack');
      expect(createCredential).not.toHaveBeenCalled();
    });

    it('creates a bearer credential without ever rendering the secret', async () => {
      fixtures.credentials = [];
      const { user } = render(<ConnectorsSettings organizationId="org-1" />);
      const dialog = await openCard(user, 'GitHub');
      await user.click(dialog.getByRole('button', { name: 'Add credential' }));

      const form = within(
        await screen.findByRole('dialog', { name: 'Add credential' }),
      );
      await user.type(form.getByRole('textbox', { name: /^Name/ }), 'CI bot');
      await user.type(
        form.getByLabelText(/^Token/, { selector: 'input' }),
        'ghp_supersecret',
      );
      await user.click(form.getByRole('button', { name: 'Add credential' }));

      expect(createCredential).toHaveBeenCalledWith({
        organizationId: 'org-1',
        connectorSlug: 'github',
        authMethod: 'bearer',
        name: 'CI bot',
        token: 'ghp_supersecret',
      });
      expect(screen.queryByText('ghp_supersecret')).not.toBeInTheDocument();
      expect(screen.queryByDisplayValue('ghp_supersecret')).toBeNull();
    });

    it('asks a per-credential connector for its instance URL', async () => {
      fixtures.connectors = [confluenceConnector];
      fixtures.credentials = [];
      const { user } = render(<ConnectorsSettings organizationId="org-1" />);
      const dialog = await openCard(user, 'Confluence');
      await user.click(dialog.getByRole('button', { name: 'Add credential' }));

      const form = within(
        await screen.findByRole('dialog', { name: 'Add credential' }),
      );
      await user.type(
        form.getByRole('textbox', { name: /^Name/ }),
        'Docs site',
      );
      await user.type(
        form.getByLabelText(/^Username/, { selector: 'input' }),
        'bot@example.com',
      );
      await user.type(
        form.getByLabelText(/^Password/, { selector: 'input' }),
        'api-token',
      );
      const submit = form.getByRole('button', { name: 'Add credential' });
      // The instance is not optional for this connector.
      expect(submit).toBeDisabled();

      await user.type(
        form.getByRole('textbox', { name: /^Instance|^Endpoint/ }),
        'https://acme.atlassian.net',
      );
      await user.click(submit);
      expect(createCredential).toHaveBeenCalledWith({
        organizationId: 'org-1',
        connectorSlug: 'confluence',
        authMethod: 'basic',
        name: 'Docs site',
        username: 'bot@example.com',
        password: 'api-token',
        endpointUrl: 'https://acme.atlassian.net',
      });
    });

    it('deletes only after an explicit confirm', async () => {
      const { user } = render(<ConnectorsSettings organizationId="org-1" />);
      const dialog = await openCard(user, 'GitHub');
      await user.click(
        dialog.getByRole('button', { name: 'Actions for Release bot' }),
      );
      await user.click(
        within(await screen.findByRole('menu')).getByRole('menuitem', {
          name: 'Delete',
        }),
      );
      expect(deleteCredential).not.toHaveBeenCalled();

      const confirm = within(
        await screen.findByRole('dialog', { name: 'Delete credential' }),
      );
      await user.click(confirm.getByRole('button', { name: /Delete/ }));
      expect(deleteCredential).toHaveBeenCalledWith({
        organizationId: 'org-1',
        credentialId: 'cred-2',
      });
    });

    it('keeps make-default visible but inert on a disabled credential', async () => {
      const { user } = render(<ConnectorsSettings organizationId="org-1" />);
      const dialog = await openCard(user, 'GitHub');
      await user.click(
        dialog.getByRole('button', { name: 'Actions for Release bot' }),
      );
      expect(
        within(await screen.findByRole('menu')).getByRole('menuitem', {
          name: 'Make default',
        }),
      ).toHaveAttribute('aria-disabled', 'true');
      expect(setDefaultCredential).not.toHaveBeenCalled();
    });
  });

  describe('degradation', () => {
    it('surfaces a catalog failure instead of an empty grid', () => {
      fixtures.connectors = [];
      fixtures.connectorsError = { data: { message: 'catalog root missing' } };
      render(<ConnectorsSettings organizationId="org-1" />);
      expect(
        screen.getByText('Could not load the connectors: catalog root missing'),
      ).toBeInTheDocument();
    });

    it('says so when the credential list fails rather than implying none exist', () => {
      fixtures.credentialsError = { data: { message: 'read timed out' } };
      render(<ConnectorsSettings organizationId="org-1" />);
      expect(screen.getByText(/read timed out/)).toBeInTheDocument();
      // The catalog still renders — one failure does not blank the page.
      expect(
        screen.getByRole('heading', { name: 'GitHub' }),
      ).toBeInTheDocument();
    });

    it('refuses the page without the developer capability', () => {
      abilityState.canRead = false;
      render(<ConnectorsSettings organizationId="org-1" />);
      expect(
        screen.queryByRole('heading', { name: 'GitHub' }),
      ).not.toBeInTheDocument();
    });
  });
});
