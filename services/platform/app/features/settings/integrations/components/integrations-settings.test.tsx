import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import type {
  IntegrationConnectorSummary,
  MaskedIntegrationCredential,
} from '../hooks/backend';
import { IntegrationsSettings } from './integrations-settings';

/**
 * Component coverage for the integrations settings page. The connector
 * sections render from the catalog action's (mocked) listing; credential rows
 * show masked values only; the add dialog offers exactly the methods the
 * connector declares and asks for the instance URL only where the connector
 * needs one; an OAuth connector is joined through the consent flow instead of
 * a token field; and the two unhealthy statuses stay distinguishable. Backend
 * behaviour (encryption, method validation, default swaps) is covered by the
 * convex tests — the hooks are stubbed at the module boundary.
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
}));

// The MCP endpoint section (moved onto this page with the integrations-page
// rework) renders the deployment's MCP URL via `useSiteUrl`, which needs the
// app-level SiteUrlProvider. Its content is not this suite's concern — the
// connector sections are — so stub it at the module boundary like the hooks.
vi.mock('./mcp-endpoint-section', () => ({
  McpEndpointSection: () => <section data-testid="mcp-endpoint-section" />,
}));

vi.mock('../hooks/queries', () => ({
  useIntegrationConnectors: () => ({
    data: fixtures.connectors,
    isPending: false,
    isError: fixtures.connectorsError !== null,
    error: fixtures.connectorsError,
  }),
  useIntegrationCredentials: () => ({
    data: fixtures.credentials,
    isPending: false,
    isError: false,
    error: null,
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
vi.mock('../integration-oauth', () => ({ goToAuthorization }));

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

const githubConnector: IntegrationConnectorSummary = {
  slug: 'github',
  displayName: 'GitHub',
  description: 'Manage repositories, issues, and pull requests on GitHub.',
  tags: ['Developer'],
  endpointMode: 'fixed',
  authMethods: ['bearer'],
  actionCount: 4,
  iconUrl: '/api/integrations/github/icon.svg',
};

const slackConnector: IntegrationConnectorSummary = {
  slug: 'slack',
  displayName: 'Slack',
  description: 'Send messages and interact with channels in Slack.',
  tags: ['Messaging'],
  endpointMode: 'fixed',
  authMethods: ['oauth2'],
  actionCount: 6,
  iconUrl: '/api/integrations/slack/icon.svg',
};

const confluenceConnector: IntegrationConnectorSummary = {
  slug: 'confluence',
  displayName: 'Confluence',
  description: "Import Confluence Cloud pages into Tale's knowledge base.",
  tags: ['Knowledge'],
  endpointMode: 'per-credential',
  authMethods: ['basic'],
  actionCount: 2,
  iconUrl: '/api/integrations/confluence/icon.svg',
};

// WebDAV ships no icon — the catalog carries none and the row falls back.
const webdavConnector: IntegrationConnectorSummary = {
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
  overrides: Partial<Omit<MaskedIntegrationCredential, 'id'>> & {
    id: string;
    name: string;
  },
): MaskedIntegrationCredential {
  return {
    connectorSlug: 'github',
    authMethod: 'bearer',
    isDefault: false,
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as unknown as MaskedIntegrationCredential;
}

const defaultCredentials: MaskedIntegrationCredential[] = [
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

describe('IntegrationsSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    abilityState.canRead = true;
    fixtures.connectors = [githubConnector, slackConnector];
    fixtures.credentials = [...defaultCredentials];
    fixtures.connectorsError = null;
  });

  it('renders one section per shipped connector with its catalog facts', async () => {
    const { container } = render(
      <IntegrationsSettings organizationId="org-1" />,
    );

    expect(screen.getByRole('heading', { name: 'GitHub' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Slack' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Manage repositories, issues, and pull requests on GitHub.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Developer')).toBeInTheDocument();
    expect(screen.getByText('4 actions')).toBeInTheDocument();
    expect(
      screen.getByText('2 connectors · 2 credentials configured'),
    ).toBeInTheDocument();

    await waitFor(() => checkAccessibility(container));
  });

  it('shows credential rows with method badges and masked values only', () => {
    render(<IntegrationsSettings organizationId="org-1" />);

    expect(screen.getByText('Platform bot')).toBeInTheDocument();
    expect(screen.getByText('ghp_…4f2')).toBeInTheDocument();
    expect(screen.getAllByText('Token')).not.toHaveLength(0);
    expect(screen.getByText('Default')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });

  it('keeps needs-reauth distinct from disabled and offers Reconnect', async () => {
    fixtures.credentials = [
      credential({
        id: 'cred-s1',
        name: 'Acme workspace',
        connectorSlug: 'slack',
        authMethod: 'oauth2',
        isDefault: true,
        status: 'needs-reauth',
        statusDetail: 'Refresh token rejected by Slack.',
      }),
      credential({ id: 'cred-2', name: 'Release bot', status: 'disabled' }),
    ];
    const { user } = render(<IntegrationsSettings organizationId="org-1" />);

    // Two different markers, two different explanations.
    expect(screen.getByText('Reconnect needed')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Refresh token rejected by Slack. Reconnect to grant consent again.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Reconnecting re-runs the consent flow/),
    ).toBeInTheDocument();

    // The fix is re-consent, so the row offers it — and only OAuth rows do.
    await user.click(
      screen.getByRole('button', { name: 'Actions for Acme workspace' }),
    );
    await user.click(
      await screen.findByRole('menuitem', { name: 'Reconnect' }),
    );
    await waitFor(() =>
      expect(goToAuthorization).toHaveBeenCalledWith('org-1', 'slack'),
    );

    // A password-style credential has no consent flow to re-run.
    await user.click(
      screen.getByRole('button', { name: 'Actions for Release bot' }),
    );
    expect(screen.queryByRole('menuitem', { name: 'Reconnect' })).toBeNull();
  });

  it('falls back to the generic explanation without a status detail', () => {
    fixtures.credentials = [
      credential({
        id: 'cred-s2',
        name: 'Acme workspace',
        connectorSlug: 'slack',
        authMethod: 'oauth2',
        isDefault: true,
        status: 'needs-reauth',
      }),
    ];

    render(<IntegrationsSettings organizationId="org-1" />);

    expect(
      screen.getByText(/The stored authorization expired or was revoked/),
    ).toBeInTheDocument();
  });

  it('shows the no-default state when a connector has rows but no default', () => {
    fixtures.credentials = [credential({ id: 'cred-2', name: 'Release bot' })];

    render(<IntegrationsSettings organizationId="org-1" />);

    expect(
      screen.getByText(/No default credential for this connector/),
    ).toBeInTheDocument();
  });

  it('hides the no-default warning while a default exists', () => {
    render(<IntegrationsSettings organizationId="org-1" />);

    expect(
      screen.queryByText(/No default credential for this connector/),
    ).toBeNull();
  });

  it('offers only the methods the connector declares', async () => {
    const { user } = render(<IntegrationsSettings organizationId="org-1" />);

    const section = screen.getByRole('region', { name: 'GitHub' });
    await user.click(
      within(section).getByRole('button', { name: 'Add credential' }),
    );
    const dialog = await screen.findByRole('dialog');
    await user.click(
      within(dialog).getByRole('combobox', { name: 'Authentication method' }),
    );
    expect(
      screen.getAllByRole('option').map((option) => option.textContent),
    ).toEqual(['Token']);
  });

  it('creates a token credential and never renders the typed secret', async () => {
    createCredential.mockResolvedValue({ credentialId: 'cred-9' });
    const { user } = render(<IntegrationsSettings organizationId="org-1" />);

    const section = screen.getByRole('region', { name: 'GitHub' });
    await user.click(
      within(section).getByRole('button', { name: 'Add credential' }),
    );
    const dialog = await screen.findByRole('dialog');

    await user.type(
      within(dialog).getByRole('textbox', { name: /^Name/ }),
      'CI bot',
    );
    await user.type(
      within(dialog).getByLabelText(/^Token/, { selector: 'input' }),
      'ghp_live_secret',
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Add credential' }),
    );

    await waitFor(() =>
      expect(createCredential).toHaveBeenCalledWith({
        organizationId: 'org-1',
        connectorSlug: 'github',
        authMethod: 'bearer',
        name: 'CI bot',
        token: 'ghp_live_secret',
      }),
    );
    // The secret exists only inside the (now reset) form control — it must
    // never surface as rendered text or a lingering field value.
    await waitFor(() =>
      expect(screen.queryByDisplayValue('ghp_live_secret')).toBeNull(),
    );
    expect(screen.queryByText('ghp_live_secret')).toBeNull();
  });

  it('requires the instance URL on a per-credential connector and names it', async () => {
    fixtures.connectors = [confluenceConnector];
    fixtures.credentials = [];
    createCredential.mockResolvedValue({ credentialId: 'cred-c' });
    const { user } = render(<IntegrationsSettings organizationId="org-1" />);

    expect(
      screen.getByText('Each credential names its own instance.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add credential' }));
    const dialog = await screen.findByRole('dialog');

    await user.type(
      within(dialog).getByRole('textbox', { name: /^Name/ }),
      'Docs space',
    );
    await user.type(
      within(dialog).getByRole('textbox', { name: /^Username/ }),
      'bot@acme.test',
    );
    await user.type(
      within(dialog).getByLabelText(/^Password/, { selector: 'input' }),
      'atlassian-token',
    );
    // Endpoint empty → submit stays off (the URL is required here).
    expect(
      within(dialog).getByRole('button', { name: 'Add credential' }),
    ).toBeDisabled();
    expect(
      within(dialog).getByText(/Your Atlassian site origin/),
    ).toBeInTheDocument();

    await user.type(
      within(dialog).getByRole('textbox', { name: /^Instance URL/ }),
      'https://acme.atlassian.net',
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Add credential' }),
    );

    await waitFor(() =>
      expect(createCredential).toHaveBeenCalledWith({
        organizationId: 'org-1',
        connectorSlug: 'confluence',
        authMethod: 'basic',
        name: 'Docs space',
        username: 'bot@acme.test',
        password: 'atlassian-token',
        endpointUrl: 'https://acme.atlassian.net',
      }),
    );
  });

  it('connects an OAuth connector through consent, never a token field', async () => {
    fixtures.connectors = [slackConnector];
    fixtures.credentials = [];
    const { user } = render(<IntegrationsSettings organizationId="org-1" />);

    expect(
      screen.getByText(/Connect Slack to grant Tale access/),
    ).toBeInTheDocument();
    // A connector that only does consent offers no credential form at all.
    expect(screen.queryByRole('button', { name: 'Add credential' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Connect' }));

    expect(goToAuthorization).toHaveBeenCalledWith('org-1', 'slack');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(createCredential).not.toHaveBeenCalled();
  });

  it('shows the instance endpoint on the credential row', () => {
    fixtures.connectors = [confluenceConnector];
    fixtures.credentials = [
      credential({
        id: 'cred-c1',
        name: 'Docs space',
        connectorSlug: 'confluence',
        authMethod: 'basic',
        maskedPreview: 'bot…est',
        endpointUrl: 'https://acme.atlassian.net',
        isDefault: true,
      }),
    ];

    render(<IntegrationsSettings organizationId="org-1" />);

    expect(screen.getByText('https://acme.atlassian.net')).toBeInTheDocument();
    expect(screen.getByText('bot…est')).toBeInTheDocument();
  });

  it('renders a connector that ships no icon', () => {
    fixtures.connectors = [webdavConnector];
    fixtures.credentials = [];

    render(<IntegrationsSettings organizationId="org-1" />);

    expect(
      screen.getByRole('heading', { name: 'WebDAV Files' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'WebDAV Files' })).toBeTruthy();
  });

  it('deletes a credential through the explicit confirm dialog', async () => {
    deleteCredential.mockResolvedValue(null);
    const { user } = render(<IntegrationsSettings organizationId="org-1" />);

    await user.click(
      screen.getByRole('button', { name: 'Actions for Platform bot' }),
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(/Delete "Platform bot"\?/),
    ).toBeInTheDocument();
    // Deleting the DEFAULT warns that the connector is left without one.
    expect(
      within(dialog).getByText(/leaves the connector without a default/),
    ).toBeInTheDocument();
    expect(deleteCredential).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(deleteCredential).toHaveBeenCalledWith({
        organizationId: 'org-1',
        credentialId: 'cred-1',
      }),
    );
  });

  it('keeps make-default inert for a disabled credential', async () => {
    const { user } = render(<IntegrationsSettings organizationId="org-1" />);

    await user.click(
      screen.getByRole('button', { name: 'Actions for Release bot' }),
    );
    const makeDefault = await screen.findByRole('menuitem', {
      name: 'Make default',
    });
    expect(makeDefault).toHaveAttribute('aria-disabled', 'true');
  });

  it('surfaces a catalog failure instead of an empty page', () => {
    fixtures.connectorsError = { data: { message: 'catalog root missing' } };

    render(<IntegrationsSettings organizationId="org-1" />);

    expect(
      screen.getByText('Could not load the connectors: catalog root missing'),
    ).toBeInTheDocument();
  });

  it('shows AccessDenied to a member without the developer capability', () => {
    abilityState.canRead = false;

    render(<IntegrationsSettings organizationId="org-1" />);

    expect(
      screen.getByText(
        'You need Admin or Developer permissions to access integrations settings.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'GitHub' })).toBeNull();
  });
});
