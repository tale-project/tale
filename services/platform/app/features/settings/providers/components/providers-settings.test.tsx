import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import type { ConnectorCatalog, MaskedCredential } from '../hooks/queries';
import { ProvidersSettings } from './providers-settings';

/**
 * Component coverage for the AI-providers settings page. The connector cards
 * render from the catalog action's (mocked) listing with wire facts, catalog
 * meta, and per-connector degradation; the credential rows show masked
 * values only; the add-credential dialog offers exactly the connector's auth
 * methods; delete runs through an explicit confirm; a deleted default
 * surfaces the "no default" state instead of auto-fixing it. Backend
 * behaviour (encryption, method validation, default swaps) is covered by the
 * convex tests — the hooks are stubbed at the module boundary.
 */

const createCredential = vi.hoisted(() => vi.fn());
const updateCredential = vi.hoisted(() => vi.fn());
const deleteCredential = vi.hoisted(() => vi.fn());
const setDefaultCredential = vi.hoisted(() => vi.fn());
const refreshCatalogs = vi.hoisted(() => vi.fn());
const toastSpy = vi.hoisted(() => vi.fn());

const fixtures = vi.hoisted(() => ({
  catalogs: [] as unknown[],
  credentials: [] as unknown[],
}));

vi.mock('../hooks/queries', () => ({
  providerCatalogsQueryKey: (organizationId: string) => [
    'providers',
    'catalogs',
    organizationId,
  ],
  useProviderCatalogs: () => ({
    data: fixtures.catalogs,
    isPending: false,
    isError: false,
    error: null,
  }),
  useProviderCredentials: () => ({
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
  useRefreshProviderCatalogs: () => ({
    mutateAsync: refreshCatalogs,
    isPending: false,
  }),
}));

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

function model(id: string): ConnectorCatalog['models'][number] {
  return {
    id,
    provider: 'anthropic',
    tags: ['chat'],
    supportsTools: true,
    supportsVision: false,
    contextWindow: 200_000,
  };
}

const anthropicConnector = {
  name: 'anthropic',
  displayName: 'Anthropic',
  apiFormat: 'anthropic',
  baseUrl: 'https://api.anthropic.com/v1',
  catalogSource: 'static',
  authMethods: ['api-key', 'env', 'subscription-broker'],
  models: [model('claude-fable-5'), model('claude-haiku-4')],
} as unknown as ConnectorCatalog;

const azureConnector = {
  name: 'azure',
  displayName: 'Azure OpenAI',
  apiFormat: 'openai',
  endpointMode: 'per-credential',
  catalogSource: 'none',
  authMethods: ['api-key', 'env'],
  models: [],
} as unknown as ConnectorCatalog;

const zaiConnector = {
  name: 'zai',
  displayName: 'Z.ai (GLM)',
  apiFormat: 'openai',
  baseUrl: 'https://api.z.ai/api/openai/v1',
  catalogSource: 'static',
  authMethods: ['api-key', 'env', 'subscription-key'],
  models: [model('glm-4.6')],
} as unknown as ConnectorCatalog;

const openrouterConnector = {
  name: 'openrouter',
  displayName: 'OpenRouter',
  apiFormat: 'openai',
  baseUrl: 'https://openrouter.ai/api/v1',
  catalogSource: 'openrouter-api',
  authMethods: ['api-key'],
  models: [],
  catalogError: 'OpenRouter API unreachable',
} as unknown as ConnectorCatalog;

function credential(
  overrides: Partial<Omit<MaskedCredential, 'id'>> & {
    id: string;
    name: string;
  },
): MaskedCredential {
  return {
    providerSlug: 'anthropic',
    authMethod: 'api-key',
    isDefault: false,
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as unknown as MaskedCredential;
}

const defaultCredentials = [
  credential({
    id: 'cred-1',
    name: 'Production key',
    authMethod: 'api-key',
    maskedPreview: 'sk-a…4f2',
    isDefault: true,
  }),
  credential({
    id: 'cred-2',
    name: 'Ops key',
    authMethod: 'env',
    envName: 'TALE_PROVIDER_KEY_ANTHROPIC',
  }),
  credential({
    id: 'cred-3',
    name: 'Claude subscription',
    authMethod: 'subscription-broker',
    maskedPreview: 'tok…9zz',
    status: 'disabled',
    modelAllowlist: ['claude-fable-5'],
  }),
];

describe('ProvidersSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    abilityState.canRead = true;
    fixtures.catalogs = [anthropicConnector, openrouterConnector];
    fixtures.credentials = [...defaultCredentials];
  });

  it('renders one section per connector with wire facts and catalog meta', async () => {
    const { container } = render(<ProvidersSettings organizationId="org-1" />);

    expect(
      screen.getByRole('heading', { name: 'Anthropic' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'OpenRouter' }),
    ).toBeInTheDocument();
    // Wire facts: API format + endpoint host.
    expect(
      screen.getByText('Anthropic Messages API · api.anthropic.com'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('OpenAI-compatible API · openrouter.ai'),
    ).toBeInTheDocument();
    // Catalog source + model count.
    expect(screen.getByText('Built-in catalog')).toBeInTheDocument();
    expect(screen.getByText('2 models')).toBeInTheDocument();
    expect(screen.getByText('OpenRouter catalog')).toBeInTheDocument();

    await waitFor(() => checkAccessibility(container));
  });

  it('shows credential rows with method badges and masked values only', () => {
    render(<ProvidersSettings organizationId="org-1" />);

    expect(screen.getByText('Production key')).toBeInTheDocument();
    expect(screen.getByText('sk-a…4f2')).toBeInTheDocument();
    expect(screen.getByText('API key')).toBeInTheDocument();

    expect(screen.getByText('Ops key')).toBeInTheDocument();
    expect(screen.getByText('TALE_PROVIDER_KEY_ANTHROPIC')).toBeInTheDocument();
    expect(screen.getByText('Environment variable')).toBeInTheDocument();

    expect(screen.getByText('Claude subscription')).toBeInTheDocument();
    expect(screen.getByText('tok…9zz')).toBeInTheDocument();
    expect(screen.getByText('Subscription broker')).toBeInTheDocument();

    // Markers: the default badge on the default row, the status badge on the
    // disabled row, the allowlist hint on the restricted row.
    expect(screen.getByText('Default')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(screen.getByText('1 model allowed')).toBeInTheDocument();
  });

  it('surfaces a per-connector catalog error without blanking the page', () => {
    render(<ProvidersSettings organizationId="org-1" />);

    expect(
      screen.getByText('Model catalog unavailable: OpenRouter API unreachable'),
    ).toBeInTheDocument();
    // The degraded connector still renders its section and add affordance.
    expect(
      screen.getByRole('heading', { name: 'OpenRouter' }),
    ).toBeInTheDocument();
  });

  it('explains the three auth methods on a connector without credentials', () => {
    render(<ProvidersSettings organizationId="org-1" />);

    // OpenRouter has no credentials in the fixture.
    expect(screen.getByText('No credentials yet')).toBeInTheDocument();
    expect(
      screen.getByText(
        /API key or a vendor subscription key.*environment variable.*subscription broker/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/TALE_PROVIDER_KEY_ and reference it/),
    ).toBeInTheDocument();
  });

  it('shows the no-default state when the pair has rows but no default', () => {
    fixtures.credentials = [
      credential({ id: 'cred-2', name: 'Ops key', authMethod: 'env' }),
    ];

    render(<ProvidersSettings organizationId="org-1" />);

    expect(
      screen.getByText(/No default credential for this provider/),
    ).toBeInTheDocument();
  });

  it('hides the no-default warning while a default exists', () => {
    render(<ProvidersSettings organizationId="org-1" />);

    expect(
      screen.queryByText(/No default credential for this provider/),
    ).toBeNull();
  });

  it('offers only the connector’s auth methods in the add dialog', async () => {
    const { user } = render(<ProvidersSettings organizationId="org-1" />);

    // OpenRouter offers api-key only — the picker lists exactly that.
    const openrouterSection = screen.getByRole('region', {
      name: 'OpenRouter',
    });
    await user.click(
      within(openrouterSection).getByRole('button', {
        name: 'Add credential',
      }),
    );
    const dialog = await screen.findByRole('dialog');
    await user.click(
      within(dialog).getByRole('combobox', { name: 'Authentication method' }),
    );
    const options = screen.getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['API key']);
  });

  it('lists all three methods for a connector that offers them', async () => {
    const { user } = render(<ProvidersSettings organizationId="org-1" />);

    const anthropicSection = screen.getByRole('region', { name: 'Anthropic' });
    await user.click(
      within(anthropicSection).getByRole('button', { name: 'Add credential' }),
    );
    const dialog = await screen.findByRole('dialog');
    await user.click(
      within(dialog).getByRole('combobox', { name: 'Authentication method' }),
    );
    expect(
      screen.getAllByRole('option').map((option) => option.textContent),
    ).toEqual(['API key', 'Environment variable', 'Subscription broker']);
  });

  it('creates an api-key credential and never renders the typed secret', async () => {
    createCredential.mockResolvedValue({ credentialId: 'cred-9' });
    const { user } = render(<ProvidersSettings organizationId="org-1" />);

    const anthropicSection = screen.getByRole('region', { name: 'Anthropic' });
    await user.click(
      within(anthropicSection).getByRole('button', { name: 'Add credential' }),
    );
    const dialog = await screen.findByRole('dialog');

    await user.type(
      within(dialog).getByRole('textbox', { name: /^Name/ }),
      'Staging key',
    );
    await user.type(
      within(dialog).getByLabelText(/^API key/, { selector: 'input' }),
      'sk-live-secret',
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Add credential' }),
    );

    await waitFor(() =>
      expect(createCredential).toHaveBeenCalledWith({
        organizationId: 'org-1',
        providerSlug: 'anthropic',
        authMethod: 'api-key',
        name: 'Staging key',
        secret: 'sk-live-secret',
      }),
    );
    // The secret exists only inside the (now reset) form control — it must
    // never surface as rendered text or a lingering field value.
    await waitFor(() =>
      expect(screen.queryByDisplayValue('sk-live-secret')).toBeNull(),
    );
    expect(screen.queryByText('sk-live-secret')).toBeNull();
  });

  it('shows the fixed env prefix and the broker explainer per method', async () => {
    const { user } = render(<ProvidersSettings organizationId="org-1" />);

    const anthropicSection = screen.getByRole('region', { name: 'Anthropic' });
    await user.click(
      within(anthropicSection).getByRole('button', { name: 'Add credential' }),
    );
    const dialog = await screen.findByRole('dialog');
    const methodPicker = within(dialog).getByRole('combobox', {
      name: 'Authentication method',
    });

    await user.click(methodPicker);
    await user.click(
      screen.getByRole('option', { name: 'Environment variable' }),
    );
    expect(within(dialog).getByText('TALE_PROVIDER_KEY_')).toBeInTheDocument();

    await user.click(methodPicker);
    await user.click(
      screen.getByRole('option', { name: 'Subscription broker' }),
    );
    expect(
      within(dialog).getByText(/run sandboxed on their provider's harness/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('textbox', { name: /^Broker endpoint/ }),
    ).toBeInTheDocument();
  });

  it('deletes a credential through the explicit confirm dialog', async () => {
    deleteCredential.mockResolvedValue(null);
    const { user } = render(<ProvidersSettings organizationId="org-1" />);

    await user.click(
      screen.getByRole('button', { name: 'Actions for Production key' }),
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(/Delete "Production key"\?/),
    ).toBeInTheDocument();
    // Deleting the DEFAULT warns that the pair is left without one.
    expect(
      within(dialog).getByText(/leaves the provider without a default/),
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
    const { user } = render(<ProvidersSettings organizationId="org-1" />);

    await user.click(
      screen.getByRole('button', { name: 'Actions for Claude subscription' }),
    );
    const makeDefault = await screen.findByRole('menuitem', {
      name: 'Make default',
    });
    expect(makeDefault).toHaveAttribute('aria-disabled', 'true');
  });

  it('refreshes the catalogs and reports the per-connector outcomes', async () => {
    refreshCatalogs.mockResolvedValue([
      { name: 'openrouter', modelCount: 342 },
      { name: 'vercel-ai-gateway', modelCount: 0, error: 'gateway down' },
    ]);
    const { user } = render(<ProvidersSettings organizationId="org-1" />);

    await user.click(screen.getByRole('button', { name: 'Refresh catalogs' }));

    await waitFor(() =>
      expect(refreshCatalogs).toHaveBeenCalledWith({
        organizationId: 'org-1',
      }),
    );
    // Known connectors report under their display name; unknown slugs (not
    // in the current listing) fall back to the slug.
    expect(
      await screen.findByText('OpenRouter: 342 models'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('vercel-ai-gateway: gateway down'),
    ).toBeInTheDocument();
  });

  it('describes a per-credential-endpoint connector and requires its URL', async () => {
    fixtures.catalogs = [azureConnector];
    fixtures.credentials = [];
    createCredential.mockResolvedValue({ credentialId: 'cred-a' });
    const { user } = render(<ProvidersSettings organizationId="org-1" />);

    // No fixed host to show — the facts line names the endpoint mode, and
    // the catalog line explains where models come from instead of a count.
    expect(
      screen.getByText('OpenAI-compatible API · endpoint set per credential'),
    ).toBeInTheDocument();
    expect(screen.getByText('No catalog')).toBeInTheDocument();
    expect(
      screen.getByText("Models come from each credential's model allowlist."),
    ).toBeInTheDocument();

    const section = screen.getByRole('region', { name: 'Azure OpenAI' });
    await user.click(
      within(section).getByRole('button', { name: 'Add credential' }),
    );
    const dialog = await screen.findByRole('dialog');

    await user.type(
      within(dialog).getByRole('textbox', { name: /^Name/ }),
      'Azure prod',
    );
    await user.type(
      within(dialog).getByLabelText(/^API key/, { selector: 'input' }),
      'azure-secret',
    );
    // Endpoint empty → submit stays off (the URL is required here).
    expect(
      within(dialog).getByRole('button', { name: 'Add credential' }),
    ).toBeDisabled();
    await user.type(
      within(dialog).getByRole('textbox', { name: /^Endpoint URL/ }),
      'https://res.openai.azure.com/openai/v1',
    );
    // Without a catalog the allowlist is free text (Azure deployment names).
    await user.type(
      within(dialog).getByRole('textbox', { name: /^Model allowlist/ }),
      'gpt-4o, o4-mini',
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Add credential' }),
    );

    await waitFor(() =>
      expect(createCredential).toHaveBeenCalledWith({
        organizationId: 'org-1',
        providerSlug: 'azure',
        authMethod: 'api-key',
        name: 'Azure prod',
        secret: 'azure-secret',
        endpointUrl: 'https://res.openai.azure.com/openai/v1',
        modelAllowlist: ['gpt-4o', 'o4-mini'],
      }),
    );
  });

  it('shows the per-credential endpoint on the credential row', () => {
    fixtures.catalogs = [azureConnector];
    fixtures.credentials = [
      credential({
        id: 'cred-a1',
        name: 'Azure prod',
        providerSlug: 'azure',
        maskedPreview: 'az…9f1',
        endpointUrl: 'https://res.openai.azure.com/openai/v1',
        isDefault: true,
      }),
    ];

    render(<ProvidersSettings organizationId="org-1" />);

    expect(
      screen.getByText('https://res.openai.azure.com/openai/v1'),
    ).toBeInTheDocument();
    expect(screen.getByText('az…9f1')).toBeInTheDocument();
  });

  it('authors a subscription key with the sandboxed-execution explainer', async () => {
    fixtures.catalogs = [zaiConnector];
    fixtures.credentials = [];
    createCredential.mockResolvedValue({ credentialId: 'cred-z' });
    const { user } = render(<ProvidersSettings organizationId="org-1" />);

    await user.click(screen.getByRole('button', { name: 'Add credential' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(
      within(dialog).getByRole('combobox', { name: 'Authentication method' }),
    );
    expect(
      screen.getAllByRole('option').map((option) => option.textContent),
    ).toEqual(['API key', 'Environment variable', 'Subscription key']);
    await user.click(screen.getByRole('option', { name: 'Subscription key' }));

    expect(
      within(dialog).getByText("Runs sandboxed on its provider's harness."),
    ).toBeInTheDocument();

    await user.type(
      within(dialog).getByRole('textbox', { name: /^Name/ }),
      'GLM coding plan',
    );
    await user.type(
      within(dialog).getByLabelText(/^Subscription key/, {
        selector: 'input',
      }),
      'glm-plan-secret',
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Add credential' }),
    );

    await waitFor(() =>
      expect(createCredential).toHaveBeenCalledWith({
        organizationId: 'org-1',
        providerSlug: 'zai',
        authMethod: 'subscription-key',
        name: 'GLM coding plan',
        secret: 'glm-plan-secret',
      }),
    );
  });

  it('shows AccessDenied to a member without the developer capability', () => {
    abilityState.canRead = false;

    render(<ProvidersSettings organizationId="org-1" />);

    expect(
      screen.getByText(
        'You need Admin or Developer permissions to manage AI providers.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Anthropic' })).toBeNull();
  });
});
