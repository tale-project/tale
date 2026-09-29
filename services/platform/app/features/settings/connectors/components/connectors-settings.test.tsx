import { pickFilterOption } from '@tale/ui/testing/filters';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import type {
  ConnectorSummary,
  MaskedConnectorCredential,
} from '../hooks/backend';
import { ConnectorsSettings } from './connectors-settings';

/**
 * Component coverage for the connectors settings page.
 *
 * The page is a TABLE of the organization's connector credentials; the shipped
 * catalog lives behind "Add credential", where picking a connector is step one
 * and the consent hand-off is step two for an OAuth connector. Credential rows
 * show masked values only, the two unhealthy statuses stay distinguishable, and
 * backend behaviour (encryption, method validation, default swaps) stays with
 * the convex tests: the hooks are stubbed at the module boundary.
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

// The OAuth-app registry card rides its own hook module; stubbed like the
// rest — the registry's behaviour is covered by the backend integration
// check, and the card is admin chrome around these calls.
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
  useRemoveConnectorOauthApp: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useEntraSsoSource: () => ({
    data: { available: false, reason: 'no_sso' },
    isPending: false,
    isError: false,
    error: null,
  }),
  useReuseSsoOauthApp: () => ({
    mutate: vi.fn(),
    isPending: false,
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

// The `?connector=` seed lives in the URL. Backed by component state here so
// the page's behaviour is testable without a router; the real round trip
// (including the OAuth return) is verified in the browser.
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

vi.mock('@tale/ui/use-toast', () => ({
  toast: toastSpy,
  useToast: () => ({ toast: toastSpy }),
}));

const imapSmtpConnector: ConnectorSummary = {
  slug: 'imap-smtp',
  displayName: 'IMAP / SMTP Mailbox',
  description: 'Connect a private IMAP + SMTP mail server to Conversations.',
  tags: ['Email'],
  endpointMode: 'fixed',
  authMethods: ['basic'],
  configFields: [
    { key: 'imapHost', label: 'IMAP server', type: 'string', required: true },
    {
      key: 'imapPort',
      label: 'IMAP port',
      type: 'number',
      required: false,
      default: 993,
    },
    { key: 'smtpHost', label: 'SMTP server', type: 'string', required: true },
    {
      key: 'security',
      label: 'Connection security',
      type: 'string',
      required: false,
      enum: ['tls', 'starttls'],
      default: 'tls',
    },
  ],
  actionCount: 2,
};

const githubConnector: ConnectorSummary = {
  slug: 'github',
  displayName: 'GitHub',
  description: 'Manage repositories, issues, and pull requests on GitHub.',
  tags: ['Developer'],
  endpointMode: 'fixed',
  authMethods: ['bearer'],
  configFields: [],
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
  configFields: [],
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
  configFields: [],
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
  configFields: [],
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

/** Open the add flow and pick a connector, returning its setup step. */
async function pickConnector(
  user: Awaited<ReturnType<typeof render>>['user'],
  name: string,
) {
  await user.click(screen.getByRole('button', { name: 'Add credential' }));
  const dialog = within(
    await screen.findByRole('dialog', { name: 'Add credential' }),
  );
  await user.click(dialog.getByRole('button', { name: new RegExp(name) }));
  return dialog;
}

