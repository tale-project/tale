import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import type { ProviderCatalog, MaskedCredential } from '../hooks/queries';
import { ProvidersSettings } from './providers-settings';

/**
 * Component coverage for the AI-providers settings page.
 *
 * The catalog renders as cards with each provider's wire facts and catalog
 * meta, degrading PER PROVIDER; narrowing runs over the loaded list; and the
 * credentials — masked values only — live in the dialog a card opens, together
 * with the model allowlist. Backend behaviour (encryption, method validation,
 * default swaps) stays with the convex tests: the hooks are stubbed at the
 * module boundary.
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
  catalogsError: null as unknown,
}));

vi.mock('../hooks/queries', () => ({
  providerCatalogsQueryKey: (organizationId: string) => [
    'providers',
    'catalogs',
    organizationId,
  ],
  harnessStatusQueryKey: (organizationId: string) => [
    'providers',
    'harness-status',
    organizationId,
  ],
  useProviderCatalogs: () => ({
    data: fixtures.catalogs,
    isPending: false,
    isError: fixtures.catalogsError !== null,
    error: fixtures.catalogsError,
  }),
  useProviderCredentials: () => ({
    data: fixtures.credentials,
    isPending: false,
    isError: false,
    error: null,
  }),
  // The harness status section carries its own component test; the page test
  // only needs it to render quietly.
  useHarnessStatus: () => ({
    data: [],
    isPending: false,
    isError: false,
    error: null,
  }),
  useHarnessHealth: () => ({
    data: [],
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

// The open card lives in the URL. Backed by component state here so the page's
// behaviour is testable without a router; the real round trip is verified in
// the browser.
vi.mock('@/app/hooks/use-url-state', () => {
  const React = require('react') as typeof import('react');
  return {
    useUrlState: () => {
      const [open, setOpen] = React.useState<string | null>(null);
      return {
        state: { provider: open },
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

function model(id: string): ProviderCatalog['models'][number] {
  return {
    id,
    provider: 'anthropic',
    tags: ['chat'],
    supportsTools: true,
    supportsVision: false,
    contextWindow: 200_000,
  };
}

const anthropicProvider = {
  name: 'anthropic',
  displayName: 'Anthropic',
  apiFormat: 'anthropic',
  baseUrl: 'https://api.anthropic.com/v1',
  catalogSource: 'static',
  authMethods: ['api-key', 'env', 'subscription-broker'],
  models: [model('claude-fable-5'), model('claude-haiku-4')],
} as unknown as ProviderCatalog;

const azureProvider = {
  name: 'azure',
  displayName: 'Azure OpenAI',
  apiFormat: 'openai',
  endpointMode: 'per-credential',
  catalogSource: 'none',
  authMethods: ['api-key', 'env'],
  models: [],
} as unknown as ProviderCatalog;

const zaiProvider = {
  name: 'zai',
  displayName: 'Z.ai (GLM)',
  apiFormat: 'openai',
  baseUrl: 'https://api.z.ai/api/openai/v1',
  catalogSource: 'static',
  authMethods: ['api-key', 'env', 'subscription-key'],
  models: [model('glm-4.6')],
} as unknown as ProviderCatalog;

const openrouterProvider = {
  name: 'openrouter',
  displayName: 'OpenRouter',
  apiFormat: 'openai',
  baseUrl: 'https://openrouter.ai/api/v1',
  catalogSource: 'openrouter-api',
  authMethods: ['api-key'],
  models: [],
  catalogError: 'OpenRouter API unreachable',
} as unknown as ProviderCatalog;

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

/** Open a provider's card and return its detail dialog. */
async function openCard(
  user: Awaited<ReturnType<typeof render>>['user'],
  name: string,
) {
  await user.click(screen.getByRole('button', { name: `Open ${name}` }));
  return within(await screen.findByRole('dialog', { name }));
}

describe('ProvidersSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    abilityState.canRead = true;
    fixtures.catalogs = [anthropicProvider, openrouterProvider];
    fixtures.credentials = [...defaultCredentials];
    fixtures.catalogsError = null;
  });

  it('renders one card per provider with its wire facts and catalog meta', async () => {
    const { container } = render(<ProvidersSettings organizationId="org-1" />);

    expect(
      screen.getByRole('heading', { name: 'Anthropic' }),
    ).toBeInTheDocument();
    // A provider has no description, so the wire facts are the summary line.
    expect(
      screen.getByText('Anthropic Messages API · api.anthropic.com'),
    ).toBeInTheDocument();
    expect(screen.getByText('Built-in catalog')).toBeInTheDocument();
    expect(screen.getByText('2 models')).toBeInTheDocument();
    expect(screen.getByText('3 credentials')).toBeInTheDocument();
    // Radix Tabs points aria-controls at a lazily-mounted panel that does not
    // exist in JSDOM — a false positive.
    await checkAccessibility(container, {
      rules: { 'aria-valid-attr-value': { enabled: false } },
    });
  });

  it('lets a failed catalog outrank the credential count on the card', () => {
    fixtures.catalogs = [openrouterProvider];
    fixtures.credentials = [
      credential({ id: 'c', name: 'Key', providerSlug: 'openrouter' }),
    ];
    render(<ProvidersSettings organizationId="org-1" />);
    // Keys are useless if we cannot tell which models the provider serves.
    expect(screen.getByText('Catalog unavailable')).toBeInTheDocument();
    expect(screen.queryByText('1 credential')).not.toBeInTheDocument();
  });

  it('names a per-credential-endpoint provider without inventing a host', () => {
    fixtures.catalogs = [azureProvider];
    fixtures.credentials = [];
    render(<ProvidersSettings organizationId="org-1" />);
    expect(screen.getByText(/endpoint set per credential/)).toBeInTheDocument();
    expect(screen.getByText('No catalog')).toBeInTheDocument();
  });

  describe('narrowing', () => {
    it('splits configured from not configured', async () => {
      const { user } = render(<ProvidersSettings organizationId="org-1" />);

      await user.click(screen.getByRole('tab', { name: 'Configured' }));
      expect(
        screen.getByRole('heading', { name: 'Anthropic' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: 'OpenRouter' }),
      ).not.toBeInTheDocument();

      await user.click(screen.getByRole('tab', { name: 'Not configured' }));
      expect(
        screen.getByRole('heading', { name: 'OpenRouter' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: 'Anthropic' }),
      ).not.toBeInTheDocument();
    });

    it('finds a provider by a model id it serves', async () => {
      const { user } = render(<ProvidersSettings organizationId="org-1" />);
      await user.type(
        screen.getByPlaceholderText('Search providers and models…'),
        'claude-haiku-4',
      );
      expect(
        screen.getByRole('heading', { name: 'Anthropic' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: 'OpenRouter' }),
      ).not.toBeInTheDocument();
    });

    it('narrows by wire format', async () => {
      const { user } = render(<ProvidersSettings organizationId="org-1" />);
      await user.click(screen.getByRole('combobox', { name: 'API format' }));
      await user.click(
        await screen.findByRole('option', { name: 'Anthropic Messages API' }),
      );
      expect(
        screen.getByRole('heading', { name: 'Anthropic' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: 'OpenRouter' }),
      ).not.toBeInTheDocument();
    });

    it('hides the format facet when the catalog speaks one dialect', () => {
      fixtures.catalogs = [zaiProvider, openrouterProvider];
      render(<ProvidersSettings organizationId="org-1" />);
      expect(
        screen.queryByRole('combobox', { name: 'API format' }),
      ).not.toBeInTheDocument();
    });
  });

  describe('the dialog a card opens', () => {
    it('lists credentials with masked values, env names, and the allowlist count', async () => {
      const { user } = render(<ProvidersSettings organizationId="org-1" />);
      const dialog = await openCard(user, 'Anthropic');

      expect(dialog.getByText('Production key')).toBeInTheDocument();
      expect(dialog.getByText('sk-a…4f2')).toBeInTheDocument();
      // An `env` credential stores no secret — the var NAME is what to show.
      expect(
        dialog.getByText('TALE_PROVIDER_KEY_ANTHROPIC'),
      ).toBeInTheDocument();
      expect(dialog.getByText('1 model allowed')).toBeInTheDocument();
      expect(dialog.getByText('Default')).toBeInTheDocument();
      expect(dialog.getByText('Disabled')).toBeInTheDocument();
    });

    it('reports a per-provider catalog failure without blanking the page', async () => {
      const { user } = render(<ProvidersSettings organizationId="org-1" />);
      // The other provider is untouched by it — both cards render.
      expect(
        screen.getByRole('heading', { name: 'Anthropic' }),
      ).toBeInTheDocument();
      const dialog = await openCard(user, 'OpenRouter');
      expect(
        dialog.getByText(/OpenRouter API unreachable/),
      ).toBeInTheDocument();
    });

    it('offers exactly the provider’s declared auth methods', async () => {
      const { user } = render(<ProvidersSettings organizationId="org-1" />);
      const dialog = await openCard(user, 'Anthropic');
      await user.click(dialog.getByRole('button', { name: 'Add credential' }));

      const form = within(
        await screen.findByRole('dialog', { name: 'Add credential' }),
      );
      await user.click(
        form.getByRole('combobox', { name: /Authentication method/ }),
      );
      expect(
        screen.getAllByRole('option').map((option) => option.textContent),
      ).toEqual(['API key', 'Environment variable', 'Subscription broker']);
    });

    it('creates an api-key credential without ever rendering the secret', async () => {
      createCredential.mockResolvedValue({ credentialId: 'cred-9' });
      const { user } = render(<ProvidersSettings organizationId="org-1" />);
      const dialog = await openCard(user, 'Anthropic');
      await user.click(dialog.getByRole('button', { name: 'Add credential' }));

      const form = within(
        await screen.findByRole('dialog', { name: 'Add credential' }),
      );
      await user.type(
        form.getByRole('textbox', { name: /^Name/ }),
        'Staging key',
      );
      await user.type(
        form.getByLabelText(/^API key/, { selector: 'input' }),
        'sk-ant-secret',
      );
      await user.click(form.getByRole('button', { name: 'Add credential' }));

      await waitFor(() =>
        expect(createCredential).toHaveBeenCalledWith({
          organizationId: 'org-1',
          providerSlug: 'anthropic',
          authMethod: 'api-key',
          name: 'Staging key',
          secret: 'sk-ant-secret',
        }),
      );
      expect(screen.queryByText('sk-ant-secret')).toBeNull();
      await waitFor(() =>
        expect(screen.queryByDisplayValue('sk-ant-secret')).toBeNull(),
      );
    });

    it('prefixes the env-var name and requires an instance URL where the provider has one', async () => {
      fixtures.catalogs = [azureProvider];
      fixtures.credentials = [];
      const { user } = render(<ProvidersSettings organizationId="org-1" />);
      const dialog = await openCard(user, 'Azure OpenAI');
      await user.click(dialog.getByRole('button', { name: 'Add credential' }));

      const form = within(
        await screen.findByRole('dialog', { name: 'Add credential' }),
      );
      await user.type(form.getByRole('textbox', { name: /^Name/ }), 'Prod');
      await user.type(
        form.getByLabelText(/^API key/, { selector: 'input' }),
        'azure-key',
      );
      const submit = form.getByRole('button', { name: 'Add credential' });
      expect(submit).toBeDisabled();

      await user.type(
        form.getByRole('textbox', { name: /^Endpoint/ }),
        'https://acme.openai.azure.com/openai/v1',
      );
      await user.click(submit);
      await waitFor(() =>
        expect(createCredential).toHaveBeenCalledWith({
          organizationId: 'org-1',
          providerSlug: 'azure',
          authMethod: 'api-key',
          name: 'Prod',
          secret: 'azure-key',
          endpointUrl: 'https://acme.openai.azure.com/openai/v1',
        }),
      );
    });

    it('warns when credentials exist but none is the default', async () => {
      fixtures.credentials = [credential({ id: 'cred-1', name: 'Only key' })];
      const { user } = render(<ProvidersSettings organizationId="org-1" />);
      const dialog = await openCard(user, 'Anthropic');
      expect(dialog.getByText(/No default credential/)).toBeInTheDocument();
    });

    it('deletes only after an explicit confirm, warning on the default', async () => {
      const { user } = render(<ProvidersSettings organizationId="org-1" />);
      const dialog = await openCard(user, 'Anthropic');
      await user.click(
        dialog.getByRole('button', { name: 'Actions for Production key' }),
      );
      await user.click(
        within(await screen.findByRole('menu')).getByRole('menuitem', {
          name: 'Delete',
        }),
      );
      const confirm = within(
        await screen.findByRole('dialog', { name: 'Delete credential' }),
      );
      expect(confirm.getByText(/leaves no default/i)).toBeInTheDocument();
      await user.click(confirm.getByRole('button', { name: /Delete/ }));
      await waitFor(() =>
        expect(deleteCredential).toHaveBeenCalledWith({
          organizationId: 'org-1',
          credentialId: 'cred-1',
        }),
      );
    });

    it('keeps make-default visible but inert on a disabled credential', async () => {
      const { user } = render(<ProvidersSettings organizationId="org-1" />);
      const dialog = await openCard(user, 'Anthropic');
      await user.click(
        dialog.getByRole('button', { name: 'Actions for Claude subscription' }),
      );
      expect(
        within(await screen.findByRole('menu')).getByRole('menuitem', {
          name: 'Make default',
        }),
      ).toHaveAttribute('aria-disabled', 'true');
      expect(setDefaultCredential).not.toHaveBeenCalled();
    });
  });

  describe('catalog refresh', () => {
    it('reports the per-provider outcome, falling back to the slug', async () => {
      refreshCatalogs.mockResolvedValue([
        { name: 'openrouter', modelCount: 342 },
        { name: 'vercel-ai-gateway', modelCount: 0, error: 'gateway down' },
      ]);
      const { user } = render(<ProvidersSettings organizationId="org-1" />);
      await user.click(screen.getByRole('button', { name: /Refresh/ }));

      await waitFor(() =>
        expect(refreshCatalogs).toHaveBeenCalledWith({
          organizationId: 'org-1',
        }),
      );
      expect(await screen.findByText(/342 models/)).toBeInTheDocument();
      // A provider absent from the catalog listing still gets named.
      expect(
        screen.getByText(/vercel-ai-gateway.*gateway down/),
      ).toBeInTheDocument();
    });
  });

  describe('degradation', () => {
    it('surfaces a whole-catalog failure instead of an empty grid', () => {
      fixtures.catalogs = [];
      fixtures.catalogsError = { data: { message: 'config root missing' } };
      render(<ProvidersSettings organizationId="org-1" />);
      expect(screen.getByText(/config root missing/)).toBeInTheDocument();
    });

    it('refuses the page without the developer capability', () => {
      abilityState.canRead = false;
      render(<ProvidersSettings organizationId="org-1" />);
      expect(
        screen.queryByRole('heading', { name: 'Anthropic' }),
      ).not.toBeInTheDocument();
    });
  });
});