/** Replace the name the setup step suggests with the test's own. */
async function rename(
  user: Awaited<ReturnType<typeof render>>['user'],
  form: ReturnType<typeof within>,
  name: string,
) {
  const field = form.getByRole('textbox', { name: /^Name/ });
  await user.clear(field);
  await user.type(field, name);
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

  it('lists one row per credential with its connector and status', async () => {
    const { container } = render(<ConnectorsSettings organizationId="org-1" />);

    const rows = screen.getAllByRole('row');
    // Header + two credentials — the sixteen shipped connectors are NOT rows.
    expect(rows).toHaveLength(3);

    expect(screen.getByText('Platform bot')).toBeInTheDocument();
    expect(screen.getByText('Default')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(screen.getAllByText('GitHub').length).toBeGreaterThan(0);

    await checkAccessibility(container);
  });

  it('names a credential whose connector left the catalog by its stored slug', () => {
    fixtures.connectors = [slackConnector];
    fixtures.credentials = [credential({ id: 'c', name: 'Orphan token' })];
    render(<ConnectorsSettings organizationId="org-1" />);
    // Hiding it would hide a live secret.
    expect(screen.getByText('Orphan token')).toBeInTheDocument();
    expect(screen.getByText('github')).toBeInTheDocument();
  });

  it('warns, per connector, when credentials exist but none is the default', () => {
    fixtures.credentials = [credential({ id: 'cred-1', name: 'Platform bot' })];
    render(<ConnectorsSettings organizationId="org-1" />);
    expect(
      screen.getByText(/No default credential for GitHub/),
    ).toBeInTheDocument();
  });

  describe('narrowing', () => {
    it('finds a credential by the connector it authenticates', async () => {
      fixtures.credentials = [
        ...defaultCredentials,
        credential({
          id: 'cred-3',
          name: 'Workspace grant',
          connectorSlug: 'slack',
          authMethod: 'oauth2',
        }),
      ];
      const { user } = render(<ConnectorsSettings organizationId="org-1" />);
      await user.type(
        screen.getByPlaceholderText('Search credentials'),
        'Slack',
      );
      expect(screen.getByText('Workspace grant')).toBeInTheDocument();
      expect(screen.queryByText('Platform bot')).not.toBeInTheDocument();
    });

    it('narrows by connector', async () => {
      fixtures.credentials = [
        ...defaultCredentials,
        credential({
          id: 'cred-3',
          name: 'Workspace grant',
          connectorSlug: 'slack',
          authMethod: 'oauth2',
        }),
      ];
      const { user } = render(<ConnectorsSettings organizationId="org-1" />);
      await pickFilterOption(user, 'Connector', 'Slack');
      expect(screen.getByText('Workspace grant')).toBeInTheDocument();
      expect(screen.queryByText('Platform bot')).not.toBeInTheDocument();
    });

    it('offers the search reset — not a create CTA — when nothing matches', async () => {
      const { user } = render(<ConnectorsSettings organizationId="org-1" />);
      await user.type(
        screen.getByPlaceholderText('Search credentials'),
        'nothing matches this',
      );
      expect(
        screen.getByRole('heading', { name: 'No results found' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', {
          name: 'No connectors connected yet',
        }),
      ).not.toBeInTheDocument();
    });
  });

  describe('the add flow', () => {
    it('leads with configured connectors, badges them, then the rest', async () => {
      fixtures.connectors = [slackConnector, githubConnector];
      const { user } = render(<ConnectorsSettings organizationId="org-1" />);
      await user.click(screen.getByRole('button', { name: 'Add credential' }));
      const picker = within(
        await screen.findByRole('dialog', { name: 'Add credential' }),
      );

      expect(
        picker.queryByRole('heading', { name: 'In use' }),
      ).not.toBeInTheDocument();
      expect(picker.getByText('Configured')).toBeInTheDocument();
      // GitHub holds every credential, so it leads despite sorting first
      // alphabetically anyway; Slack follows.
      const names = picker
        .getAllByRole('button')
        .map((button) => button.textContent ?? '')
        .filter((text) => /GitHub|Slack/.test(text));
      expect(names[0]).toMatch(/GitHub/);
      expect(names[1]).toMatch(/Slack/);
    });

    it('shows a connector by its tags and action count, not a bare name', async () => {
      const { user } = render(<ConnectorsSettings organizationId="org-1" />);
      await user.click(screen.getByRole('button', { name: 'Add credential' }));
      const picker = within(
        await screen.findByRole('dialog', { name: 'Add credential' }),
      );
      expect(picker.getByText('Developer · 4 actions')).toBeInTheDocument();
    });

    it('lists a connector that ships no icon', async () => {
      fixtures.connectors = [webdavConnector];
      fixtures.credentials = [];
      const { user } = render(<ConnectorsSettings organizationId="org-1" />);
      await user.click(screen.getByRole('button', { name: 'Add credential' }));
      const picker = within(
        await screen.findByRole('dialog', { name: 'Add credential' }),
      );
      expect(
        picker.getByRole('button', { name: /WebDAV Files/ }),
      ).toBeInTheDocument();
    });

    it('joins an OAuth-only connector through consent instead of a form', async () => {
      fixtures.connectors = [slackConnector];
      fixtures.credentials = [];
      const { user } = render(<ConnectorsSettings organizationId="org-1" />);
      const dialog = await pickConnector(user, 'Slack');

      // There is no secret to type, so step two is the hand-off alone.
      expect(
        dialog.queryByRole('textbox', { name: /^Name/ }),
      ).not.toBeInTheDocument();
      await user.click(dialog.getByRole('button', { name: 'Connect' }));
      // An explicit Add: the callback stores a NEW credential, never the
      // default in its place (#3711).
      expect(goToAuthorization).toHaveBeenCalledWith('org-1', 'slack', {
        kind: 'add',
      });
      expect(createCredential).not.toHaveBeenCalled();
    });

    it('suggests the connector’s name, numbered past one that connector already holds', async () => {
      fixtures.credentials = [
        ...defaultCredentials,
        credential({ id: 'cred-3', name: 'GitHub' }),
      ];
      const { user } = render(<ConnectorsSettings organizationId="org-1" />);
      const form = await pickConnector(user, 'GitHub');
      expect(form.getByRole('textbox', { name: /^Name/ })).toHaveValue(
        'GitHub 2',
      );
    });

    it('creates a bearer credential without ever rendering the secret', async () => {
      fixtures.credentials = [];
      const { user } = render(<ConnectorsSettings organizationId="org-1" />);
      const form = await pickConnector(user, 'GitHub');

      await rename(user, form, 'CI bot');
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
      const form = await pickConnector(user, 'Confluence');

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
        // The suggested name, kept.
        name: 'Confluence',
        username: 'bot@example.com',
        password: 'api-token',
        endpointUrl: 'https://acme.atlassian.net',
      });
    });

    it('collects the connector settings it declares, and gates submit on the required ones', async () => {
      // createCredential validates config against the connector's configFields
      // and refuses a missing required one. The form used to render no field for
      // them at all, so imap-smtp failed with `needs "IMAP server"` naming a
      // field the user was never asked for.
      fixtures.connectors = [imapSmtpConnector];
      fixtures.credentials = [];
      const { user } = render(<ConnectorsSettings organizationId="org-1" />);
      const form = await pickConnector(user, 'IMAP / SMTP Mailbox');

      await user.type(
        form.getByLabelText(/^Username/, { selector: 'input' }),
        'hello@example.com',
      );
      await user.type(
        form.getByLabelText(/^Password/, { selector: 'input' }),
        'mailbox-secret',
      );

      const submit = form.getByRole('button', { name: 'Add credential' });
      // Secret complete, but the two required servers are not — the server
      // would refuse, so the form must not offer to send it.
      expect(submit).toBeDisabled();

      await user.type(
        form.getByRole('textbox', { name: /^IMAP server/ }),
        'mail.example.com',
      );
      expect(submit).toBeDisabled();
      await user.type(
        form.getByRole('textbox', { name: /^SMTP server/ }),
        'smtp.example.com',
      );
      expect(submit).toBeEnabled();

      await user.click(submit);
      expect(createCredential).toHaveBeenCalledWith({
        organizationId: 'org-1',
        connectorSlug: 'imap-smtp',
        authMethod: 'basic',
        name: 'IMAP / SMTP Mailbox',
        username: 'hello@example.com',
        password: 'mailbox-secret',
        // imapPort and security are omitted, not sent blank: the server applies
        // their declared defaults for an absent field.
        config: { imapHost: 'mail.example.com', smtpHost: 'smtp.example.com' },
      });
    });
  });

  it('collects a separate SMTP relay login when the toggle is on', async () => {
    // 0.3's "Use a separate SMTP provider": IMAP keeps the mailbox login,
    // SMTP authenticates as the relay. Without the toggle the form only
    // asks for one username/password pair.
    fixtures.connectors = [imapSmtpConnector];
    fixtures.credentials = [];
    const { user } = render(<ConnectorsSettings organizationId="org-1" />);
    const form = await pickConnector(user, 'IMAP / SMTP Mailbox');

    await user.type(
      form.getByLabelText(/^Username/, { selector: 'input' }),
      'hello@example.com',
    );
    await user.type(
      form.getByLabelText(/^Password/, { selector: 'input' }),
      'mailbox-secret',
    );
    await user.type(
      form.getByRole('textbox', { name: /^IMAP server/ }),
      'imap.example.com',
    );
    await user.type(
      form.getByRole('textbox', { name: /^SMTP server/ }),
      'smtp.resend.com',
    );

    expect(
      form.queryByLabelText(/^SMTP username/, { selector: 'input' }),
    ).not.toBeInTheDocument();

    await user.click(
      form.getByRole('switch', { name: /Use a separate SMTP provider/ }),
    );
    const submit = form.getByRole('button', { name: 'Add credential' });
    expect(submit).toBeDisabled();

    await user.type(
      form.getByLabelText(/^SMTP username/, { selector: 'input' }),
      'resend',
    );
    await user.type(
      form.getByLabelText(/^SMTP password/, { selector: 'input' }),
      're_key',
    );
    expect(submit).toBeEnabled();

    await user.click(submit);
    expect(createCredential).toHaveBeenCalledWith({
      organizationId: 'org-1',
      connectorSlug: 'imap-smtp',
      authMethod: 'basic',
      name: 'IMAP / SMTP Mailbox',
      username: 'hello@example.com',
      password: 'mailbox-secret',
      smtpUsername: 'resend',
      smtpPassword: 're_key',
      config: {
        imapHost: 'imap.example.com',
        smtpHost: 'smtp.resend.com',
      },
    });
  });
  describe('row actions', () => {
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

      expect(screen.getByText('Reconnect needed')).toBeInTheDocument();
      expect(screen.getByText(/refresh_token expired/)).toBeInTheDocument();
      await user.click(
        screen.getByRole('button', { name: 'Actions for Workspace grant' }),
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

    it('reconnects exactly the row whose menu was used, not the default', async () => {
      fixtures.connectors = [slackConnector];
      fixtures.credentials = [
        credential({
          id: 'cred-default',
          name: 'Workspace grant',
          connectorSlug: 'slack',
          authMethod: 'oauth2',
          isDefault: true,
        }),
        credential({
          id: 'cred-sales',
          name: 'Sales workspace',
          connectorSlug: 'slack',
          authMethod: 'oauth2',
          status: 'needs-reauth',
        }),
      ];
      const { user } = render(<ConnectorsSettings organizationId="org-1" />);
      await user.click(
        screen.getByRole('button', { name: 'Actions for Sales workspace' }),
      );
      await user.click(
        within(await screen.findByRole('menu')).getByRole('menuitem', {
          name: 'Reconnect',
        }),
      );
      expect(goToAuthorization).toHaveBeenCalledTimes(1);
      expect(goToAuthorization).toHaveBeenCalledWith('org-1', 'slack', {
        kind: 'reconnect',
        credentialId: 'cred-sales',
      });
    });

    it('deletes only after an explicit confirm', async () => {
      const { user } = render(<ConnectorsSettings organizationId="org-1" />);
      await user.click(
        screen.getByRole('button', { name: 'Actions for Release bot' }),
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

    // #3715: the menu item that opened the dialog is gone once it closes, so
    // a keyboard user lands back on the row's menu button — never <body>.
    it.each(['Edit credential', 'Replace token', 'Delete'])(
      'returns keyboard focus to the row menu once %s closes',
      async (item) => {
        const { user } = render(<ConnectorsSettings organizationId="org-1" />);
        const trigger = screen.getByRole('button', {
          name: 'Actions for Platform bot',
        });
        trigger.focus();
        await user.keyboard('{Enter}');
        const menu = within(await screen.findByRole('menu'));
        const target = menu.getByRole('menuitem', { name: item });
        for (
          let step = 0;
          step < 8 && document.activeElement !== target;
          step++
        ) {
          await user.keyboard('{ArrowDown}');
        }
        expect(target).toHaveFocus();
        await user.keyboard('{Enter}');
        const dialog = await screen.findByRole('dialog');
        await waitFor(() => {
          expect(screen.queryByRole('menu')).not.toBeInTheDocument();
          expect(dialog).toContainElement(
            document.activeElement as HTMLElement,
          );
        });

        // Cancel from the keyboard; Escape is the real-browser suite's
        // (`@tale/ui` dialog.browser.test.tsx), jsdom's layer stack needs two.
        within(dialog).getByRole('button', { name: 'Cancel' }).focus();
        await user.keyboard('{Enter}');

        await waitFor(() => {
          expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
          expect(trigger).toHaveFocus();
        });
      },
    );

    // #3712: another session's write reaches the open page, so the list
    // refetches under whatever the admin has open.
    it('keeps an open, typed-into dialog across a refetch that changed the list', async () => {
      const page = () => <ConnectorsSettings organizationId="org-1" />;
      const { user, rerender } = render(page());
      await user.click(
        screen.getByRole('button', { name: 'Actions for Platform bot' }),
      );
      await user.click(
        within(await screen.findByRole('menu')).getByRole('menuitem', {
          name: 'Edit credential',
        }),
      );
      const form = within(
        await screen.findByRole('dialog', { name: 'Edit credential' }),
      );
      await rename(user, form, 'Platform bot (typed)');

      // A colleague added a credential: new rows, new objects, new counts.
      fixtures.credentials = [
        ...defaultCredentials.map((row) => ({ ...row })),
        credential({ id: 'cred-9', name: 'Ops bot' }),
      ];
      rerender(page());

      expect(screen.getByText('Ops bot')).toBeInTheDocument();
      expect(
        screen.getByRole('dialog', { name: 'Edit credential' }),
      ).toBeInTheDocument();
      expect(form.getByRole('textbox', { name: /^Name/ })).toHaveValue(
        'Platform bot (typed)',
      );
    });

    it('opens Edit on what the listing holds now, not what it held at mount', async () => {
      const page = () => <ConnectorsSettings organizationId="org-1" />;
      const { user, rerender } = render(page());
      // A colleague renamed the credential while this page stayed open.
      fixtures.credentials = [
        credential({
          id: 'cred-1',
          name: 'Platform bot (ops)',
          isDefault: true,
        }),
        defaultCredentials[1],
      ];
      rerender(page());

      await user.click(
        screen.getByRole('button', { name: 'Actions for Platform bot (ops)' }),
      );
      await user.click(
        within(await screen.findByRole('menu')).getByRole('menuitem', {
          name: 'Edit credential',
        }),
      );
      const form = within(
        await screen.findByRole('dialog', { name: 'Edit credential' }),
      );
      expect(form.getByRole('textbox', { name: /^Name/ })).toHaveValue(
        'Platform bot (ops)',
      );
      // Saving an untouched form must not write the old name back.
      expect(form.getByRole('button', { name: 'Save' })).toBeDisabled();
    });

    // #3713: the server hands a deleted default to the oldest active
    // credential left, and the listing names it on the default's row.
    it.each([
      [
        'names the credential that takes the default over',
        { id: 'cred-3', name: 'Ops bot' },
        'This is the default credential. Deleting it makes "Ops bot" the default for calls that name no credential.',
      ],
      [
        'says no default remains when no active credential can take over',
        null,
        'This is the default credential, and no other active credential can take over: calls that name no credential fail until you make one the default.',
      ],
    ] as const)(
      'the delete confirm of the default %s',
      async (_case, successor, sentence) => {
        fixtures.credentials = [
          credential({
            id: 'cred-1',
            name: 'Platform bot',
            isDefault: true,
            defaultSuccessor: successor,
          }),
          ...defaultCredentials.slice(1),
        ];
        const { user } = render(<ConnectorsSettings organizationId="org-1" />);
        await user.click(
          screen.getByRole('button', { name: 'Actions for Platform bot' }),
        );
        await user.click(
          within(await screen.findByRole('menu')).getByRole('menuitem', {
            name: 'Delete',
          }),
        );
        const confirm = within(
          await screen.findByRole('dialog', { name: 'Delete credential' }),
        );
        expect(confirm.getByText(sentence)).toBeInTheDocument();
        // Never the AI providers' rule, which promotes nobody.
        expect(
          confirm.queryByText(/leaves no default until you pick another one/),
        ).not.toBeInTheDocument();
      },
    );

    it('says nothing about the default when deleting another credential', async () => {
      const { user } = render(<ConnectorsSettings organizationId="org-1" />);
      await user.click(
        screen.getByRole('button', { name: 'Actions for Release bot' }),
      );
      await user.click(
        within(await screen.findByRole('menu')).getByRole('menuitem', {
          name: 'Delete',
        }),
      );
      const confirm = within(
        await screen.findByRole('dialog', { name: 'Delete credential' }),
      );
      expect(confirm.queryByText(/default credential/)).not.toBeInTheDocument();
    });

    it('keeps make-default visible but inert on a disabled credential', async () => {
      const { user } = render(<ConnectorsSettings organizationId="org-1" />);
      await user.click(
        screen.getByRole('button', { name: 'Actions for Release bot' }),
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
    it('surfaces a catalog failure instead of an empty table', () => {
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
    });

    it('refuses the page without the developer capability', () => {
      abilityState.canRead = false;
      render(<ConnectorsSettings organizationId="org-1" />);
      expect(screen.queryByText('Platform bot')).not.toBeInTheDocument();
    });
  });
});
